import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { OrchescopeError } from '@orchescope/domain';
import { Language, Parser } from 'web-tree-sitter';

/**
 * Python parser runtime.
 *
 * The grammar is the WebAssembly build that ships inside the `tree-sitter-python` package, so nothing
 * is compiled at install time on any platform. Initialisation is lazy and memoised: a repository with
 * no Python pays nothing, and a repository with Python pays about nine milliseconds once.
 */

let ready: Promise<Parser> | undefined;

const locateGrammar = (): string => {
  const require = createRequire(import.meta.url);
  try {
    const packageJson = require.resolve('tree-sitter-python/package.json');
    return join(dirname(packageJson), 'tree-sitter-python.wasm');
  } catch (error) {
    throw new OrchescopeError('UNSUPPORTED_ECOSYSTEM', 'The Python grammar could not be located.', {
      cause: error,
      remediation: 'Reinstall Orchescope so that its tree-sitter-python dependency is present.',
    });
  }
};

const create = async (): Promise<Parser> => {
  await Parser.init();
  const grammar = await Language.load(locateGrammar());
  const parser = new Parser();
  parser.setLanguage(grammar);
  return parser;
};

/**
 * Returns the shared parser. A single parser instance is correct here because parsing is synchronous
 * inside the WebAssembly instance and the analyser never holds a tree across an await.
 */
export const pythonParser = (): Promise<Parser> => {
  ready ??= create();
  return ready;
};

export const resetPythonParser = (): void => {
  ready = undefined;
};

/**
 * Diagnostic used by the doctor command: loads the grammar and parses a probe file, so a broken installation is
 * reported before an audit rather than during one.
 */
export const probePythonParser = async (): Promise<{
  readonly ok: boolean;
  readonly detail: string;
}> => {
  try {
    const parser = await pythonParser();
    const tree = parser.parse('def probe():\n    return 1\n');
    if (tree === null) return { ok: false, detail: 'the Python parser returned no tree' };
    const hasError = tree.rootNode.hasError;
    tree.delete();
    return hasError
      ? { ok: false, detail: 'the Python grammar could not parse a probe file' }
      : {
          ok: true,
          detail: `grammar loaded from ${locateGrammar().split('/').slice(-2).join('/')}`,
        };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : 'the Python grammar could not be loaded',
    };
  }
};
