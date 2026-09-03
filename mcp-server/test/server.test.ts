import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '../src/server.js';
import type { SherpaConfig } from '../src/config.js';

function makeConfig(): SherpaConfig {
  return {
    backend: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'test-model',
    maxFiles: 100,
    maxChunks: 20,
    resultsDir: '.sherpa',
    truncationThreshold: 0.75
  };
}

describe('createServer', () => {
  it('constructs an McpServer without throwing, for a valid root and config', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-server-'));
    const config = makeConfig();

    const server = createServer(root, config);

    expect(server).toBeInstanceOf(McpServer);
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('tool registration', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('registers exactly the five expected tool names', () => {
      const registeredNames: string[] = [];
      // McpServer has no public introspection API for registered tool names
      // (the SDK's `_registeredTools` map is private), so spy on `tool()` itself.
      const toolSpy = vi.spyOn(McpServer.prototype, 'tool').mockImplementation(function (
        this: McpServer,
        name: string,
        ...rest: unknown[]
      ) {
        registeredNames.push(name);
        return undefined as any;
      });

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-server-'));
      createServer(root, makeConfig());
      fs.rmSync(root, { recursive: true, force: true });

      expect(toolSpy).toHaveBeenCalled();
      expect(registeredNames).toEqual([
        'health_check',
        'delegate_exploration',
        'delegate_search',
        'delegate_transform',
        'apply_transform'
      ]);
    });

    it('reuses one Backend instance per model across calls, so OllamaBackend.getCapabilities() cache hits', async () => {
      const handlers: Record<string, (args: any) => Promise<any>> = {};
      vi.spyOn(McpServer.prototype, 'tool').mockImplementation(function (
        this: McpServer,
        name: string,
        ...rest: unknown[]
      ) {
        handlers[name] = rest[rest.length - 1] as (args: any) => Promise<any>;
        return undefined as any;
      });

      const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/api/tags')) return jsonResponse({ models: [{ name: 'test-model' }] });
        if (url.endsWith('/api/show')) return jsonResponse({ model_info: { 'x.context_length': 32768 } });
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-server-'));
      createServer(root, makeConfig());
      fs.rmSync(root, { recursive: true, force: true });

      await handlers.health_check({});
      const callsAfterFirst = fetchMock.mock.calls.length;
      await handlers.health_check({});
      const callsAfterSecond = fetchMock.mock.calls.length;

      // First call: checkHealth() + getCapabilities()'s internal checkHealth() = 2x /api/tags,
      // plus a cache-miss /api/show = 3 fetches. A reused instance means the second call's
      // getCapabilities() hits its cache and skips /api/show, adding only 2 fetches, not 3.
      expect(callsAfterFirst).toBe(3);
      expect(callsAfterSecond - callsAfterFirst).toBe(2);

      vi.unstubAllGlobals();
    });
  });
});
