import fs from 'node:fs';
import path from 'node:path';
import * as ignoreModule from 'ignore';
import type { Ignore } from 'ignore';
import { resolveWithinRoot } from './paths.js';

// Cast works around a TypeScript CJS/ESM interop issue in ignore@5.3.2
// (CommonJS runtime, but its .d.ts declares an ESM `export default`).
const ignore = (ignoreModule as unknown as { default: (options?: unknown) => Ignore }).default;

export interface EnumerationResult {
  files: string[];
  filesSkipped: { path: string; reason: string }[];
  truncatedByBudget: boolean;
}

function loadIgnoreRules(root: string): Ignore {
  const ig = ignore();
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf8'));
  }
  ig.add(['.git', 'node_modules']);
  return ig;
}

function walk(dir: string, root: string, ig: Ignore, out: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (ig.ignores(rel)) continue;
    if (entry.isDirectory()) {
      walk(full, root, ig, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

export function enumerateFiles(root: string, inputPaths: string[], maxFiles: number): EnumerationResult {
  const ig = loadIgnoreRules(root);
  const filesSkipped: { path: string; reason: string }[] = [];
  const collected: string[] = [];

  for (const inputPath of inputPaths) {
    const resolved = resolveWithinRoot(root, inputPath);
    if (!resolved) {
      filesSkipped.push({ path: inputPath, reason: 'outside_project_root' });
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      filesSkipped.push({ path: inputPath, reason: 'not_found' });
      continue;
    }

    if (stat.isDirectory()) {
      walk(resolved, root, ig, collected);
    } else if (stat.isFile()) {
      const rel = path.relative(root, resolved);
      if (!ig.ignores(rel)) collected.push(resolved);
    }
  }

  const unique = Array.from(new Set(collected));
  const truncatedByBudget = unique.length > maxFiles;
  const files = truncatedByBudget ? unique.slice(0, maxFiles) : unique;

  return { files, filesSkipped, truncatedByBudget };
}
