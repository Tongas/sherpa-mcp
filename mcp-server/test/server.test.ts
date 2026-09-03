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
  });
});
