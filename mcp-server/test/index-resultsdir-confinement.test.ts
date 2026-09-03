import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateResultsDir } from '../src/index.js';

describe('validateResultsDir', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sherpa-root-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not throw for a plain relative resultsDir inside root', () => {
    expect(() => validateResultsDir(root, '.sherpa')).not.toThrow();
  });

  it('does not throw for a nested relative resultsDir inside root', () => {
    expect(() => validateResultsDir(root, 'nested/.sherpa')).not.toThrow();
  });

  it('throws when resultsDir escapes the root via ..', () => {
    expect(() => validateResultsDir(root, '../../somewhere')).toThrow(
      /SHERPA_RESULTS_DIR/
    );
  });
});
