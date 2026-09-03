import { describe, it, expect } from 'vitest';
import { healthCheck } from '../../src/tools/health-check.js';
import type { Backend } from '../../src/adapters/types.js';

function fakeBackend(overrides: Partial<Backend>): Backend {
  return {
    generate: async () => ({ text: '', usage: { tokensIn: 0, tokensOut: 0, elapsedMs: 0 } }),
    getCapabilities: async () => ({ contextWindow: 4096, maxOutputTokens: 2048 }),
    checkHealth: async () => ({ status: 'ok', model: 'test-model' }),
    ...overrides
  };
}

describe('healthCheck', () => {
  it('returns ok with capabilities when the backend is healthy', async () => {
    const backend = fakeBackend({
      checkHealth: async () => ({ status: 'ok', model: 'test-model' }),
      getCapabilities: async () => ({ contextWindow: 8192, maxOutputTokens: 4096 })
    });
    const result = await healthCheck(backend);
    expect(result).toEqual({
      status: 'ok',
      model: 'test-model',
      contextWindow: 8192,
      maxOutputTokens: 4096
    });
  });

  it('passes through unreachable without calling getCapabilities', async () => {
    let capabilitiesCalled = false;
    const backend = fakeBackend({
      checkHealth: async () => ({ status: 'unreachable', detail: 'no route' }),
      getCapabilities: async () => {
        capabilitiesCalled = true;
        return { contextWindow: 0, maxOutputTokens: 0 };
      }
    });
    const result = await healthCheck(backend);
    expect(result).toEqual({ status: 'unreachable', detail: 'no route' });
    expect(capabilitiesCalled).toBe(false);
  });

  it('passes through model_not_loaded with availableModels', async () => {
    const backend = fakeBackend({
      checkHealth: async () => ({
        status: 'model_not_loaded',
        detail: 'not found',
        availableModels: ['a', 'b']
      })
    });
    const result = await healthCheck(backend);
    expect(result).toEqual({ status: 'model_not_loaded', detail: 'not found', availableModels: ['a', 'b'] });
  });
});
