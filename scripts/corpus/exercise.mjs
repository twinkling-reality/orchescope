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
const prepareVirtualEnvironment = (root, entry, checkout) => {
  const directory = join(cacheDirectory(root), 'venvs', entry.name);
  const python = join(directory, 'bin/python');
  const marker = join(directory, MARKER);
  const wanted = `${JSON.stringify(entry.exercise.pythonPackages)}\n`;
  if (existsSync(python) && existsSync(marker) && readFileSync(marker, 'utf8') === wanted) {
    return { interpreter: python };
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
  return { interpreter: python };
};

/**
 * A node_modules tree the checkout can resolve against, without installing into the checkout.
 *
 * Installing into a pinned third party repository would edit it, and a scan afterwards would measure something other
 * than the commit the corpus names. The tree therefore sits at the root of the cache, one directory above every
 * checkout, which is exactly where Node looks next when a bare import inside a checkout finds nothing closer. That is
 * what lets the repository's own modules import the SDK they are written against while the checkout stays untouched.
 */
const prepareNodeEnvironment = (root, entry) => {
  const directory = cacheDirectory(root);
  const marker = join(directory, `${entry.name}-${MARKER}`);
  const wanted = `${JSON.stringify(entry.exercise.nodePackages)}\n`;
  const modules = join(directory, 'node_modules');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === wanted) return { modules };

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: 'orchescope-corpus-environment', private: true }, null, 2)}\n`,
    { mode: 0o644 },
  );
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', ...entry.exercise.nodePackages], {
    cwd: directory,
    env: { ...process.env, ...(entry.exercise.buildEnvironment ?? {}) },
  });
  writeFileSync(marker, wanted, { mode: 0o644 });
  return { modules };
};

export const prepareEnvironment = (root, entry, checkout) =>
  entry.exercise.nodePackages === undefined
    ? prepareVirtualEnvironment(root, entry, checkout)
    : prepareNodeEnvironment(root, entry);

/** Returns what the run produced, so a corpus summary can say whether spans arrived at all. */
export const exerciseRepository = (root, entry, checkout, environment) => {
  const script = join(root, entry.exercise.script);
  const command =
    environment.interpreter === undefined
      ? ['node', script, checkout, environment.modules]
      : [environment.interpreter, script, checkout];
  const output = run(
    'node',
    [join(root, 'apps/cli/src/main.ts'), '--cwd', checkout, 'trace', '--json', '--', ...command],
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
