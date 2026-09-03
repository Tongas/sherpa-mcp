import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import type { Backend } from '../adapters/types.js';
import { resolveWithinRoot } from '../paths.js';
import { sha256 } from '../hash.js';
import { validateSyntax } from '../syntax-validators.js';

export const RESULT_SCHEMA_VERSION = 1;

export interface DelegateTransformParams {
  paths: string[];
  instruction: string;
}

export interface TransformFileResult {
  path: string;
  status: 'would_change' | 'unchanged' | 'skipped' | 'rejected';
  reason?: string;
  diffPreview?: string;
}

export interface DelegateTransformSuccess {
  results: TransformFileResult[];
  resultPath: string;
  usage: { calls: number; tokensIn: number; tokensOut: number; elapsedMs: number };
}

export interface DelegateTransformUnavailable {
  status: 'unreachable' | 'model_not_loaded';
  detail: string;
  availableModels?: string[];
}

export type DelegateTransformResult = DelegateTransformSuccess | DelegateTransformUnavailable;

const PREVIEW_LINES = 15;

export async function delegateTransform(
  backend: Backend,
  root: string,
  resultsDir: string,
  truncationThreshold: number,
  params: DelegateTransformParams
): Promise<DelegateTransformResult> {
  const health = await backend.checkHealth();
  if (health.status !== 'ok') {
    return {
      status: health.status,
      detail: health.detail,
      ...(health.status === 'model_not_loaded' ? { availableModels: health.availableModels } : {})
    };
  }

  const capabilities = await backend.getCapabilities();
  const results: TransformFileResult[] = [];
  const proposals: { path: string; originalHash: string; proposedContent: string; diff: string }[] = [];
  let calls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let elapsedMs = 0;

  for (const inputPath of params.paths) {
    const resolved = resolveWithinRoot(root, inputPath);
    if (!resolved) {
      results.push({ path: inputPath, status: 'rejected', reason: 'outside_project_root' });
      continue;
    }
    const relPath = path.relative(root, resolved);

    let original: string;
    try {
      original = fs.readFileSync(resolved, 'utf8');
    } catch {
      results.push({ path: relPath, status: 'skipped', reason: 'read_error' });
      continue;
    }

    const estimatedInputTokens = Math.ceil(original.length / 4);
    const marginTokens = 200;
    if (estimatedInputTokens + marginTokens > capabilities.maxOutputTokens) {
      results.push({ path: relPath, status: 'skipped', reason: 'exceeds_model_output_budget' });
      continue;
    }

    const prompt =
      `Instruction: ${params.instruction}\n\nFile (${relPath}):\n${original}\n\n` +
      `Return the complete transformed file according to the instruction, with no extra explanation.`;
    const { text: proposedContent, usage } = await backend.generate(prompt, {
      maxOutputTokens: capabilities.maxOutputTokens
    });
    calls++;
    tokensIn += usage.tokensIn;
    tokensOut += usage.tokensOut;
    elapsedMs += usage.elapsedMs;

    const originalLines = original.split('\n').length;
    const proposedLines = proposedContent.split('\n').length;
    if (proposedLines < truncationThreshold * originalLines) {
      results.push({ path: relPath, status: 'rejected', reason: 'output_possibly_truncated' });
      continue;
    }

    const syntaxOk = validateSyntax(relPath, proposedContent);
    if (syntaxOk === false) {
      results.push({ path: relPath, status: 'rejected', reason: 'syntax_validation_failed' });
      continue;
    }

    if (proposedContent === original) {
      results.push({ path: relPath, status: 'unchanged' });
      continue;
    }

    const diff = createTwoFilesPatch(relPath, relPath, original, proposedContent);
    proposals.push({ path: relPath, originalHash: sha256(original), proposedContent, diff });

    const diffPreview = diff.split('\n').slice(0, PREVIEW_LINES).join('\n');
    results.push({ path: relPath, status: 'would_change', diffPreview });
  }

  fs.mkdirSync(path.join(root, resultsDir), { recursive: true });
  const resultPath = path.join(resultsDir, `transform-${crypto.randomUUID()}.json`);
  fs.writeFileSync(
    path.join(root, resultPath),
    JSON.stringify({ schemaVersion: RESULT_SCHEMA_VERSION, files: proposals }, null, 2),
    'utf8'
  );

  return { results, resultPath, usage: { calls, tokensIn, tokensOut, elapsedMs } };
}
