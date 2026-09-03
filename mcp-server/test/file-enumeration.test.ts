import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enumerateFiles } from '../src/file-enumeration.js';

describe('enumerateFiles', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-enum-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a');
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'b');
    fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'ignored');
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'out.js'), 'ignored');
    fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('walks a directory and returns files, skipping node_modules and .gitignore matches', () => {
    const result = enumerateFiles(root, ['src', 'dist', 'node_modules'], 100, '.sherpa');
    const relPaths = result.files.map((f) => path.relative(root, f)).sort();
    expect(relPaths).toEqual([path.join('src', 'a.ts'), path.join('src', 'b.ts')]);
  });

  it('accepts a single file path directly', () => {
    const result = enumerateFiles(root, [path.join('src', 'a.ts')], 100, '.sherpa');
    expect(result.files).toHaveLength(1);
  });

  it('reports outside-root paths as skipped with reason outside_project_root', () => {
    const result = enumerateFiles(root, ['../escape.ts'], 100, '.sherpa');
    expect(result.filesSkipped).toEqual([{ path: '../escape.ts', reason: 'outside_project_root' }]);
  });

  it('reports a nonexistent path as skipped with reason not_found', () => {
    const result = enumerateFiles(root, ['nope.ts'], 100, '.sherpa');
    expect(result.filesSkipped).toEqual([{ path: 'nope.ts', reason: 'not_found' }]);
  });

  it('sets truncatedByBudget and caps the file list at maxFiles', () => {
    const result = enumerateFiles(root, ['src'], 1, '.sherpa');
    expect(result.files).toHaveLength(1);
    expect(result.truncatedByBudget).toBe(true);
  });

  it('always excludes resultsDir, even when .gitignore does not list it', () => {
    fs.mkdirSync(path.join(root, '.sherpa'));
    fs.writeFileSync(path.join(root, '.sherpa', 'exploration-old.md'), 'previous run output');
    const result = enumerateFiles(root, ['src', '.sherpa'], 100, '.sherpa');
    const relPaths = result.files.map((f) => path.relative(root, f)).sort();
    expect(relPaths).toEqual([path.join('src', 'a.ts'), path.join('src', 'b.ts')]);
  });
});
