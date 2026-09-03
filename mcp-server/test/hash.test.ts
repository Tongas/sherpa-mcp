// mcp-server/test/hash.test.ts
import { describe, it, expect } from 'vitest';
import { sha256 } from '../src/hash.js';

describe('sha256', () => {
  it('matches the known digest for an empty string', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the known digest for "hello"', () => {
    expect(sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces different hashes for different content', () => {
    expect(sha256('a')).not.toBe(sha256('b'));
  });
});
