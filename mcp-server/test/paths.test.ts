import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectRoot, resolveWithinRoot } from '../src/paths.js';

describe('resolveProjectRoot', () => {
  it('throws when cwd is the filesystem root', () => {
    expect(() => resolveProjectRoot('/')).toThrow(/too broad/);
  });

  it('throws when cwd is the user home directory', () => {
    expect(() => resolveProjectRoot(os.homedir())).toThrow(/too broad/);
  });

  it('returns the realpath for a normal project directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-root-'));
    expect(resolveProjectRoot(dir)).toBe(fs.realpathSync(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('resolveWithinRoot', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-root-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-outside-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('resolves a plain relative path inside root', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'hi');
    const resolved = resolveWithinRoot(root, 'a.txt');
    expect(resolved).toBe(fs.realpathSync(path.join(root, 'a.txt')));
  });

  it('rejects a path that escapes via ..', () => {
    const resolved = resolveWithinRoot(root, '../outside.txt');
    expect(resolved).toBeNull();
  });

  it('rejects a symlink that points outside root', () => {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    const resolved = resolveWithinRoot(root, 'link.txt');
    expect(resolved).toBeNull();
  });

  it('resolves a not-yet-existing file inside root (for write targets)', () => {
    const resolved = resolveWithinRoot(root, 'new-file.txt');
    expect(resolved).toBe(path.join(fs.realpathSync(root), 'new-file.txt'));
  });

  it('resolves the root itself (target ".") instead of rejecting it', () => {
    const resolved = resolveWithinRoot(root, '.');
    expect(resolved).toBe(fs.realpathSync(root));
  });

  it('rejects a dangling symlink (target does not exist)', () => {
    fs.symlinkSync(
      path.join(outside, 'does-not-exist.txt'),
      path.join(root, 'danglinglink')
    );
    const resolved = resolveWithinRoot(root, 'danglinglink');
    expect(resolved).toBeNull();
  });
});
