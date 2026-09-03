import fs from 'node:fs';
import { resolveWithinRoot } from '../paths.js';
import { sha256 } from '../hash.js';
import { RESULT_SCHEMA_VERSION } from './delegate-transform.js';

export class UnsupportedSchemaVersionError extends Error {
  constructor(found: number, expected: number) {
    super(
      `resultPath has schemaVersion ${found}, this version of sherpa supports ${expected}. ` +
        `Re-run delegate_transform.`
    );
    this.name = 'UnsupportedSchemaVersionError';
  }
}

export interface ApplyTransformResult {
  applied: string[];
  stale: string[];
  skipped: string[];
  failed: { path: string; reason: string }[];
}

interface ResultFileEntry {
  path: string;
  originalHash: string;
  proposedContent: string;
  diff: string;
}

export function applyTransform(root: string, resultPath: string, paths?: string[]): ApplyTransformResult {
  const resolvedResultPath = resolveWithinRoot(root, resultPath);
  if (!resolvedResultPath) {
    throw new Error(`resultPath outside the project root: ${resultPath}`);
  }

  const raw = fs.readFileSync(resolvedResultPath, 'utf8');
  const data = JSON.parse(raw) as { schemaVersion: number; files: ResultFileEntry[] };

  if (data.schemaVersion !== RESULT_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(data.schemaVersion, RESULT_SCHEMA_VERSION);
  }

  const filter = paths ? new Set(paths) : null;
  const applied: string[] = [];
  const stale: string[] = [];
  const skipped: string[] = [];
  const failed: { path: string; reason: string }[] = [];

  for (const entry of data.files) {
    if (filter && !filter.has(entry.path)) {
      skipped.push(entry.path);
      continue;
    }

    const resolvedTarget = resolveWithinRoot(root, entry.path);
    if (!resolvedTarget) {
      failed.push({ path: entry.path, reason: 'outside_project_root' });
      continue;
    }

    let currentContent: string;
    try {
      currentContent = fs.readFileSync(resolvedTarget, 'utf8');
    } catch {
      failed.push({ path: entry.path, reason: 'read_error' });
      continue;
    }

    if (sha256(currentContent) !== entry.originalHash) {
      stale.push(entry.path);
      continue;
    }

    try {
      fs.writeFileSync(resolvedTarget, entry.proposedContent, 'utf8');
      applied.push(entry.path);
    } catch {
      failed.push({ path: entry.path, reason: 'write_error' });
    }
  }

  return { applied, stale, skipped, failed };
}
