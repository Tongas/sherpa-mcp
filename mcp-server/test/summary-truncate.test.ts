import { describe, it, expect } from 'vitest';
import { structuredTruncate } from '../src/summary-truncate.js';

describe('structuredTruncate', () => {
  it('returns the text unchanged when under budget', () => {
    const result = structuredTruncate('- finding one\n- finding two', '.sherpa/x.md', 4000);
    expect(result.summary).toBe('- finding one\n- finding two');
  });

  it('truncates by whole line, never mid-line, and adds a note with the result path', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `- finding number ${i} with some extra padding text`);
    const text = lines.join('\n');
    const result = structuredTruncate(text, '.sherpa/x.md', 200);

    expect(result.summary).toContain('truncated:');
    expect(result.summary).toContain('.sherpa/x.md');
    // every kept line before the note must be a complete original line
    const noteIndex = result.summary.indexOf('\n\n(truncated:');
    const kept = result.summary.slice(0, noteIndex).split('\n');
    for (const line of kept) {
      expect(lines).toContain(line);
    }
  });
});
