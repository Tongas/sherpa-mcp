import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runRipgrep,
  RipgrepNotFoundError,
  delegateSearch,
  type RipgrepMatch
} from '../../src/tools/delegate-search.js';
import type { Backend } from '../../src/adapters/types.js';

function fakeSpawnRg(stdout: string) {
  return () => ({ stdout, stderr: '', status: 0, signal: null, error: undefined, pid: 1, output: [] }) as any;
}

function fakeSpawnEnoent() {
  return () =>
    ({
      stdout: '',
      stderr: '',
      status: null,
      signal: null,
      error: Object.assign(new Error('spawn rg ENOENT'), { code: 'ENOENT' }),
      pid: 0,
      output: []
    }) as any;
}

describe('runRipgrep', () => {
  it('parses --json match lines into RipgrepMatch objects', () => {
    const line = JSON.stringify({
      type: 'match',
      data: { path: { text: '/root/src/a.ts' }, line_number: 3, lines: { text: 'const x = 1;\n' } }
    });
    const matches = runRipgrep('/root', 'const', ['/root/src'], fakeSpawnRg(line + '\n'));
    expect(matches).toEqual([
      { path: path.join('src', 'a.ts'), lineNumber: 3, line: 'const x = 1;\n', context: [] }
    ]);
  });

  it('throws RipgrepNotFoundError when rg is not on PATH', () => {
    expect(() => runRipgrep('/root', 'x', ['/root'], fakeSpawnEnoent())).toThrow(RipgrepNotFoundError);
  });
});

describe('delegateSearch', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-search-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects paths outside the project root before invoking ripgrep', async () => {
    const backend: Backend = {
      generate: async () => ({ text: 'synthesis', usage: { tokensIn: 1, tokensOut: 1, elapsedMs: 1 } }),
      getCapabilities: async () => ({ contextWindow: 100_000, maxOutputTokens: 2000 }),
      checkHealth: async () => ({ status: 'ok', model: 'test-model' })
    };
    const line = JSON.stringify({
      type: 'match',
      data: { path: { text: path.join(root, 'a.ts') }, line_number: 1, lines: { text: 'match\n' } }
    });
    const result = await delegateSearch(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      {
        pattern: 'match',
        paths: ['../outside', '.'],
        instruction: 'synthesize'
      },
      { spawnFn: fakeSpawnRg(line + '\n') }
    );

    expect(result.filesSkipped).toEqual([{ path: '../outside', reason: 'outside_project_root' }]);
    expect(result.matchCount).toBe(1);
    expect(result.matchesProcessed).toBe(1);
    expect(result.budget).toEqual({
      maxFiles: 100,
      maxChunks: 20,
      filesConsidered: 1,
      truncatedByBudget: false
    });
    expect(result.summary).toContain('synthesis');
  });

  it('throws with stderr included when ripgrep exits with status >= 2', async () => {
    const backend: Backend = {
      generate: async () => ({ text: 'synthesis', usage: { tokensIn: 1, tokensOut: 1, elapsedMs: 1 } }),
      getCapabilities: async () => ({ contextWindow: 100_000, maxOutputTokens: 2000 }),
      checkHealth: async () => ({ status: 'ok', model: 'test-model' })
    };
    const fakeSpawnFailure = () =>
      ({
        stdout: '',
        stderr: 'regex parse error: unmatched ( in pattern',
        status: 2,
        signal: null,
        error: undefined,
        pid: 1,
        output: []
      }) as any;

    await expect(
      delegateSearch(
        backend,
        root,
        '.sherpa',
        { maxFiles: 100, maxChunks: 20 },
        { pattern: '(', paths: ['.'], instruction: 'synthesize' },
        { spawnFn: fakeSpawnFailure }
      )
    ).rejects.toThrow(/unmatched \( in pattern/);
  });

  it('skips a malformed JSON line from ripgrep output but keeps valid matches', async () => {
    const backend: Backend = {
      generate: async () => ({ text: 'synthesis', usage: { tokensIn: 1, tokensOut: 1, elapsedMs: 1 } }),
      getCapabilities: async () => ({ contextWindow: 100_000, maxOutputTokens: 2000 }),
      checkHealth: async () => ({ status: 'ok', model: 'test-model' })
    };
    const goodLine = JSON.stringify({
      type: 'match',
      data: { path: { text: path.join(root, 'a.ts') }, line_number: 1, lines: { text: 'match\n' } }
    });
    const stdout = [goodLine, '{not valid json', goodLine].join('\n') + '\n';

    const result = await delegateSearch(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      { pattern: 'match', paths: ['.'], instruction: 'synthesize' },
      { spawnFn: fakeSpawnRg(stdout) }
    );

    expect(result.matchCount).toBe(2);
  });

  it('applies the maxChunks budget, truncating and reporting it', async () => {
    const backend: Backend = {
      generate: async () => ({ text: 'partial', usage: { tokensIn: 1, tokensOut: 1, elapsedMs: 1 } }),
      // Two match blocks of ~5 tokens each; reserve = 45 + 300 = 345, budget = 350 - 345 = 5.
      // One match fits per chunk -> forces 2 chunks.
      getCapabilities: async () => ({ contextWindow: 350, maxOutputTokens: 45 }),
      checkHealth: async () => ({ status: 'ok', model: 'test-model' })
    };
    // Each match line's content is 19 chars -> 5 estimated tokens, exactly filling the budget,
    // so a second match forces a second chunk (same sizing as the delegate-exploration budget test).
    const matchContent = 'x'.repeat(19);
    const lineA = JSON.stringify({
      type: 'match',
      data: { path: { text: path.join(root, 'a.ts') }, line_number: 1, lines: { text: matchContent } }
    });
    const lineB = JSON.stringify({
      type: 'match',
      data: { path: { text: path.join(root, 'b.ts') }, line_number: 1, lines: { text: matchContent } }
    });

    const result = await delegateSearch(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 1 },
      { pattern: 'match', paths: ['.'], instruction: 'synthesize' },
      { spawnFn: fakeSpawnRg([lineA, lineB].join('\n') + '\n') }
    );

    expect(result.matchCount).toBe(2);
    expect(result.matchesProcessed).toBe(1);
    expect(result.budget.truncatedByBudget).toBe(true);
    expect(result.filesSkipped).toContainEqual(
      expect.objectContaining({ reason: 'chunk_budget_exceeded' })
    );
    expect(result.usage.calls).toBe(1);
  });

  it('sums usage across map+reduce calls and writes the synthesized text to resultPath', async () => {
    let call = 0;
    const backend: Backend = {
      generate: async () => {
        call++;
        return {
          text: call <= 2 ? `partial ${call}` : 'final synthesized matches',
          usage: { tokensIn: 10, tokensOut: 4, elapsedMs: 2 }
        };
      },
      // Same sizing trick as the budget test: forces 2 map chunks + 1 reduce call.
      getCapabilities: async () => ({ contextWindow: 350, maxOutputTokens: 45 }),
      checkHealth: async () => ({ status: 'ok', model: 'test-model' })
    };
    const matchContent = 'x'.repeat(19);
    const lineA = JSON.stringify({
      type: 'match',
      data: { path: { text: path.join(root, 'a.ts') }, line_number: 1, lines: { text: matchContent } }
    });
    const lineB = JSON.stringify({
      type: 'match',
      data: { path: { text: path.join(root, 'b.ts') }, line_number: 1, lines: { text: matchContent } }
    });

    const result = await delegateSearch(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      { pattern: 'match', paths: ['.'], instruction: 'synthesize' },
      { spawnFn: fakeSpawnRg([lineA, lineB].join('\n') + '\n') }
    );

    // 2 map calls + 1 reduce call = 3, each contributing 10 in / 4 out / 2 ms.
    expect(result.usage).toEqual({ calls: 3, tokensIn: 30, tokensOut: 12, elapsedMs: 6 });

    const written = fs.readFileSync(path.join(root, result.resultPath), 'utf8');
    expect(written).toContain('final synthesized matches');
    expect(result.summary).toContain('final synthesized matches');
  });

  it('returns early with unreachable status when the backend is unhealthy, without running ripgrep or generate', async () => {
    let generateCalled = false;
    const backend: Backend = {
      generate: async () => {
        generateCalled = true;
        return { text: '', usage: { tokensIn: 0, tokensOut: 0, elapsedMs: 0 } };
      },
      getCapabilities: async () => ({ contextWindow: 0, maxOutputTokens: 0 }),
      checkHealth: async () => ({ status: 'unreachable', detail: 'connection refused' })
    };
    let spawnCalled = false;
    const spawnFn = (() => {
      spawnCalled = true;
      return { stdout: '', stderr: '', status: 0, signal: null, error: undefined, pid: 1, output: [] };
    }) as any;

    const result = await delegateSearch(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      { pattern: 'match', paths: ['.'], instruction: 'synthesize' },
      { spawnFn }
    );

    expect(result).toEqual({ status: 'unreachable', detail: 'connection refused' });
    expect(spawnCalled).toBe(false);
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

    const result = await delegateSearch(
      backend,
      root,
      '.sherpa',
      { maxFiles: 100, maxChunks: 20 },
      { pattern: 'match', paths: ['.'], instruction: 'synthesize' }
    );

    expect(result).toEqual({
      status: 'model_not_loaded',
      detail: 'model not found',
      availableModels: ['a', 'b']
    });
  });
});
