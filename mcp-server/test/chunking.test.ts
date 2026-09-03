import { describe, it, expect } from 'vitest';
import { estimateTokens, planChunks, type FileContent } from '../src/chunking.js';

describe('estimateTokens', () => {
  it('estimates roughly 1 token per 4 characters', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('planChunks', () => {
  it('puts a single small file in one chunk', () => {
    const files: FileContent[] = [{ path: 'a.ts', content: 'x'.repeat(40) }];
    const plan = planChunks(files, 1000, 100);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  it('groups multiple small files into one chunk under budget', () => {
    const files: FileContent[] = [
      { path: 'a.ts', content: 'x'.repeat(40) },
      { path: 'b.ts', content: 'x'.repeat(40) }
    ];
    const plan = planChunks(files, 1000, 100);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]).toHaveLength(2);
  });

  it('splits into multiple chunks when budget is exceeded', () => {
    const files: FileContent[] = [
      { path: 'a.ts', content: 'x'.repeat(400) },
      { path: 'b.ts', content: 'x'.repeat(400) },
      { path: 'c.ts', content: 'x'.repeat(400) }
    ];
    // budget = 250 - 0 = 250 tokens; each file is ~100 tokens.
    // With a strict `>` boundary check, budget 300 lets all three files
    // (300 tokens total) fit exactly into a single chunk, so 250 is used
    // instead to force the split: file1+file2 = 200 fits, but adding
    // file3 would make 300 > 250, so file3 starts a new chunk.
    const plan = planChunks(files, 250, 0);
    expect(plan.chunks.length).toBeGreaterThan(1);
    const totalFiles = plan.chunks.reduce((sum, c) => sum + c.length, 0);
    expect(totalFiles).toBe(3);
  });

  it('skips and reports a file that alone exceeds the budget', () => {
    const files: FileContent[] = [
      { path: 'huge.ts', content: 'x'.repeat(10_000) },
      { path: 'small.ts', content: 'x'.repeat(40) }
    ];
    const plan = planChunks(files, 1000, 100);
    expect(plan.skipped).toEqual([
      { path: 'huge.ts', reason: 'exceeds_context_window' }
    ]);
    expect(plan.chunks.flat().map((f) => f.path)).toEqual(['small.ts']);
  });
});
