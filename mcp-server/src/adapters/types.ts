export interface TokenUsage {
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
}

export interface GenerateOpts {
  maxOutputTokens?: number;
  temperature?: number;
}

export interface Capabilities {
  contextWindow: number;
  maxOutputTokens: number;
}

export type HealthStatus =
  | { status: 'ok'; model: string }
  | { status: 'unreachable'; detail: string }
  | { status: 'model_not_loaded'; detail: string; availableModels: string[] };

export class BackendTimeoutError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'BackendTimeoutError';
  }
}

export class ContextExceededError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ContextExceededError';
  }
}

export interface Backend {
  generate(prompt: string, opts: GenerateOpts): Promise<{ text: string; usage: TokenUsage }>;
  getCapabilities(): Promise<Capabilities>;
  checkHealth(): Promise<HealthStatus>;
}
