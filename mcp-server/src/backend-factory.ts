import type { Backend } from './adapters/types.js';
import type { SherpaConfig } from './config.js';
import { OllamaBackend } from './adapters/ollama.js';
import { OpenAICompatibleBackend } from './adapters/openai-compatible.js';

export function createBackend(config: SherpaConfig, modelOverride?: string): Backend {
  const model = modelOverride ?? config.model ?? '';
  if (config.backend === 'ollama') {
    return new OllamaBackend({ baseUrl: config.baseUrl, model });
  }
  return new OpenAICompatibleBackend({
    baseUrl: config.baseUrl,
    model,
    contextWindowOverride: config.contextWindowOverride,
    maxOutputTokensOverride: config.maxOutputTokensOverride
  });
}
