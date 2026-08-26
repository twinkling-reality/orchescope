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
  /**
   * Every package name this repository defines anywhere, whatever it is reachable from.
   *
   * `roots` is deliberately narrow because an adapter reads it to decide whether a framework import is
   * really this repository's own file, and answering yes wrongly loses a component. This set answers a
   * different question for a different reader: the unclaimed-construction refusal asks only whether a
   * name could be the repository's own, and answering yes wrongly costs one refusal that would have named
   * the repository to itself. The two errors are not the same size, so the two readers do not share an
   * answer.
   *
   * It is broader than `roots` in two ways the narrow rule cannot reach. A directory holding `.py` files
   * and no `__init__.py` is an importable package under PEP 420, which `open_deep_research`,
   * `pydantic_ai_examples` and `tubemind`'s `skills` all rely on. And a package under a nested `src` or a
   * project directory inside a monorepo is a root of its own project, which is how `marketing_posts` and
   * `computer_use_demo` are imported by the files beside them.
   */
  readonly definedPackages: ReadonlySet<string>;
};

/**
 * Every directory holding a Python file, by its own name.
 *
 * A directory a repository puts `.py` files in is a package it defines, whether or not it marks the
 * directory with an `__init__.py` and wherever the directory sits. Both are true of the interpreter and
 * neither is true of the narrow rule above, which is why this is a separate pass answering a separate
 * question rather than a loosening of that one.
 */
const definedPackagesIn = (modules: readonly ModuleFacts[]): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const module of modules) {
    if (module.language !== 'python' || !module.file.endsWith('.py')) continue;
    const name = baseNameOf(directoryOf(module.file));
    if (name.length > 0) names.add(name);
  }
  return names;
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

  const index = { roots, neighbours, definedPackages: definedPackagesIn(modules) };
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

/**
 * Whether this specifier could name a package this repository defines, read from its first segment.
 *
 * Only the head is asked, because `open_deep_research.prompts` and `computer_use_demo.loop` are modules
 * inside a package this repository writes, and the package is what decides the owner. Read only by the
 * unclaimed-construction refusal, for the reason `definedPackages` states.
 */
export const namesDefinedPackage = (local: LocalModules, specifier: string): boolean => {
  const [head = specifier] = specifier.split('.', 1);
  return local.definedPackages.has(head);
};
