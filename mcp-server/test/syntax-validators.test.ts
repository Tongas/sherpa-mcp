import { describe, it, expect } from 'vitest';
import { validateSyntax } from '../src/syntax-validators.js';

describe('validateSyntax', () => {
  it('returns true for valid JSON', () => {
    expect(validateSyntax('a.json', '{"a": 1}')).toBe(true);
  });

  it('returns false for invalid JSON', () => {
    expect(validateSyntax('a.json', '{a: 1')).toBe(false);
  });

  it('returns true for syntactically valid JS', () => {
    expect(validateSyntax('a.js', 'function f() { return 1; }')).toBe(true);
  });

  it('returns false for syntactically invalid JS', () => {
    expect(validateSyntax('a.js', 'function f( { return 1; }')).toBe(false);
  });

  it('returns null when there is no validator for the extension', () => {
    expect(validateSyntax('a.py', 'def f(:\n  pass')).toBeNull();
  });
});
