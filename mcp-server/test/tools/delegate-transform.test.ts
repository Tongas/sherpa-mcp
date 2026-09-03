import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { delegateTransform, RESULT_SCHEMA_VERSION } from '../../src/tools/delegate-transform.js';
import type { Backend } from '../../src/adapters/types.js';

function fakeBackend(response: string): Backend {
  return {
    generate: async () => ({ text: response, usage: { tokensIn: 5, tokensOut: 5, elapsedMs: 1 } }),
    getCapabilities: async () => ({ contextWindow: 100_000, maxOutputTokens: 2000 }),
    checkHealth: async () => ({ status: 'ok', model: 'test-model' })
  };
}

describe('delegateTransform', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-transform-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('marks a file would_change and writes a resultPath with schemaVersion and originalHash', async () => {
    fs.writeFileSync(path.join(root, 'a.json'), '{"a": 1}\n');
    const backend = fakeBackend('{"a": 2}\n');

    const result = await delegateTransform(backend, root, '.sherpa', 0.75, {
      paths: ['a.json'],
      instruction: 'change the value of a to 2'
    });

    expect(result.results).toEqual([{ path: 'a.json', status: 'would_change', diffPreview: expect.any(String) }]);

    const written = JSON.parse(fs.readFileSync(path.join(root, result.resultPath), 'utf8'));
    expect(written.schemaVersion).toBe(RESULT_SCHEMA_VERSION);
    expect(written.files).toHaveLength(1);
    expect(written.files[0].proposedContent).toBe('{"a": 2}\n');
    expect(written.files[0].originalHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks unchanged when the model returns identical content', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'same\n');
    const backend = fakeBackend('same\n');

    const result = await delegateTransform(backend, root, '.sherpa', 0.75, {
      paths: ['a.txt'],
      instruction: 'no cambies nada'
    });

    expect(result.results).toEqual([{ path: 'a.txt', status: 'unchanged' }]);
  });

  it('rejects when output is shorter than the truncation threshold', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n'));
    const backend = fakeBackend('line 0\nline 1'); // 2 of 10 lines: well under 0.75

    const result = await delegateTransform(backend, root, '.sherpa', 0.75, {
      paths: ['a.txt'],
      instruction: 'no borres nada'
    });

    expect(result.results).toEqual([
      { path: 'a.txt', status: 'rejected', reason: 'output_possibly_truncated' }
    ]);
  });

  it('rejects when syntax validation fails, without retrying', async () => {
    fs.writeFileSync(path.join(root, 'a.json'), '{"a": 1}\n');
    const backend = fakeBackend('{"a": 2\n'); // invalid JSON, same line count

    const result = await delegateTransform(backend, root, '.sherpa', 0.75, {
      paths: ['a.json'],
      instruction: 'change the value'
    });

    expect(result.results).toEqual([
      { path: 'a.json', status: 'rejected', reason: 'syntax_validation_failed' }
    ]);
  });

  it('rejects paths outside the project root', async () => {
    const backend = fakeBackend('anything');
    const result = await delegateTransform(backend, root, '.sherpa', 0.75, {
      paths: ['../outside.txt'],
      instruction: 'x'
    });
    expect(result.results).toEqual([
      { path: '../outside.txt', status: 'rejected', reason: 'outside_project_root' }
    ]);
  });

  it('returns early with unreachable status when the backend is unhealthy, without calling getCapabilities/generate', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'hello\n');
    let capabilitiesCalled = false;
    let generateCalled = false;
    const backend: Backend = {
      generate: async () => {
        generateCalled = true;
        return { text: '', usage: { tokensIn: 0, tokensOut: 0, elapsedMs: 0 } };
      },
      getCapabilities: async () => {
        capabilitiesCalled = true;
        return { contextWindow: 0, maxOutputTokens: 0 };
      },
      checkHealth: async () => ({ status: 'unreachable', detail: 'connection refused' })
    };

    const result = await delegateTransform(backend, root, '.sherpa', 0.75, {
      paths: ['a.txt'],
      instruction: 'x'
    });

    expect(result).toEqual({ status: 'unreachable', detail: 'connection refused' });
    expect(capabilitiesCalled).toBe(false);
    expect(generateCalled).toBe(false);
  });

  it('returns early with model_not_loaded status and availableModels when the backend model is not loaded', async () => {
    const backend: Backend = {
      generate: async () => ({ text: '', usage: { tokensIn: 0, tokensOut: 0, elapsedMs: 0 } }),
      getCapabilities: async () => ({ contextWindow: 0, maxOutputTokens: 0 }),
      checkHealth: async () => ({
        status: 'model_not_loaded',
        detail: 'model not found',
        availableModels: ['a', 'b']
      })
    };

    const result = await delegateTransform(backend, root, '.sherpa', 0.75, {
      paths: ['a.txt'],
      instruction: 'x'
    });

    expect(result).toEqual({
      status: 'model_not_loaded',
      detail: 'model not found',
      availableModels: ['a', 'b']
    });
  });
});
