import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleBackend } from '../../src/adapters/openai-compatible.js';
import { BackendTimeoutError } from '../../src/adapters/types.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('OpenAICompatibleBackend', () => {
  const backend = new OpenAICompatibleBackend({
    baseUrl: 'http://localhost:8080',
    model: 'local-model',
    contextWindowOverride: 8192,
    maxOutputTokensOverride: 1024
  });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('checkHealth returns unreachable when fetch throws', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await backend.checkHealth();
    expect(result.status).toBe('unreachable');
  });

  it('checkHealth returns model_not_loaded when model id is absent from /v1/models', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [{ id: 'other-model' }] })
    );
    const result = await backend.checkHealth();
    expect(result.status).toBe('model_not_loaded');
  });

  it('checkHealth returns ok when model id is present', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ data: [{ id: 'local-model' }] })
    );
    const result = await backend.checkHealth();
    expect(result).toEqual({ status: 'ok', model: 'local-model' });
  });

  it('generate parses choices[0].message.content and usage', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: 'hola' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 }
      })
    );
    const result = await backend.generate('hi', {});
    expect(result.text).toBe('hola');
    expect(result.usage).toEqual({ tokensIn: 7, tokensOut: 3, elapsedMs: expect.any(Number) });
  });

  it('generate throws BackendTimeoutError on abort', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(backend.generate('hi', {})).rejects.toBeInstanceOf(BackendTimeoutError);
  });

  it('getCapabilities uses config overrides', async () => {
    const caps = await backend.getCapabilities();
    expect(caps).toEqual({ contextWindow: 8192, maxOutputTokens: 1024 });
  });

  it('getCapabilities falls back to conservative defaults with no overrides', async () => {
    const noOverrideBackend = new OpenAICompatibleBackend({
      baseUrl: 'http://localhost:8080',
      model: 'local-model'
    });
    const caps = await noOverrideBackend.getCapabilities();
    expect(caps).toEqual({ contextWindow: 4096, maxOutputTokens: 2048 });
  });
});
