import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { delegateExploration } from '../../src/tools/delegate-exploration.js';
import type { Backend } from '../../src/adapters/types.js';

function fakeBackend(responses: string[]): Backend {
  let call = 0;
  return {
    generate: async () => ({
      text: responses[call++] ?? '(no more canned responses)',
      usage: { tokensIn: 10, tokensOut: 5, elapsedMs: 1 }
    }),
    getCapabilities: async () => ({ contextWindow: 100_000, maxOutputTokens: 2000 }),
    checkHealth: async () => ({ status: 'ok', model: 'test-model' })
  };
}

describe('delegateExploration', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-explore-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 2;');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('processes files in one chunk (single map call, no reduce) and writes resultPath', async () => {
    const backend = fakeBackend(['- src/a.ts: exports a\n- src/b.ts: exports b']);
    const result = await delegateExploration(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      { paths: ['src'], instruction: 'list the exports' }
    );

    expect(result.filesProcessed).toBe(2);
    expect(result.filesSkipped).toEqual([]);
    expect(result.budget).toEqual({
      maxFiles: 100,
      maxChunks: 20,
      filesConsidered: 2,
      truncatedByBudget: false
    });
    expect(result.usage).toEqual({ calls: 1, tokensIn: 10, tokensOut: 5, elapsedMs: 1 });
    expect(result.summary).toContain('exports a');

    const written = fs.readFileSync(path.join(root, result.resultPath), 'utf8');
    expect(written).toContain('exports a');
  });

  it('runs a reduce call when there is more than one chunk', async () => {
    let call = 0;
    const backend: Backend = {
      generate: async () => {
        call++;
        return {
          text: call <= 2 ? `partial ${call}` : 'final synthesized summary',
          usage: { tokensIn: 1, tokensOut: 1, elapsedMs: 1 }
        };
      },
      // src/a.ts and src/b.ts are each 19 chars -> 5 estimated tokens.
      // reserve = maxOutputTokens(45) + 300 = 345; budget = 350 - 345 = 5.
      // One file (5) fits the budget; two files (10) don't -> forces 2 chunks.
      getCapabilities: async () => ({ contextWindow: 350, maxOutputTokens: 45 }),
      checkHealth: async () => ({ status: 'ok', model: 'test-model' })
    };

    const result = await delegateExploration(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      { paths: ['src'], instruction: 'list the exports' }
    );

    // 2 map calls (one per chunk) + 1 reduce call = 3.
    expect(result.usage.calls).toBe(3);
  });

  it('drops files from chunks beyond maxChunks, excluding them from filesProcessed and recording them in filesSkipped', async () => {
    const backend: Backend = {
      generate: async () => ({
        text: 'partial',
        usage: { tokensIn: 1, tokensOut: 1, elapsedMs: 1 }
      }),
      // Same sizing as above: forces src/a.ts and src/b.ts into 2 separate chunks.
      getCapabilities: async () => ({ contextWindow: 350, maxOutputTokens: 45 }),
      checkHealth: async () => ({ status: 'ok', model: 'test-model' })
    };

    const result = await delegateExploration(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 1 },
      { paths: ['src'], instruction: 'list the exports' }
    );

    // Only the first chunk (1 file) is actually sent to the backend.
    expect(result.filesProcessed).toBe(1);
    expect(result.filesSkipped).toEqual([
      { path: 'src/b.ts', reason: 'chunk_budget_exceeded' }
    ]);
    expect(result.budget.truncatedByBudget).toBe(true);
    // Only 1 map call (no reduce, since only 1 chunk was used).
    expect(result.usage.calls).toBe(1);
  });

  it('returns early with unreachable status when the backend is unhealthy, without calling getCapabilities/generate', async () => {
    let capabilitiesCalled = false;
    let generateCalled = false;
    const backend: Backend = {
      generate: async () => {
        generateCalled = true;
        return { text: '', usage: { tokensIn: 0, tokensOut: 0, elapsedMs: 0 } };
      },
      getCapabilities: async () => {
        capabilitiesCalled = true;
        return { contextWindow: 0, maxOutputTokens: 0 };
      },
      checkHealth: async () => ({ status: 'unreachable', detail: 'connection refused' })
    };

    const result = await delegateExploration(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      { paths: ['src'], instruction: 'list the exports' }
    );

    expect(result).toEqual({ status: 'unreachable', detail: 'connection refused' });
    expect(capabilitiesCalled).toBe(false);
    expect(generateCalled).toBe(false);
  });

  it('returns early with model_not_loaded status and availableModels when the backend model is not loaded', async () => {
    const backend: Backend = {
      generate: async () => ({ text: '', usage: { tokensIn: 0, tokensOut: 0, elapsedMs: 0 } }),
      getCapabilities: async () => ({ contextWindow: 0, maxOutputTokens: 0 }),
      checkHealth: async () => ({
        status: 'model_not_loaded',
        detail: 'model not found',
        availableModels: ['a', 'b']
      })
    };

    const result = await delegateExploration(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      { paths: ['src'], instruction: 'list the exports' }
    );

    expect(result).toEqual({
      status: 'model_not_loaded',
      detail: 'model not found',
      availableModels: ['a', 'b']
    });
  });
});
