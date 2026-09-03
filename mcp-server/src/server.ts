import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SherpaConfig } from './config.js';
import type { Backend } from './adapters/types.js';
import { createBackend } from './backend-factory.js';
import { healthCheck } from './tools/health-check.js';
import { delegateExploration } from './tools/delegate-exploration.js';
import { delegateSearch } from './tools/delegate-search.js';
import { delegateTransform } from './tools/delegate-transform.js';
import { applyTransform } from './tools/apply-transform.js';

export function createServer(root: string, config: SherpaConfig): McpServer {
  const server = new McpServer({ name: 'sherpa', version: '0.1.0' });

  // One Backend instance per distinct model override, reused across tool
  // calls for the life of this process. This is what makes OllamaBackend's
  // getCapabilities() cache (keyed on the model it last saw) actually do
  // something — a fresh instance per call would always start with an empty
  // cache and redo the /api/show round trip every time. Backend instances
  // hold no other call-scoped state, so reusing them across calls/tools is
  // safe: checkHealth()/getCapabilities() still hit the network live on
  // every call, this only skips the now-redundant capability lookup.
  const backends = new Map<string, Backend>();
  function getBackend(modelOverride?: string): Backend {
    const key = modelOverride ?? '';
    let backend = backends.get(key);
    if (!backend) {
      backend = createBackend(config, modelOverride);
      backends.set(key, backend);
    }
    return backend;
  }

  server.tool(
    'health_check',
    'Checks whether the local backend (Ollama/llama.cpp/LM Studio) is available and which model is loaded. ' +
      "Use it before delegating if you're not sure sherpa is available.",
    { model: z.string().optional() },
    async ({ model }) => {
      const backend = getBackend(model);
      const result = await healthCheck(backend);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delegate_exploration',
    'Delegates to a local model the reading and synthesis of findings over a set of project files/directories, ' +
      "without that content entering the orchestrator's context.",
    { paths: z.array(z.string()), instruction: z.string(), model: z.string().optional() },
    async ({ paths, instruction, model }) => {
      const backend = getBackend(model);
      const result = await delegateExploration(
        backend,
        root,
        config.resultsDir,
        { maxFiles: config.maxFiles, maxChunks: config.maxChunks },
        { paths, instruction }
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delegate_search',
    'Runs ripgrep over project paths and delegates to a local model the synthesis of the matches ' +
      'according to the given instruction.',
    { pattern: z.string(), paths: z.array(z.string()), instruction: z.string(), model: z.string().optional() },
    async ({ pattern, paths, instruction, model }) => {
      const backend = getBackend(model);
      const result = await delegateSearch(
        backend,
        root,
        config.resultsDir,
        { maxFiles: config.maxFiles, maxChunks: config.maxChunks },
        { pattern, paths, instruction }
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'delegate_transform',
    'Generates, via a local model, a proposed batch transformation over the given files. ' +
      "Doesn't write to disk — the result is reviewed and applied with apply_transform.",
    { paths: z.array(z.string()), instruction: z.string(), model: z.string().optional() },
    async ({ paths, instruction, model }) => {
      const backend = getBackend(model);
      const result = await delegateTransform(
        backend,
        root,
        config.resultsDir,
        config.truncationThreshold,
        { paths, instruction }
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'apply_transform',
    'Applies to the filesystem the changes proposed by a prior delegate_transform, exactly as they were ' +
      'reviewed — without regenerating anything.',
    { resultPath: z.string(), paths: z.array(z.string()).optional() },
    async ({ resultPath, paths }) => {
      const result = applyTransform(root, resultPath, paths);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  return server;
}
