import vm from 'node:vm';
import path from 'node:path';

export type SyntaxValidator = (content: string) => boolean;

export const SYNTAX_VALIDATORS: Record<string, SyntaxValidator> = {
  '.json': (content) => {
    try {
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  },
  '.js': (content) => {
    try {
      new vm.Script(content);
      return true;
    } catch {
      return false;
    }
  },
  '.mjs': (content) => {
    try {
      new vm.Script(content);
      return true;
    } catch {
      return false;
    }
  },
  '.cjs': (content) => {
    try {
      new vm.Script(content);
      return true;
    } catch {
      return false;
    }
  }
};

/** null = no validator available for this extension; the guard doesn't apply. */
export function validateSyntax(filePath: string, content: string): boolean | null {
  const ext = path.extname(filePath);
  const validator = SYNTAX_VALIDATORS[ext];
  if (!validator) return null;
  return validator(content);
}
