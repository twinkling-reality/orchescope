/**
 * Runs a corpus entry so the declared graph can be joined to a real run.
 *
 * The declared against exercised delta is the centre of this product, and until now it had only ever been shown on
 * the demonstration this repository also wrote. An entry that declares an `exercise` block is one that can be made to
 * emit spans: the packages are installed into a virtual environment under the ignored cache, the script is run through
 * `orchescope trace`, and the audit that follows has a stored run to reconcile against.
 *
 * This executes third party code and reaches a package index, so it never happens unless it is asked for.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDirectory } from './checkout.mjs';

const MARKER = 'orchescope-corpus-environment.json';

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

/**
 * The environment is rebuilt only when the package list changes, because installing it takes longer than every other
 * part of a corpus run put together. The marker records the list that produced the environment that is there.
 */
export const prepareEnvironment = (root, entry, checkout) => {
  const directory = join(cacheDirectory(root), 'venvs', entry.name);
  const python = join(directory, 'bin/python');
  const marker = join(directory, MARKER);
  const wanted = `${JSON.stringify(entry.exercise.pythonPackages)}\n`;
  if (existsSync(python) && existsSync(marker) && readFileSync(marker, 'utf8') === wanted) {
    return python;
  }

  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  run('python3', ['-m', 'venv', directory]);
  const environment = { ...process.env, ...(entry.exercise.buildEnvironment ?? {}) };
  /*
   * One at a time and in the order the entry lists them. A checkout pins its sibling packages by an exact version, so
   * a package that another one depends on has to be installed from the checkout before the one that wants it.
   */
  for (const packageName of entry.exercise.pythonPackages) {
    const target = packageName.includes('/') ? ['-e', join(checkout, packageName)] : [packageName];
    run(python, ['-m', 'pip', 'install', '--quiet', ...target], { env: environment });
  }
  writeFileSync(marker, wanted, { mode: 0o644 });
  return python;
};

/** Returns what the run produced, so a corpus summary can say whether spans arrived at all. */
export const exerciseRepository = (root, entry, checkout, python) => {
  const output = run(
    'node',
    [
      join(root, 'apps/cli/src/main.ts'),
      '--cwd',
      checkout,
      'trace',
      '--json',
      '--',
      python,
      join(root, entry.exercise.script),
      checkout,
    ],
    { cwd: root, env: { ...process.env, NO_COLOR: '1' } },
  );
  const document = JSON.parse(output);
  if (document.ok !== true) {
    throw new Error(
      `the exercise of ${entry.name} failed: ${document.error?.message ?? 'no message'}`,
    );
  }
  return { runs: 1, spans: document.data.spanCount };
};
