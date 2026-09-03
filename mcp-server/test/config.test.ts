import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns defaults with zero files and empty env', () => {
    const config = loadConfig(root, { env: {} });
    expect(config).toEqual({
      backend: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: undefined,
      maxFiles: 100,
      maxChunks: 20,
      resultsDir: '.sherpa',
      truncationThreshold: 0.75,
      contextWindowOverride: undefined,
      maxOutputTokensOverride: undefined
    });
  });

  it('works with only SHERPA_BASE_URL and SHERPA_MODEL set (zero-file minimum)', () => {
    const config = loadConfig(root, {
      env: { SHERPA_BASE_URL: 'http://localhost:8080', SHERPA_MODEL: 'qwen2.5-coder' }
    });
    expect(config.baseUrl).toBe('http://localhost:8080');
    expect(config.model).toBe('qwen2.5-coder');
    expect(config.backend).toBe('ollama');
  });

  it('project config overrides user config', () => {
    const userConfigPath = path.join(root, 'user-config.json');
    fs.writeFileSync(userConfigPath, JSON.stringify({ maxFiles: 50 }));
    fs.writeFileSync(path.join(root, 'sherpa.config.json'), JSON.stringify({ maxFiles: 10 }));

    const config = loadConfig(root, { env: {}, userConfigPath });
    expect(config.maxFiles).toBe(10);
  });

  it('env overrides project config', () => {
    fs.writeFileSync(path.join(root, 'sherpa.config.json'), JSON.stringify({ maxFiles: 10 }));

    const config = loadConfig(root, { env: { SHERPA_MAX_FILES: '5' } });
    expect(config.maxFiles).toBe(5);
  });

  it('parses numeric overrides from env', () => {
    const config = loadConfig(root, {
      env: {
        SHERPA_MAX_CHUNKS: '3',
        SHERPA_TRUNCATION_THRESHOLD: '0.9',
        SHERPA_CONTEXT_WINDOW: '8192',
        SHERPA_MAX_OUTPUT_TOKENS: '2048'
      }
    });
    expect(config.maxChunks).toBe(3);
    expect(config.truncationThreshold).toBe(0.9);
    expect(config.contextWindowOverride).toBe(8192);
    expect(config.maxOutputTokensOverride).toBe(2048);
  });

  it('throws on an invalid SHERPA_BACKEND value', () => {
    expect(() => loadConfig(root, { env: { SHERPA_BACKEND: 'bogus' } })).toThrow(
      /SHERPA_BACKEND/
    );
  });

  it('throws on a non-numeric SHERPA_MAX_FILES value', () => {
    expect(() => loadConfig(root, { env: { SHERPA_MAX_FILES: 'abc' } })).toThrow(
      /SHERPA_MAX_FILES/
    );
  });
});
