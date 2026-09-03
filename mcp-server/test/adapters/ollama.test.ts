import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaBackend } from '../../src/adapters/ollama.js';
import { BackendTimeoutError } from '../../src/adapters/types.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe('OllamaBackend', () => {
  let backend: OllamaBackend;

  beforeEach(() => {
    // Fresh instance per test: getCapabilities() caches internally, and a
    // shared instance would let test 6 (parses context_length) leak its
    // cached value into test 7 (fallback on /api/show failure).
    backend = new OllamaBackend({ baseUrl: 'http://localhost:11434', model: 'qwen2.5-coder' });
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

  it('checkHealth returns model_not_loaded when the model is not in the tags list', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ models: [{ name: 'llama3' }] })
    );
    const result = await backend.checkHealth();
    expect(result.status).toBe('model_not_loaded');
    if (result.status === 'model_not_loaded') {
      expect(result.availableModels).toEqual(['llama3']);
    }
  });

  it('checkHealth returns ok when the configured model is present', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ models: [{ name: 'qwen2.5-coder' }] })
    );
    const result = await backend.checkHealth();
    expect(result).toEqual({ status: 'ok', model: 'qwen2.5-coder' });
  });

  it('generate returns text and usage from the response', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ response: 'hola', prompt_eval_count: 10, eval_count: 5 })
    );
    const result = await backend.generate('hi', {});
    expect(result.text).toBe('hola');
    expect(result.usage.tokensIn).toBe(10);
    expect(result.usage.tokensOut).toBe(5);
  });

  it('generate throws BackendTimeoutError when the request aborts', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(backend.generate('hi', {})).rejects.toBeInstanceOf(BackendTimeoutError);
  });

  it('getCapabilities parses context_length from /api/show', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ models: [{ name: 'qwen2.5-coder' }] })) // checkHealth (called internally)
      .mockResolvedValueOnce(jsonResponse({ model_info: { 'qwen2.context_length': 32768 } }));
    const caps = await backend.getCapabilities();
    expect(caps.contextWindow).toBe(32768);
  });

  it('getCapabilities falls back to conservative defaults if /api/show fails', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ models: [{ name: 'qwen2.5-coder' }] }))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    const caps = await backend.getCapabilities();
    expect(caps).toEqual({ contextWindow: 4096, maxOutputTokens: 2048 });
  });
});
