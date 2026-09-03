import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface SherpaConfig {
  backend: 'ollama' | 'openai-compatible';
  baseUrl: string;
  model?: string;
  maxFiles: number;
  maxChunks: number;
  resultsDir: string;
  truncationThreshold: number;
  contextWindowOverride?: number;
  maxOutputTokensOverride?: number;
}

const DEFAULTS: SherpaConfig = {
  backend: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: undefined,
  maxFiles: 100,
  maxChunks: 20,
  resultsDir: '.sherpa',
  truncationThreshold: 0.75,
  contextWindowOverride: undefined,
  maxOutputTokensOverride: undefined
};

function readJsonIfExists(filePath: string): Partial<SherpaConfig> {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<SherpaConfig>;
}

function parseNumericEnv(envVarName: string, rawValue: string): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(
      `sherpa: invalid value for ${envVarName}: "${rawValue}" is not a finite number.`
    );
  }
  return value;
}

export function loadConfig(
  projectRoot: string,
  opts: { env?: NodeJS.ProcessEnv; userConfigPath?: string } = {}
): SherpaConfig {
  const env = opts.env ?? process.env;
  const userConfigPath =
    opts.userConfigPath ?? path.join(os.homedir(), '.claude', 'sherpa', 'config.json');
  const projectConfigPath = path.join(projectRoot, 'sherpa.config.json');

  const userConfig = readJsonIfExists(userConfigPath);
  const projectConfig = readJsonIfExists(projectConfigPath);

  const merged: SherpaConfig = { ...DEFAULTS, ...userConfig, ...projectConfig };

  if (env.SHERPA_BACKEND) {
    if (env.SHERPA_BACKEND !== 'ollama' && env.SHERPA_BACKEND !== 'openai-compatible') {
      throw new Error(
        `sherpa: invalid value for SHERPA_BACKEND: "${env.SHERPA_BACKEND}". ` +
        `Valid values are "ollama" or "openai-compatible".`
      );
    }
    merged.backend = env.SHERPA_BACKEND;
  }
  if (env.SHERPA_BASE_URL) merged.baseUrl = env.SHERPA_BASE_URL;
  if (env.SHERPA_MODEL) merged.model = env.SHERPA_MODEL;
  if (env.SHERPA_MAX_FILES) merged.maxFiles = parseNumericEnv('SHERPA_MAX_FILES', env.SHERPA_MAX_FILES);
  if (env.SHERPA_MAX_CHUNKS) merged.maxChunks = parseNumericEnv('SHERPA_MAX_CHUNKS', env.SHERPA_MAX_CHUNKS);
  if (env.SHERPA_RESULTS_DIR) merged.resultsDir = env.SHERPA_RESULTS_DIR;
  if (env.SHERPA_TRUNCATION_THRESHOLD) {
    merged.truncationThreshold = parseNumericEnv(
      'SHERPA_TRUNCATION_THRESHOLD',
      env.SHERPA_TRUNCATION_THRESHOLD
    );
  }
  if (env.SHERPA_CONTEXT_WINDOW) {
    merged.contextWindowOverride = parseNumericEnv('SHERPA_CONTEXT_WINDOW', env.SHERPA_CONTEXT_WINDOW);
  }
  if (env.SHERPA_MAX_OUTPUT_TOKENS) {
    merged.maxOutputTokensOverride = parseNumericEnv(
      'SHERPA_MAX_OUTPUT_TOKENS',
      env.SHERPA_MAX_OUTPUT_TOKENS
    );
  }

  return merged;
}
