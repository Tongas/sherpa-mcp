import { describe, it, expect } from 'vitest';
import { BackendTimeoutError, ContextExceededError } from '../../src/adapters/types.js';

describe('typed backend errors', () => {
  it('BackendTimeoutError carries a message and the right name', () => {
    const err = new BackendTimeoutError('timed out after 300000ms');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BackendTimeoutError');
    expect(err.message).toBe('timed out after 300000ms');
  });

  it('ContextExceededError carries a message and the right name', () => {
    const err = new ContextExceededError('prompt too long');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ContextExceededError');
  });
});
