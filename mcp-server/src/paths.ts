import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveProjectRoot(cwd: string): string {
  const root = fs.realpathSync(cwd);
  const home = fs.realpathSync(os.homedir());
  if (root === '/' || root === home) {
    throw new Error(
      `sherpa cannot start with ${root} as the project root — too broad to confine. ` +
      `Start the server from the project directory.`
    );
  }
  return root;
}

export function resolveWithinRoot(root: string, target: string): string | null {
  const candidate = path.resolve(root, target);

  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    // The file may not exist yet (a new write target). But it could also
    // be a dangling symlink (target doesn't exist) — in that case it's
    // NOT a legitimate new file, it's a symlink that would write through
    // it to a destination potentially outside the root. We reject it.
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        return null;
      }
    } catch {
      // Nothing exists at that path at all (not even a dangling symlink)
      // — it's a legitimate new write target, keep going.
    }
    // Resolve the parent directory and rebuild the final path.
    const parent = path.dirname(candidate);
    let realParent: string;
    try {
      realParent = fs.realpathSync(parent);
    } catch {
      return null;
    }
    real = path.join(realParent, path.basename(candidate));
  }

  const rel = path.relative(root, real);
  if (rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) {
    return null;
  }
  return real;
}
