import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Backend } from '../adapters/types.js';
import { resolveWithinRoot } from '../paths.js';
import { planChunks, type FileContent } from '../chunking.js';
import { structuredTruncate } from '../summary-truncate.js';
import { runMapReduce } from '../map-reduce.js';

export class RipgrepNotFoundError extends Error {
  constructor() {
    super(
      'ripgrep (rg) is not installed or not on PATH. Install it: ' +
        'macOS: brew install ripgrep · Debian/Ubuntu: apt install ripgrep · ' +
        'https://github.com/BurntSushi/ripgrep#installation'
    );
    this.name = 'RipgrepNotFoundError';
  }
}

export interface RipgrepMatch {
  path: string;
  lineNumber: number;
  line: string;
  context: string[];
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8' }
) => SpawnSyncReturns<string>;

const RIPGREP_MAX_BUFFER = 64 * 1024 * 1024;

const defaultSpawnFn: SpawnFn = (command, args, options) =>
  spawnSync(command, args, { ...options, maxBuffer: RIPGREP_MAX_BUFFER } as any);

export function runRipgrep(
  root: string,
  pattern: string,
  resolvedPaths: string[],
  resultsDir: string,
  spawnFn: SpawnFn = defaultSpawnFn
): RipgrepMatch[] {
  const result = spawnFn(
    'rg',
    ['--json', '-C', '2', '-g', `!/${resultsDir}/**`, '--', pattern, ...resolvedPaths],
    { cwd: root, encoding: 'utf8' }
  );

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new RipgrepNotFoundError();
    }
    throw new Error(`ripgrep failed to run (${code ?? 'unknown error'}): ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status >= 2) {
    throw new Error(`ripgrep failed (exit ${result.status}): ${result.stderr}`);
  }

  const matches: RipgrepMatch[] = [];
  const lines = (result.stdout ?? '').split('\n').filter(Boolean);
  for (const line of lines) {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.type === 'match') {
      const pathText = parsed.data?.path?.text;
      if (typeof pathText !== 'string') {
        continue;
      }
      matches.push({
        path: path.relative(root, pathText),
        lineNumber: parsed.data.line_number,
        line: parsed.data.lines.text,
        context: []
      });
    }
  }
  return matches;
}

export interface DelegateSearchParams {
  pattern: string;
  paths: string[];
  instruction: string;
}

export interface DelegateSearchSuccess {
  summary: string;
  resultPath: string;
  matchCount: number;
  matchesProcessed: number;
  filesSkipped: { path: string; reason: string }[];
  budget: { maxFiles: number; maxChunks: number; filesConsidered: number; truncatedByBudget: boolean };
  usage: { calls: number; tokensIn: number; tokensOut: number; elapsedMs: number };
}

export interface DelegateSearchUnavailable {
  status: 'unreachable' | 'model_not_loaded';
  detail: string;
  availableModels?: string[];
}

export type DelegateSearchResult = DelegateSearchSuccess | DelegateSearchUnavailable;

function buildMapPrompt(instruction: string, chunk: FileContent[]): string {
  const block = chunk.map((c) => `${c.path}: ${c.content}`).join('\n');
  return (
    `Instruction: ${instruction}\n\nMatches found:\n${block}\n\n` +
    `Synthesize according to the instruction, format "- <file>: <finding>".`
  );
}

function buildReducePrompt(instruction: string, partials: string[]): string {
  return (
    `Original instruction: ${instruction}\n\n` +
    `Synthesize these partial findings into a single list:\n\n${partials.join('\n\n')}`
  );
}

export async function delegateSearch(
  backend: Backend,
  root: string,
  resultsDir: string,
  budgetConfig: { maxFiles: number; maxChunks: number },
  params: DelegateSearchParams,
  deps: { spawnFn?: SpawnFn } = {}
): Promise<DelegateSearchResult> {
  const health = await backend.checkHealth();
  if (health.status !== 'ok') {
    return {
      status: health.status,
      detail: health.detail,
      ...(health.status === 'model_not_loaded' ? { availableModels: health.availableModels } : {})
    };
  }

  const filesSkipped: { path: string; reason: string }[] = [];
  const resolvedPaths: string[] = [];
  for (const p of params.paths) {
    const resolved = resolveWithinRoot(root, p);
    if (!resolved) {
      filesSkipped.push({ path: p, reason: 'outside_project_root' });
      continue;
    }
    resolvedPaths.push(resolved);
  }

  const matches =
    resolvedPaths.length > 0 ? runRipgrep(root, params.pattern, resolvedPaths, resultsDir, deps.spawnFn) : [];
  const capabilities = await backend.getCapabilities();
  const reserve = capabilities.maxOutputTokens + 300;

  const matchBlocks: FileContent[] = matches.map((m) => ({
    path: `${m.path}:${m.lineNumber}`,
    content: m.line
  }));

  const { chunks } = planChunks(matchBlocks, capabilities.contextWindow, reserve);

  const { finalText, usage, usedChunkCount, truncatedByChunkBudget, droppedChunks } = await runMapReduce(
    backend,
    chunks,
    budgetConfig,
    (chunk) => buildMapPrompt(params.instruction, chunk),
    (partials) => buildReducePrompt(params.instruction, partials),
    { maxOutputTokens: capabilities.maxOutputTokens },
    '(no matches)'
  );

  for (const droppedChunk of droppedChunks) {
    for (const match of droppedChunk) {
      filesSkipped.push({ path: match.path, reason: 'chunk_budget_exceeded' });
    }
  }

  fs.mkdirSync(path.join(root, resultsDir), { recursive: true });
  const resultPath = path.join(resultsDir, `search-${crypto.randomUUID()}.md`);
  fs.writeFileSync(path.join(root, resultPath), finalText, 'utf8');

  const { summary } = structuredTruncate(finalText, resultPath);

  return {
    summary,
    resultPath,
    matchCount: matches.length,
    matchesProcessed: chunks.slice(0, usedChunkCount).reduce((sum, c) => sum + c.length, 0),
    filesSkipped,
    budget: {
      maxFiles: budgetConfig.maxFiles,
      maxChunks: budgetConfig.maxChunks,
      filesConsidered: matches.length,
      truncatedByBudget: truncatedByChunkBudget
    },
    usage
  };
}
