import type { Backend } from './adapters/types.js';
import type { FileContent } from './chunking.js';

export interface MapReduceUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  elapsedMs: number;
}

export interface MapReduceResult {
  finalText: string;
  usage: MapReduceUsage;
  usedChunkCount: number;
  truncatedByChunkBudget: boolean;
  droppedChunks: FileContent[][];
}

/**
 * Shared map-reduce runner used by delegate_exploration and delegate_search:
 * slices `chunks` down to `budgetConfig.maxChunks`, sends one map call per
 * used chunk, and — only if more than one chunk was used — a final reduce
 * call over the partial results. Usage (calls/tokens/elapsed) is summed
 * across every call made.
 */
export async function runMapReduce(
  backend: Backend,
  chunks: FileContent[][],
  budgetConfig: { maxChunks: number },
  buildMapPrompt: (chunk: FileContent[]) => string,
  buildReducePrompt: (partials: string[]) => string,
  generateOpts: { maxOutputTokens: number },
  emptyText: string
): Promise<MapReduceResult> {
  const usedChunks = chunks.slice(0, budgetConfig.maxChunks);
  const droppedChunks = chunks.slice(budgetConfig.maxChunks);
  const truncatedByChunkBudget = chunks.length > budgetConfig.maxChunks;

  let calls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let elapsedMs = 0;
  const partials: string[] = [];

  for (const chunk of usedChunks) {
    const { text, usage } = await backend.generate(buildMapPrompt(chunk), generateOpts);
    calls++;
    tokensIn += usage.tokensIn;
    tokensOut += usage.tokensOut;
    elapsedMs += usage.elapsedMs;
    partials.push(text);
  }

  let finalText: string;
  if (partials.length === 0) {
    finalText = emptyText;
  } else if (partials.length === 1) {
    finalText = partials[0];
  } else {
    const { text, usage } = await backend.generate(buildReducePrompt(partials), generateOpts);
    calls++;
    tokensIn += usage.tokensIn;
    tokensOut += usage.tokensOut;
    elapsedMs += usage.elapsedMs;
    finalText = text;
  }

  return {
    finalText,
    usage: { calls, tokensIn, tokensOut, elapsedMs },
    usedChunkCount: usedChunks.length,
    truncatedByChunkBudget,
    droppedChunks
  };
}
