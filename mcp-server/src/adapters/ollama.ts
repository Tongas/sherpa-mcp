import type { Backend, Capabilities, GenerateOpts, HealthStatus, TokenUsage } from './types.js';
import { BackendTimeoutError, ContextExceededError } from './types.js';

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  generateTimeoutMs?: number;
  healthTimeoutMs?: number;
}

export class OllamaBackend implements Backend {
  private cachedCapabilities: Capabilities | null = null;
  private cachedModel: string | null = null;

  constructor(private opts: OllamaOptions) {}

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async generate(prompt: string, opts: GenerateOpts): Promise<{ text: string; usage: TokenUsage }> {
    const start = Date.now();
    const timeoutMs = this.opts.generateTimeoutMs ?? 300_000;
    let res: Response;
    try {
      res = await this.fetchWithTimeout(
        `${this.opts.baseUrl}/api/generate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.opts.model,
            prompt,
            stream: false,
            options: { num_predict: opts.maxOutputTokens, temperature: opts.temperature }
          })
        },
        timeoutMs
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new BackendTimeoutError(`Ollama didn't respond in ${timeoutMs}ms`);
      }
      throw err;
    }

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400 && /context/i.test(body)) {
        throw new ContextExceededError(body);
      }
      throw new Error(`Ollama responded ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      response: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      text: data.response,
      usage: {
        tokensIn: data.prompt_eval_count ?? 0,
        tokensOut: data.eval_count ?? 0,
        elapsedMs: Date.now() - start
      }
    };
  }

  async getCapabilities(): Promise<Capabilities> {
    const health = await this.checkHealth();
    if (health.status === 'ok' && this.cachedCapabilities && this.cachedModel === health.model) {
      return this.cachedCapabilities;
    }

    const res = await this.fetchWithTimeout(
      `${this.opts.baseUrl}/api/show`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: this.opts.model })
      },
      this.opts.healthTimeoutMs ?? 10_000
    );

    if (!res.ok) {
      // Do not cache this fallback: /api/show may be transiently failing,
      // and caching would permanently pin the conservative default for the
      // process lifetime even after the failure resolves.
      const fallback: Capabilities = { contextWindow: 4096, maxOutputTokens: 2048 };
      return fallback;
    }

    const data = (await res.json()) as { model_info?: Record<string, number> };
    const contextKey = Object.keys(data.model_info ?? {}).find((k) => k.endsWith('.context_length'));
    const contextWindow = contextKey ? (data.model_info as Record<string, number>)[contextKey] : 4096;
    const capabilities: Capabilities = {
      contextWindow,
      maxOutputTokens: Math.min(4096, Math.floor(contextWindow / 2))
    };
    this.cachedCapabilities = capabilities;
    this.cachedModel = this.opts.model;
    return capabilities;
  }

  async checkHealth(): Promise<HealthStatus> {
    const timeoutMs = this.opts.healthTimeoutMs ?? 10_000;
    let tagsRes: Response;
    try {
      tagsRes = await this.fetchWithTimeout(`${this.opts.baseUrl}/api/tags`, { method: 'GET' }, timeoutMs);
    } catch {
      return { status: 'unreachable', detail: `No se pudo conectar a ${this.opts.baseUrl}` };
    }

    if (!tagsRes.ok) {
      return { status: 'unreachable', detail: `Ollama responded ${tagsRes.status} at ${this.opts.baseUrl}` };
    }

    const data = (await tagsRes.json()) as { models: { name: string }[] };
    const availableModels = data.models.map((m) => m.name);

    if (!this.opts.model || !availableModels.includes(this.opts.model)) {
      return {
        status: 'model_not_loaded',
        detail: `Model "${this.opts.model || '(not set)'}" is not available in Ollama`,
        availableModels
      };
    }

    return { status: 'ok', model: this.opts.model };
  }
}
