import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyTransform, UnsupportedSchemaVersionError } from '../../src/tools/apply-transform.js';
import { sha256 } from '../../src/hash.js';
import { RESULT_SCHEMA_VERSION } from '../../src/tools/delegate-transform.js';

function writeResult(root: string, resultRelPath: string, files: any[]) {
  fs.mkdirSync(path.join(root, '.sherpa'), { recursive: true });
  fs.writeFileSync(
    path.join(root, resultRelPath),
    JSON.stringify({ schemaVersion: RESULT_SCHEMA_VERSION, files }, null, 2)
  );
}

describe('applyTransform', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-apply-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes the exact proposedContent for an unchanged-on-disk file', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'original\n');
    writeResult(root, '.sherpa/r.json', [
      { path: 'a.txt', originalHash: sha256('original\n'), proposedContent: 'changed\n', diff: '' }
    ]);

    const result = applyTransform(root, '.sherpa/r.json');

    expect(result).toEqual({ applied: ['a.txt'], stale: [], skipped: [], failed: [] });
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('changed\n');
  });

  it('marks a file stale (and does not write it) when the on-disk hash no longer matches', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'edited by someone else\n');
    writeResult(root, '.sherpa/r.json', [
      { path: 'a.txt', originalHash: sha256('original\n'), proposedContent: 'changed\n', diff: '' }
    ]);

    const result = applyTransform(root, '.sherpa/r.json');

    expect(result.stale).toEqual(['a.txt']);
    expect(result.applied).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('edited by someone else\n');
  });

  it('filters to only the given paths, skipping the rest', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'A\n');
    fs.writeFileSync(path.join(root, 'b.txt'), 'B\n');
    writeResult(root, '.sherpa/r.json', [
      { path: 'a.txt', originalHash: sha256('A\n'), proposedContent: 'A2\n', diff: '' },
      { path: 'b.txt', originalHash: sha256('B\n'), proposedContent: 'B2\n', diff: '' }
    ]);

    const result = applyTransform(root, '.sherpa/r.json', ['a.txt']);

    expect(result.applied).toEqual(['a.txt']);
    expect(result.skipped).toEqual(['b.txt']);
  });

  it('throws UnsupportedSchemaVersionError on a schema mismatch', () => {
    fs.mkdirSync(path.join(root, '.sherpa'), { recursive: true });
    fs.writeFileSync(path.join(root, '.sherpa/r.json'), JSON.stringify({ schemaVersion: 999, files: [] }));

    expect(() => applyTransform(root, '.sherpa/r.json')).toThrow(UnsupportedSchemaVersionError);
  });

  it('reports a failed file without aborting the rest of the batch', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'A\n');
    fs.writeFileSync(path.join(root, 'b.txt'), 'B\n');
    fs.chmodSync(path.join(root, 'b.txt'), 0o444); // read-only -> write should fail

    writeResult(root, '.sherpa/r.json', [
      { path: 'a.txt', originalHash: sha256('A\n'), proposedContent: 'A2\n', diff: '' },
      { path: 'b.txt', originalHash: sha256('B\n'), proposedContent: 'B2\n', diff: '' }
    ]);

    const result = applyTransform(root, '.sherpa/r.json');

    expect(result.applied).toEqual(['a.txt']);
    expect(result.failed).toEqual([{ path: 'b.txt', reason: 'write_error' }]);

    fs.chmodSync(path.join(root, 'b.txt'), 0o644); // restore for cleanup
  });

  it('routes a per-entry path escape (files[].path outside the project root) to failed, without crashing or applying it', () => {
    writeResult(root, '.sherpa/r.json', [
      { path: '../../../tmp/pwned', originalHash: sha256('irrelevant'), proposedContent: 'pwned\n', diff: '' }
    ]);

    const result = applyTransform(root, '.sherpa/r.json');

    expect(result).toEqual({
      applied: [],
      stale: [],
      skipped: [],
      failed: [{ path: '../../../tmp/pwned', reason: 'outside_project_root' }]
    });
  });

  it('reports a read_error when the target file cannot be read even though its path resolves within root', () => {
    // POSIX-only: chmod 000 makes the file unreadable to non-root users. If tests run as
    // root this read will still succeed and this assertion will fail — that's expected.
    fs.writeFileSync(path.join(root, 'c.txt'), 'C\n');
    fs.chmodSync(path.join(root, 'c.txt'), 0o000);

    writeResult(root, '.sherpa/r.json', [
      { path: 'c.txt', originalHash: sha256('C\n'), proposedContent: 'C2\n', diff: '' }
    ]);

    const result = applyTransform(root, '.sherpa/r.json');

    expect(result.failed).toEqual([{ path: 'c.txt', reason: 'read_error' }]);
    expect(result.applied).toEqual([]);

    fs.chmodSync(path.join(root, 'c.txt'), 0o644); // restore for cleanup
  });
});
