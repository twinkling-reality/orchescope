/**
 * Every name a reader recognises by, counted against the repositories this corpus pins.
 *
 * A name list does not merely fail to cover the framework that has not shipped yet. It goes quietly wrong
 * about the ones that have, and nothing says so. Measured when this was written: the symbol `Server` and the
 * registration methods `setRequestHandler` and `add_tool` in the Model Context Protocol reader matched
 * nothing across fifty six repositories, and so did all eight entries of the language marker table. One
 * third of two shipped lists was dead and no gate mentioned it.
 *
 * This is the gate that mentions it. `pnpm check`, `pnpm test` and the expectation comparison all answer
 * questions about what a name does when it matches; none of them can answer what a name does when it never
 * does. A name matching no pinned repository is reported and never deleted automatically: the corpus is
 * fifty six repositories and not the world, and a name may be legitimately unmatched. What is not acceptable
 * is that nobody finds out for a year.
 *
 * The names are read out of the readers' own source, in the pattern `tests/e2e/rule-input-producers.test.ts`
 * establishes: asking a file its own text is how a check stays true of a file nobody remembered to update.
 *
 * See [ADR 0015](../../docs/architecture/adr/0015-the-asymmetric-invariant.md), decision 3.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A literal array bound to one of these keys is a recognition vocabulary rather than an ordinary list. */
const VOCABULARY_KEYS = ['packages', 'names', 'defaultExportNames'];

/** Arrays whose members are paths, versions or prose rather than names a repository could carry. */
const NOT_A_NAME = /^[^A-Za-z@]|[\s/\\]|^v?\d/;

const arraysBoundTo = (source, key) => {
  const found = [];
  const pattern = new RegExp(`\\b${key}\\s*:\\s*\\[`, 'g');
  for (const match of source.matchAll(pattern)) {
    const open = match.index + match[0].length - 1;
    const close = source.indexOf(']', open);
    if (close === -1) continue;
    const line = source.slice(0, open).split('\n').length;
    found.push({ body: source.slice(open + 1, close), line });
  }
  return found;
};

const literalsIn = (body) => [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);

/**
 * Every recognition name the adapters declare, by the file and line that declares it.
 *
 * Both the inline query objects and the exported `*_PACKAGES` constants beside them, because an adapter that
 * lifted its list into a constant is exactly the adapter whose list nobody reads any more.
 */
export const recognitionNames = (root) => {
  const directory = join(root, 'packages/discovery/src/adapters');
  const names = new Map();
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(join(directory, file), 'utf8');
    const regions = [
      ...VOCABULARY_KEYS.flatMap((key) => arraysBoundTo(source, key)),
      ...[...source.matchAll(/\b[A-Z_]*(?:PACKAGES|NAMES|EXPORTS|MODULES)\b[^=]*=\s*\[/g)].map(
        (match) => {
          const open = match.index + match[0].length - 1;
          const close = source.indexOf(']', open);
          return close === -1
            ? undefined
            : {
                body: source.slice(open + 1, close),
                line: source.slice(0, open).split('\n').length,
              };
        },
      ),
    ].filter(Boolean);
    for (const region of regions) {
      for (const literal of literalsIn(region.body)) {
        if (NOT_A_NAME.test(literal)) continue;
        const at = `packages/discovery/src/adapters/${file}:${region.line}`;
        if (!names.has(literal)) names.set(literal, at);
      }
    }
  }
  return names;
};

/** A specifier reaches a claimed name exactly as `moduleMatches` decides it does. */
const specifierMatches = (specifier, name) =>
  specifier === name || specifier.startsWith(`${name}/`) || specifier.startsWith(`${name}.`);

/**
 * The names one repository could answer for: what it imports, what it imports by, and what it calls.
 *
 * A package name is answered by a specifier and by a declared dependency. A symbol name is answered by an
 * imported binding, the last segment of a callee path or the last segment of a decorator path, which are the
 * three positions a reader matches a symbol in.
 */
export const namesObservedIn = (facts, dependencies) => {
  const specifiers = new Set();
  const symbols = new Set();
  for (const name of dependencies) specifiers.add(name);
  for (const module of facts) {
    for (const entry of module.imports) {
      specifiers.add(entry.module);
      symbols.add(entry.imported);
      symbols.add(entry.local);
    }
    for (const call of module.calls) {
      const last = call.calleePath[call.calleePath.length - 1];
      if (last !== undefined) symbols.add(last);
      const first = call.calleePath[0];
      if (first !== undefined) symbols.add(first);
    }
    for (const definition of module.definitions) {
      for (const decorator of definition.decorators) {
        const last = decorator.path[decorator.path.length - 1];
        if (last !== undefined) symbols.add(last);
      }
    }
  }
  return { specifiers, symbols };
};

/** Whether any pinned repository answers for this name, in either of the two positions a reader asks in. */
export const nameWasSeen = (name, observed) => {
  if (observed.symbols.has(name)) return true;
  for (const specifier of observed.specifiers) {
    if (specifierMatches(specifier, name)) return true;
  }
  return false;
};

export const deadNameReport = (names, seen) => {
  const dead = [...names.entries()]
    .filter(([name]) => !seen.has(name))
    .map(([name, at]) => ({ name, at }))
    .sort((left, right) => (left.name < right.name ? -1 : 1));
  return { total: names.size, dead };
};
