import type { Backend, Capabilities, GenerateOpts, HealthStatus, TokenUsage } from './types.js';
import { BackendTimeoutError, ContextExceededError } from './types.js';

export interface OpenAICompatibleOptions {
  baseUrl: string;
  model: string;
  contextWindowOverride?: number;
  maxOutputTokensOverride?: number;
  generateTimeoutMs?: number;
  healthTimeoutMs?: number;
}

const FALLBACK_CONTEXT_WINDOW = 4096;
const FALLBACK_MAX_OUTPUT_TOKENS = 2048;

export class OpenAICompatibleBackend implements Backend {
  constructor(private opts: OpenAICompatibleOptions) {}

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
        `${this.opts.baseUrl}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.opts.model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: opts.maxOutputTokens,
            temperature: opts.temperature
          })
        },
        timeoutMs
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new BackendTimeoutError(`OpenAI-compatible backend didn't respond in ${timeoutMs}ms`);
      }
      throw err;
    }

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400 && /context|too long/i.test(body)) {
        throw new ContextExceededError(body);
      }
      throw new Error(`Backend responded ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      text: data.choices[0].message.content,
      usage: {
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
        elapsedMs: Date.now() - start
      }
    };
  }

  async getCapabilities(): Promise<Capabilities> {
    return {
      contextWindow: this.opts.contextWindowOverride ?? FALLBACK_CONTEXT_WINDOW,
      maxOutputTokens: this.opts.maxOutputTokensOverride ?? FALLBACK_MAX_OUTPUT_TOKENS
    };
  }

  async checkHealth(): Promise<HealthStatus> {
    const timeoutMs = this.opts.healthTimeoutMs ?? 10_000;
    let res: Response;
    try {
      res = await this.fetchWithTimeout(`${this.opts.baseUrl}/v1/models`, { method: 'GET' }, timeoutMs);
    } catch {
      return { status: 'unreachable', detail: `No se pudo conectar a ${this.opts.baseUrl}` };
    }

    if (!res.ok) {
      return { status: 'unreachable', detail: `Backend responded ${res.status} at ${this.opts.baseUrl}` };
    }

    const data = (await res.json()) as { data: { id: string }[] };
    const availableModels = data.data.map((m) => m.id);

    if (!this.opts.model || !availableModels.includes(this.opts.model)) {
      return {
        status: 'model_not_loaded',
        detail: `Model "${this.opts.model || '(not set)'}" is not available`,
        availableModels
      };
    }

    return { status: 'ok', model: this.opts.model };
  }
}
