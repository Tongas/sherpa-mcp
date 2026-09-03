export interface FileContent {
  path: string;
  content: string;
}

export interface ChunkPlan {
  chunks: FileContent[][];
  skipped: { path: string; reason: string }[];
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function planChunks(files: FileContent[], contextWindow: number, reserveTokens: number): ChunkPlan {
  const budget = contextWindow - reserveTokens;
  const skipped: { path: string; reason: string }[] = [];
  const chunks: FileContent[][] = [];
  let current: FileContent[] = [];
  let currentTokens = 0;

  for (const file of files) {
    const fileTokens = estimateTokens(file.content);
    if (fileTokens > budget) {
      skipped.push({ path: file.path, reason: 'exceeds_context_window' });
      continue;
    }
    if (currentTokens + fileTokens > budget && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(file);
    currentTokens += fileTokens;
  }
  if (current.length > 0) chunks.push(current);

  return { chunks, skipped };
}
