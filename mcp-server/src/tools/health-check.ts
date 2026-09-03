import type { Backend } from '../adapters/types.js';

export interface HealthCheckResult {
  status: 'ok' | 'unreachable' | 'model_not_loaded';
  model?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  detail?: string;
  availableModels?: string[];
}

export async function healthCheck(backend: Backend): Promise<HealthCheckResult> {
  const health = await backend.checkHealth();
  if (health.status !== 'ok') {
    return health;
  }
  const capabilities = await backend.getCapabilities();
  return {
    status: 'ok',
    model: health.model,
    contextWindow: capabilities.contextWindow,
    maxOutputTokens: capabilities.maxOutputTokens
  };
}
