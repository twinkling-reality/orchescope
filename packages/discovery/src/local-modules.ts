import type { ModuleFacts } from '@orchescope/source-analysis';

/**
 * Which import specifiers name a module this repository writes, rather than a distribution it depends on.
 *
 * `from agents import MarketingAnalysisAgents` in `crews/instagram_post/main.py` names the `agents.py` file
 * sitting beside it, and no checkout of that repository declares a distribution called `agents`. Read as a
 * distribution instead, it made the coverage report name a framework gap that does not exist and recorded an
 * adapter as having run on three files of a repository that uses none of it.
 *
 * The rule is the interpreter's own and it is filesystem exact. A script is run with its own directory first
 * on the module path, so a module beside it shadows any distribution of that name. A file inside a package is
 * not: its directory is reached through the package and never sits on the path itself. That is why the
 * presence of an `__init__.py` separates the two cases rather than the depth of the path, and it is what
 * tells `crews/instagram_post/main.py`, which is a script, from `python-backend/airline/tools.py`, which is a
 * package member whose sibling `agents.py` shadows nothing.
 */

const PACKAGE_MARKER = '__init__.py';

const directoryOf = (file: string): string => {
  const cut = file.lastIndexOf('/');
  return cut === -1 ? '' : file.slice(0, cut);
};

const baseNameOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/** The path the module would have. A module name holds no separator, so the join cannot be ambiguous. */
const neighbourKey = (directory: string, name: string): string =>
  directory === '' ? name : `${directory}/${name}`;

export type LocalModules = {
  /**
   * Top level packages and modules this repository defines, reachable from a path root it always has.
   *
   * A repository is on its own import path when it runs, so `agents/__init__.py` makes `agents` resolve here
   * rather than to any distribution of that name. Only roots are collected: a package nested deep inside a
   * source tree is not reachable as a top level import, and treating it as one would hide a real dependency.
   */
  readonly roots: ReadonlySet<string>;
  /**
   * Modules importable only by a script sitting in the same directory, keyed by that directory.
   *
   * Separate from `roots` because the two carry different certainty. A neighbour is unambiguous: the script's
   * own directory is first on the path and nothing else of that name can win. A root is not, because a
   * repository that defines a top level package is often the distribution of that name, and
   * `openai-agents-python` is the corpus entry that proves it: `src/agents/` is both this repository's own
   * package and the framework whose declarations the adapter has to read.
   */
  readonly neighbours: ReadonlySet<string>;
};

const INDEXES = new WeakMap<readonly ModuleFacts[], LocalModules>();

export const localModules = (modules: readonly ModuleFacts[]): LocalModules => {
  const cached = INDEXES.get(modules);
  if (cached !== undefined) return cached;

  const packageDirectories = new Set<string>();
  for (const module of modules) {
    if (module.language !== 'python') continue;
    if (baseNameOf(module.file) === PACKAGE_MARKER) {
      packageDirectories.add(directoryOf(module.file));
    }
  }

  const roots = new Set<string>();
  const neighbours = new Set<string>();
  for (const module of modules) {
    if (module.language !== 'python') continue;
    const base = baseNameOf(module.file);
    if (!base.endsWith('.py')) continue;
    const directory = directoryOf(module.file);

    if (base === PACKAGE_MARKER) {
      if (directory === '') continue;
      const parent = directoryOf(directory);
      const packageName = baseNameOf(directory);
      if (parent === '' || parent === 'src') roots.add(packageName);
      if (!packageDirectories.has(parent)) neighbours.add(neighbourKey(parent, packageName));
      continue;
    }

    const moduleName = base.slice(0, -3);
    if (directory === '' || directory === 'src') roots.add(moduleName);
    if (!packageDirectories.has(directory)) neighbours.add(neighbourKey(directory, moduleName));
  }

  const index = { roots, neighbours };
  INDEXES.set(modules, index);
  return index;
};

/**
 * Whether this specifier, read from this file, names a module this repository writes.
 *
 * A neighbour answers for any spelling, because the script's own directory wins outright. A root answers only
 * for a submodule reference such as `agents.agent`: a bare `import agents` in a repository whose own package
 * is `agents` is as likely to be the distribution it publishes as the directory it holds, and the syntax does
 * not say which. Refusing to decide there leaves the framework readable and costs nothing measured, because
 * the only corpus repository the distinction reaches is the one that publishes the package it imports.
 */
export const namesLocalModule = (
  local: LocalModules,
  importer: ModuleFacts,
  specifier: string,
): boolean => {
  if (importer.language !== 'python') return false;
  const [root = specifier] = specifier.split('.', 1);
  if (specifier.includes('.') && local.roots.has(root)) return true;
  return local.neighbours.has(neighbourKey(directoryOf(importer.file), root));
};
