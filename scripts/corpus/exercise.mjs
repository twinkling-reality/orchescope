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
 * The interpreter an entry's environment is built from, which is `python3` unless the entry names another.
 *
 * An entry naming one is an entry whose framework declares a ceiling this machine's `python3` is above, and the
 * marker carries it so that changing it rebuilds the environment rather than reusing one built from the other.
 */
const interpreterFor = (entry) => entry.exercise.pythonInterpreter ?? 'python3';

/** The interpreter an entry names and this machine does not have, so a run can skip it with the reason printed. */
export const missingInterpreter = (entry) => {
  if (entry.exercise?.pythonInterpreter === undefined) return undefined;
  try {
    run(entry.exercise.pythonInterpreter, ['--version']);
    return undefined;
  } catch {
    return entry.exercise.pythonInterpreter;
  }
};

/**
 * The environment is rebuilt only when the package list changes, because installing it takes longer than every other
 * part of a corpus run put together. The marker records the list that produced the environment that is there.
 */
const prepareVirtualEnvironment = (root, entry, checkout) => {
  const directory = join(cacheDirectory(root), 'venvs', entry.name);
  const python = join(directory, 'bin/python');
  const marker = join(directory, MARKER);
  const interpreter = interpreterFor(entry);
  const wanted = `${JSON.stringify([interpreter, ...entry.exercise.pythonPackages])}\n`;
  if (existsSync(python) && existsSync(marker) && readFileSync(marker, 'utf8') === wanted) {
    return { interpreter: python };
  }

  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  run(interpreter, ['-m', 'venv', directory]);
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
 *
 * There is one tree, it holds one entry's packages, and the marker records the list rather than the entry, so an
 * entry whose list is not the one installed rebuilds it. Two Node entries cannot share the tree. This corpus pins an
 * application on `@langchain/core` 0.3, which reads a tool schema through zod 3, beside one on `ai` 7, which needs
 * the Standard Schema zod added in 3.25 and resolves to 4. Under zod 4 that first application's `tool()` builds a
 * function declaring no parameters at all, and the run still succeeds, so an entry sharing the tree would measure an
 * environment nobody asked for. A marker per entry reported the tree as ready while it held the other entry's
 * packages, which is the failure that could not be seen while there was one Node entry.
 *
 * What it costs is an install per Node entry per exercised run, which is why the tree is emptied rather than added
 * to: npm reconciles against a lock file describing the other entry, and the point is a tree with nothing else in it.
 */
const prepareNodeEnvironment = (root, entry) => {
  const directory = cacheDirectory(root);
  const marker = join(directory, MARKER);
  const wanted = `${JSON.stringify(entry.exercise.nodePackages)}\n`;
  const modules = join(directory, 'node_modules');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === wanted) return { modules };

  rmSync(marker, { force: true });
  rmSync(modules, { recursive: true, force: true });
  rmSync(join(directory, 'package-lock.json'), { force: true });
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
