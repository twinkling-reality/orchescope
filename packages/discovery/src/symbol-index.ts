import type { DefinitionFact, ModuleFacts } from '@orchescope/source-analysis';

/**
 * Cross module symbol resolution without a type checker.
 *
 * Discovery constantly needs to answer "the agent lists `lookupAccount` in its tools, where is that
 * defined". Answering it requires following a relative import to a file and finding the definition
 * there. That is module resolution, not type inference, and it is done here with an explicit,
 * bounded algorithm so that the limits are visible: package specifiers resolve to nothing, re-export
 * chains are followed to a fixed depth, and a name that cannot be resolved stays unresolved rather
 * than being guessed.
 */

export type SymbolRef = {
  readonly file: string;
  readonly name: string;
  readonly definition: DefinitionFact | undefined;
};

export type ExternalRef = {
  readonly module: string;
  readonly imported: string;
};

/** An external reference plus the file that wrote it, which is the file its locality must be judged from. */
export type OwningRef = ExternalRef & { readonly from: string };

export type SymbolIndex = {
  /** Resolves a local binding to the module that defines it. */
  readonly resolve: (fromFile: string, localName: string) => SymbolRef | undefined;
  /** Resolves a local binding to the package it was imported from, when it is external. */
  readonly external: (fromFile: string, localName: string) => ExternalRef | undefined;
  /**
   * The distribution a binding came from, following the repository's own modules until the chain leaves it.
   *
   * `resolve` walks the same chain and answers only when it lands on a definition, so a chain ending at a
   * package import returns nothing and the answer is discarded. `external` returns that answer but asks
   * only the file it is handed, so it answers only if the caller already knew which module to ask. Neither
   * one says who owns `np` in `from .imports import np`, where `imports.py` holds `import numpy as np`.
   *
   * Measured over the pinned corpus: 36 bindings refused as this repository's own actually reach a
   * distribution no adapter claims, and 37 more reach one that is claimed. Every resolved chain is one hop
   * deep and the deepest reachable is two, against a ceiling of four.
   *
   * The visited set is not decoration. Thirty real re-export cycles exist in the corpus, all Python
   * `from . import X` inside a package `__init__.py`, and without it a cycle is indistinguishable from a
   * chain that ran out of hops.
   */
  readonly owningDistribution: (fromFile: string, localName: string) => OwningRef | undefined;
  readonly definitionsOf: (file: string) => readonly DefinitionFact[];
  readonly moduleOf: (file: string) => ModuleFacts | undefined;
  readonly files: readonly string[];
};

const MAX_HOPS = 4;

const JS_CANDIDATES = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const JS_INDEX_CANDIDATES = [
  '/index.ts',
  '/index.tsx',
  '/index.mts',
  '/index.js',
  '/index.jsx',
  '/index.mjs',
];

const dirnameOf = (file: string): string => {
  const slash = file.lastIndexOf('/');
  return slash < 0 ? '' : file.slice(0, slash);
};

const normalizeSegments = (path: string): string => {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
};

const isRelative = (specifier: string): boolean =>
  specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('.');

/**
 * Aliases that mean the repository root, and are not a package name by construction.
 *
 * `@/lib/thing` cannot be a package: an npm scope is never empty. `~/lib/thing` is the other spelling of the same
 * convention. Anything else in a `paths` mapping is not followed, and a symbol behind one stays unresolved rather
 * than being guessed at, which is what keeps this an algorithm with a stated limit rather than a type checker.
 *
 * The limit is not cosmetic: a reference that does not resolve becomes a second component for something already
 * discovered, so the same tool ends up declared twice under two module namespaces.
 */
const ROOT_ALIASES = ['@/', '~/'];

export const namesRootAlias = (specifier: string): boolean =>
  ROOT_ALIASES.some((alias) => specifier.startsWith(alias));

/** Resolves a JavaScript specifier that is relative to `fromFile`, or rooted by an alias, against the file set. */
const resolveJavaScript = (
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | undefined => {
  const base = namesRootAlias(specifier)
    ? normalizeSegments(specifier.slice(2))
    : normalizeSegments(`${dirnameOf(fromFile)}/${specifier}`);
  if (known.has(base)) return base;
  const withoutExtension = base.replace(/\.(js|mjs|cjs|jsx)$/, '');
  for (const extension of JS_CANDIDATES) {
    const candidate = `${withoutExtension}${extension}`;
    if (known.has(candidate)) return candidate;
  }
  for (const suffix of JS_INDEX_CANDIDATES) {
    const candidate = `${withoutExtension}${suffix}`;
    if (known.has(candidate)) return candidate;
  }
  return undefined;
};

/**
 * Resolves a Python relative import. One leading dot means the current package, each additional dot
 * moves one package up, matching the language rule.
 */
const resolvePython = (
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | undefined => {
  const leadingDots = /^\.+/.exec(specifier)?.[0].length ?? 0;
  if (leadingDots === 0) {
    const asModule = specifier.replaceAll('.', '/');
    const candidates = [
      `${asModule}.py`,
      `${asModule}/__init__.py`,
      `src/${asModule}.py`,
      `src/${asModule}/__init__.py`,
    ].filter((candidate) => known.has(candidate));
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  let directory = dirnameOf(fromFile);
  for (let hop = 1; hop < leadingDots; hop += 1) directory = dirnameOf(directory);
  const rest = specifier.slice(leadingDots).replaceAll('.', '/');
  const base = normalizeSegments(rest.length === 0 ? directory : `${directory}/${rest}`);
  const candidates = [`${base}.py`, `${base}/__init__.py`].filter((candidate) =>
    known.has(candidate),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
};

export const buildSymbolIndex = (modules: readonly ModuleFacts[]): SymbolIndex => {
  const byFile = new Map<string, ModuleFacts>();
  for (const module of modules) byFile.set(module.file, module);
  const known = new Set(byFile.keys());

  const definitionsByFile = new Map<string, Map<string, DefinitionFact>>();
  for (const module of modules) {
    const names = new Map<string, DefinitionFact>();
    for (const definition of module.definitions) {
      if (!names.has(definition.name)) names.set(definition.name, definition);
    }
    definitionsByFile.set(module.file, names);
  }

  const resolveSpecifier = (fromFile: string, specifier: string): string | undefined =>
    fromFile.endsWith('.py')
      ? resolvePython(fromFile, specifier, known)
      : isRelative(specifier) || namesRootAlias(specifier)
        ? resolveJavaScript(fromFile, specifier, known)
        : undefined;

  const resolve = (fromFile: string, localName: string): SymbolRef | undefined => {
    let currentFile = fromFile;
    let currentName = localName;
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const local = definitionsByFile.get(currentFile)?.get(currentName);
      if (local !== undefined) {
        return { file: currentFile, name: currentName, definition: local };
      }
      const module = byFile.get(currentFile);
      if (module === undefined) return undefined;
      const binding = module.imports.find((entry) => entry.local === currentName);
      if (binding === undefined) return undefined;
      const target = resolveSpecifier(currentFile, binding.module);
      if (target === undefined) return undefined;
      currentFile = target;
      currentName = binding.imported === '*' ? currentName : binding.imported;
    }
    return undefined;
  };

  const external = (fromFile: string, localName: string): ExternalRef | undefined => {
    const module = byFile.get(fromFile);
    const binding = module?.imports.find((entry) => entry.local === localName);
    if (binding === undefined) return undefined;
    if (resolveSpecifier(fromFile, binding.module) !== undefined) return undefined;
    if (isRelative(binding.module)) return undefined;
    return { module: binding.module, imported: binding.imported };
  };

  /**
   * The chained form of `external`, which is the whole of the re-export bridge.
   *
   * It walks exactly the modules `resolve` walks and stops one step later: where `resolve` gives up on a
   * specifier that leaves the repository, this returns it. A name the chain proves is defined here answers
   * nothing, because that is the case `external` already gets right.
   */
  const owningDistribution = (fromFile: string, localName: string): OwningRef | undefined => {
    let currentFile = fromFile;
    let currentName = localName;
    const visited = new Set<string>();
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      if (visited.has(`${currentFile}|${currentName}`)) return undefined;
      visited.add(`${currentFile}|${currentName}`);
      if (definitionsByFile.get(currentFile)?.has(currentName) === true) return undefined;
      const module = byFile.get(currentFile);
      if (module === undefined) return undefined;
      const binding = module.imports.find((entry) => entry.local === currentName);
      if (binding === undefined || binding.isType) return undefined;
      const target = resolveSpecifier(currentFile, binding.module);
      if (target === undefined) {
        if (isRelative(binding.module) || namesRootAlias(binding.module)) return undefined;
        return { module: binding.module, imported: binding.imported, from: currentFile };
      }
      currentFile = target;
      currentName = binding.imported === '*' ? currentName : binding.imported;
    }
    return undefined;
  };

  return {
    resolve,
    external,
    owningDistribution,
    definitionsOf: (file) => byFile.get(file)?.definitions ?? [],
    moduleOf: (file) => byFile.get(file),
    files: [...known],
  };
};
