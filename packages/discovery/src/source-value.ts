import type { SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import type { DiscoveryContext } from './adapter.ts';
import { matchRuntimeSymbol } from './matching.ts';
import {
  expandSourceChoices,
  type ResolvedSourceChoices,
  type ResolvedSourceValue,
} from './source-choice.ts';
import { dataclassFieldDefault } from './source-dataclass-default.ts';

export type { ResolvedSourceChoices, ResolvedSourceValue } from './source-choice.ts';

/**
 * A source value settled by a bounded local chain.
 *
 * `configuration_default` is deliberately distinct from `binding`: a default is one possible static
 * value and does not state what a run selected.
 */
export type SourceValueQuery = {
  readonly context: DiscoveryContext;
  readonly module: ModuleFacts;
  readonly value: ArgumentFact;
  readonly before: SourceLocation;
  readonly enclosing: string | undefined;
};

const MAX_VALUE_HOPS = 4;

const locationEndsBefore = (declaration: SourceLocation, use: SourceLocation): boolean => {
  const endLine = declaration.endLine ?? declaration.startLine;
  if (endLine !== use.startLine) return endLine < use.startLine;
  if (declaration.endColumn === undefined || use.startColumn === undefined) return false;
  return declaration.endColumn <= use.startColumn;
};

const beforeUse = (definition: DefinitionFact, use: SourceLocation): boolean =>
  locationEndsBefore(definition.location, use);

/** One stable definition in the same lexical scope, with no subsequent root write hidden from it. */
const stableDefinition = (
  module: ModuleFacts,
  name: string,
  enclosing: string | undefined,
  before: SourceLocation,
): DefinitionFact | undefined => {
  const candidates = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === name &&
      definition.enclosing === enclosing &&
      beforeUse(definition, before),
  );
  if (candidates.length !== 1) return undefined;
  const aliases = new Set([name]);
  for (let hop = 0; hop < MAX_VALUE_HOPS; hop += 1) {
    const reached = new Set(aliases);
    let added = false;
    for (const definition of module.definitions) {
      if (
        definition.kind !== 'variable' ||
        definition.enclosing !== enclosing ||
        aliases.has(definition.name) ||
        !beforeUse(definition, before)
      ) {
        continue;
      }
      if (
        definition.aliasedFrom?.some(
          (path) => path.length === 1 && path[0] !== undefined && reached.has(path[0]),
        ) === true
      ) {
        aliases.add(definition.name);
        added = true;
      }
    }
    if (!added) break;
  }
  const aliasClosureComplete = !module.definitions.some(
    (definition) =>
      definition.kind === 'variable' &&
      definition.enclosing === enclosing &&
      !aliases.has(definition.name) &&
      definition.aliasedFrom?.some(
        (path) => path.length === 1 && path[0] !== undefined && aliases.has(path[0]),
      ) === true,
  );
  if (!aliasClosureComplete) return undefined;
  if (
    module.assignments.some(
      (assignment) =>
        assignment.target[0] !== undefined &&
        aliases.has(assignment.target[0]) &&
        assignment.enclosing === enclosing &&
        locationEndsBefore(assignment.location, before),
    )
  ) {
    return undefined;
  }
  return candidates[0];
};

const entryNamed = (
  entries: readonly ObjectEntryFact[],
  name: string,
): ObjectEntryFact | undefined => {
  const matches = entries.filter((entry) => entry.key === name);
  return matches.length === 1 ? matches[0] : undefined;
};

const valueUnder = (
  value: ArgumentFact,
  path: readonly string[],
): { readonly value: ArgumentFact; readonly locations: readonly SourceLocation[] } | undefined => {
  let current = value;
  const locations: SourceLocation[] = [];
  for (const segment of path) {
    if (current.kind !== 'object') return undefined;
    const entry = entryNamed(current.entries, segment);
    if (entry === undefined) return undefined;
    current = entry.value;
    locations.push(entry.location);
  }
  return { value: current, locations };
};

const scopeDefinition = (
  module: ModuleFacts,
  enclosing: string | undefined,
): DefinitionFact | undefined => {
  if (enclosing === undefined) return undefined;
  const candidates = module.definitions.filter(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      (definition.name === enclosing || definition.name.endsWith(`.${enclosing}`)),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
};

const typePathFor = (
  module: ModuleFacts,
  root: string,
  enclosing: string | undefined,
  before: SourceLocation,
):
  | { readonly path: readonly string[]; readonly locations: readonly SourceLocation[] }
  | undefined => {
  const parameter = scopeDefinition(module, enclosing)?.parameters?.filter(
    (candidate) => candidate.name === root,
  );
  const rebound = module.definitions.some(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === root &&
      definition.enclosing === enclosing &&
      beforeUse(definition, before),
  );
  if (parameter?.length === 1) {
    const selected = parameter[0];
    return rebound || selected?.annotation === undefined
      ? undefined
      : { path: selected.annotation, locations: [selected.location] };
  }

  const definition = stableDefinition(module, root, enclosing, before);
  const initializer = definition?.initializer;
  return initializer === undefined || initializer.length === 0 || definition === undefined
    ? undefined
    : { path: [initializer[0] ?? ''], locations: [definition.location] };
};

const exactPydanticField = (
  context: DiscoveryContext,
  module: ModuleFacts,
  definition: DefinitionFact,
): readonly SourceLocation[] | undefined => {
  if (definition.value?.kind !== 'call') return undefined;
  const root = definition.value.path[0];
  if (root === undefined) return undefined;
  const imports = module.imports.filter((entry) => entry.local === root);
  if (imports.length !== 1) return undefined;
  const imported = imports[0];
  if (imported === undefined) return undefined;
  if (!locationEndsBefore(imported.location, definition.location)) return undefined;
  return matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: definition.value.path,
      origin: {
        module: imported.module,
        imported: imported.imported,
        isType: imported.isType,
      },
      enclosing: definition.enclosing,
      location: definition.location,
    },
    { names: ['Field'], packages: ['pydantic'] },
  ) === undefined
    ? undefined
    : [imported.location, definition.location];
};

const configurationDefault = (
  query: SourceValueQuery,
  path: readonly string[],
): ResolvedSourceValue | undefined => {
  const [root, field, ...rest] = path;
  if (root === undefined || field === undefined) return undefined;
  const typeBinding = typePathFor(query.module, root, query.enclosing, query.before);
  const typeName = typeBinding?.path[0];
  if (typeName === undefined || typeName.length === 0) return undefined;
  const resolvedType = query.context.symbols.resolve(query.module.file, typeName);
  if (resolvedType?.definition?.kind !== 'class') return undefined;
  const typeModule = query.context.symbols.moduleOf(resolvedType.file);
  if (typeModule === undefined) return undefined;
  const typeDeclarations = typeModule.definitions.filter(
    (definition) =>
      definition.kind === 'class' && definition.name === resolvedType.definition?.name,
  );
  if (typeDeclarations.length !== 1) return undefined;
  const fields = typeModule.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.enclosing === resolvedType.definition?.name &&
      definition.name === field,
  );
  if (fields.length !== 1) return undefined;
  const declared = fields[0];
  if (declared?.value?.kind !== 'call') return undefined;
  const fieldLocations = exactPydanticField(query.context, typeModule, declared);
  if (fieldLocations === undefined) return undefined;
  const keywordObjects = declared.value.args.filter(
    (argument): argument is Extract<ArgumentFact, { readonly kind: 'object' }> =>
      argument.kind === 'object',
  );
  if (keywordObjects.length !== 1) return undefined;
  const defaultEntry = entryNamed(keywordObjects[0]?.entries ?? [], 'default');
  if (defaultEntry === undefined) return undefined;
  const nested = valueUnder(defaultEntry.value, rest);
  if (nested === undefined) return undefined;
  return {
    value: nested.value,
    basis: 'configuration_default',
    locations: [
      ...(typeBinding?.locations ?? []),
      resolvedType.definition.location,
      ...fieldLocations,
      defaultEntry.location,
      ...nested.locations,
    ],
  };
};

const resolve = (
  query: SourceValueQuery,
  value: ArgumentFact,
  depth: number,
): ResolvedSourceValue | undefined => {
  if (depth > MAX_VALUE_HOPS) return undefined;
  if (value.kind === 'identifier') {
    const definition = stableDefinition(query.module, value.name, query.enclosing, query.before);
    if (definition?.value === undefined) return undefined;
    const resolved = resolve(query, definition.value, depth + 1);
    return resolved === undefined
      ? undefined
      : { ...resolved, locations: [definition.location, ...resolved.locations] };
  }
  if (value.kind === 'member') {
    const [root, ...rest] = value.path;
    if (root === undefined) return undefined;
    const definition = stableDefinition(query.module, root, query.enclosing, query.before);
    if (definition?.value !== undefined) {
      const bound = resolve(query, definition.value, depth + 1);
      if (bound !== undefined) {
        const nested = valueUnder(bound.value, rest);
        if (nested !== undefined) {
          return {
            value: nested.value,
            basis: bound.basis,
            locations: [definition.location, ...bound.locations, ...nested.locations],
          };
        }
      }
    }
    return configurationDefault(query, value.path) ?? dataclassFieldDefault(query, value.path);
  }
  return { value, basis: 'binding', locations: [] };
};

export const resolveSourceChoices = (query: SourceValueQuery): ResolvedSourceChoices => {
  return expandSourceChoices({
    value: query.value,
    before: query.before,
    resolve: (value, depth) => resolve(query, value, depth),
  });
};

export const resolveSourceValue = (query: SourceValueQuery): ResolvedSourceValue | undefined => {
  const resolved = resolveSourceChoices(query);
  return resolved.complete && resolved.values.length === 1 ? resolved.values[0] : undefined;
};
