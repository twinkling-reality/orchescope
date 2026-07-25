import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Temporary repositories for tests.
 *
 * Directories are created with owner only permissions and removed on dispose, so a failing test
 * cannot leave analysable source or a database behind in a shared temporary directory.
 */

export type TempWorkspace = {
  readonly root: string;
  readonly write: (relativePath: string, contents: string) => string;
  readonly mkdir: (relativePath: string) => string;
  readonly dispose: () => void;
};

export const createTempWorkspace = (prefix = 'orchescope-test-'): TempWorkspace => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    write: (relativePath, contents) => {
      const target = join(root, relativePath);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, contents, { mode: 0o600 });
      return target;
    },
    mkdir: (relativePath) => {
      const target = join(root, relativePath);
      mkdirSync(target, { recursive: true, mode: 0o700 });
      return target;
    },
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
};

/**
 * Writes a minimal npm project that the JavaScript adapters can analyse.
 */
export const writeNodeProject = (
  workspace: TempWorkspace,
  input: { readonly name?: string; readonly dependencies?: Record<string, string> } = {},
): void => {
  workspace.write(
    'package.json',
    `${JSON.stringify(
      {
        name: input.name ?? 'fixture-app',
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: input.dependencies ?? {},
      },
      null,
      2,
    )}\n`,
  );
};

export const writePythonProject = (
  workspace: TempWorkspace,
  input: { readonly name?: string; readonly dependencies?: readonly string[] } = {},
): void => {
  const dependencies = (input.dependencies ?? []).map((value) => `  "${value}",`).join('\n');
  workspace.write(
    'pyproject.toml',
    `[project]\nname = "${input.name ?? 'fixture-app'}"\nversion = "1.0.0"\ndependencies = [\n${dependencies}\n]\n`,
  );
};
