import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Backend } from '../adapters/types.js';
import { enumerateFiles } from '../file-enumeration.js';
import { planChunks, type FileContent } from '../chunking.js';
import { structuredTruncate } from '../summary-truncate.js';
import { runMapReduce } from '../map-reduce.js';

export interface DelegateExplorationParams {
  paths: string[];
  instruction: string;
}

export interface DelegateExplorationSuccess {
  summary: string;
  resultPath: string;
  filesProcessed: number;
  filesSkipped: { path: string; reason: string }[];
  budget: { maxFiles: number; maxChunks: number; filesConsidered: number; truncatedByBudget: boolean };
  usage: { calls: number; tokensIn: number; tokensOut: number; elapsedMs: number };
}

export interface DelegateExplorationUnavailable {
  status: 'unreachable' | 'model_not_loaded';
  detail: string;
  availableModels?: string[];
}

export type DelegateExplorationResult = DelegateExplorationSuccess | DelegateExplorationUnavailable;

function buildMapPrompt(instruction: string, chunk: FileContent[]): string {
  const filesBlock = chunk.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
  return (
    `Instruction: ${instruction}\n\n` +
    `Analyze the following files and report findings relevant to the instruction, ` +
    `one per line, format "- <file>: <finding>".\n\n${filesBlock}`
  );
}

function buildReducePrompt(instruction: string, partials: string[]): string {
  return (
    `Original instruction: ${instruction}\n\n` +
    `Below are partial findings from different groups of files. Synthesize them into ` +
    `a final list of unique, relevant findings, same format "- <file>: <finding>", ` +
    `no duplicates.\n\n${partials.join('\n\n')}`
  );
}

export async function delegateExploration(
  backend: Backend,
  root: string,
  resultsDir: string,
  budgetConfig: { maxFiles: number; maxChunks: number },
  params: DelegateExplorationParams
): Promise<DelegateExplorationResult> {
  const health = await backend.checkHealth();
  if (health.status !== 'ok') {
    return {
      status: health.status,
      detail: health.detail,
      ...(health.status === 'model_not_loaded' ? { availableModels: health.availableModels } : {})
    };
  }

  const enumeration = enumerateFiles(root, params.paths, budgetConfig.maxFiles);
  const capabilities = await backend.getCapabilities();
  const reserve = capabilities.maxOutputTokens + 300;

  const fileContents: FileContent[] = [];
  const filesSkipped = [...enumeration.filesSkipped];
  for (const filePath of enumeration.files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      fileContents.push({ path: path.relative(root, filePath), content });
    } catch {
      filesSkipped.push({ path: path.relative(root, filePath), reason: 'read_error' });
    }
  }

  const { chunks, skipped: chunkSkipped } = planChunks(fileContents, capabilities.contextWindow, reserve);
  filesSkipped.push(...chunkSkipped);

  const { finalText, usage, usedChunkCount, truncatedByChunkBudget, droppedChunks } = await runMapReduce(
    backend,
    chunks,
    budgetConfig,
    (chunk) => buildMapPrompt(params.instruction, chunk),
    (partials) => buildReducePrompt(params.instruction, partials),
    { maxOutputTokens: capabilities.maxOutputTokens },
    '(no findings: no processable files)'
  );

  const truncatedByBudget = enumeration.truncatedByBudget || truncatedByChunkBudget;

  for (const droppedChunk of droppedChunks) {
    for (const file of droppedChunk) {
      filesSkipped.push({ path: file.path, reason: 'chunk_budget_exceeded' });
    }
  }

  fs.mkdirSync(path.join(root, resultsDir), { recursive: true });
  const resultPath = path.join(resultsDir, `exploration-${crypto.randomUUID()}.md`);
  fs.writeFileSync(path.join(root, resultPath), finalText, 'utf8');

  const { summary } = structuredTruncate(finalText, resultPath);

  return {
    summary,
    resultPath,
    filesProcessed: chunks.slice(0, usedChunkCount).reduce((sum, c) => sum + c.length, 0),
    filesSkipped,
    budget: {
      maxFiles: budgetConfig.maxFiles,
      maxChunks: budgetConfig.maxChunks,
      filesConsidered: enumeration.files.length,
      truncatedByBudget
    },
    usage
  };
}
