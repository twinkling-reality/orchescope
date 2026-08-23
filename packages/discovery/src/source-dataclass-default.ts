import type { SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import type { DiscoveryContext } from './adapter.ts';
import { hasContainingCallableBinding, matchRuntimeSymbol } from './matching.ts';

type DataclassQuery = {
  readonly context: DiscoveryContext;
  readonly module: ModuleFacts;
  readonly before: SourceLocation;
  readonly enclosing: string | undefined;
};

export type DataclassDefault = {
  readonly value: ArgumentFact;
  readonly basis: 'configuration_default';
  readonly locations: readonly SourceLocation[];
};

const locationKey = (location: SourceLocation): string =>
  `${location.file}:${location.startLine}:${location.startColumn ?? 0}:${location.endLine ?? location.startLine}:${location.endColumn ?? 0}`;

const sortedLocations = (locations: readonly SourceLocation[]): readonly SourceLocation[] =>
  [...new Map(locations.map((location) => [locationKey(location), location])).values()].sort(
    (left, right) => locationKey(left).localeCompare(locationKey(right)),
  );

const locationEndsBefore = (declaration: SourceLocation, use: SourceLocation): boolean => {
  const endLine = declaration.endLine ?? declaration.startLine;
  if (endLine !== use.startLine) return endLine < use.startLine;
  if (declaration.endColumn === undefined || use.startColumn === undefined) return false;
  return declaration.endColumn <= use.startColumn;
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

const stableVariable = (
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
      locationEndsBefore(definition.location, before),
  );
  if (candidates.length !== 1) return undefined;
  if (
    module.assignments.some(
      (assignment) =>
        assignment.target[0] === name &&
        assignment.enclosing === enclosing &&
        locationEndsBefore(assignment.location, before),
    )
  ) {
    return undefined;
  }
  return candidates[0];
};

const exactFrozenDataclass = (
  context: DiscoveryContext,
  module: ModuleFacts,
  definition: DefinitionFact,
): readonly SourceLocation[] | undefined => {
  if (
    definition.decorators.length !== 1 ||
    (definition.initializer?.length ?? 0) > 0 ||
    module.definitions.some(
      (nested) => nested.enclosing === definition.name && nested.kind !== 'variable',
    )
  ) {
    return undefined;
  }
  const matches = definition.decorators.filter(
    (decorator) =>
      matchRuntimeSymbol(
        context.modules,
        module,
        {
          path: decorator.path,
          origin: decorator.origin,
          enclosing: definition.enclosing,
          location: decorator.location,
        },
        { names: ['dataclass'], packages: ['dataclasses'] },
      ) !== undefined,
  );
  if (matches.length !== 1) return undefined;
  const decorator = matches[0];
  if (decorator === undefined) return undefined;
  const keywordObjects = decorator.args.filter(
    (argument): argument is Extract<ArgumentFact, { readonly kind: 'object' }> =>
      argument.kind === 'object',
  );
  const frozen =
    keywordObjects.length === 1
      ? entryNamed(keywordObjects[0]?.entries ?? [], 'frozen')
      : undefined;
  if (frozen?.value.kind !== 'boolean' || !frozen.value.value) return undefined;
  const root = decorator.path[0];
  const imported =
    root === undefined ? undefined : module.imports.filter((entry) => entry.local === root);
  const importBinding = imported?.[0];
  if (imported?.length !== 1 || importBinding === undefined || importBinding.isType)
    return undefined;
  if (!locationEndsBefore(importBinding.location, decorator.location)) return undefined;
  return [importBinding.location, decorator.location, definition.location];
};

const boundedAliases = (
  module: ModuleFacts,
  seeds: readonly string[],
  enclosing: string | undefined,
  before: SourceLocation | undefined,
): { readonly names: ReadonlySet<string>; readonly complete: boolean } => {
  const aliases = new Set(seeds);
  for (let hop = 0; hop < 4; hop += 1) {
    const reached = new Set(aliases);
    let added = false;
    for (const definition of module.definitions) {
      if (
        definition.kind !== 'variable' ||
        definition.enclosing !== enclosing ||
        aliases.has(definition.name) ||
        (before !== undefined && !locationEndsBefore(definition.location, before))
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
  return {
    names: aliases,
    complete: !module.definitions.some(
      (definition) =>
        definition.kind === 'variable' &&
        definition.enclosing === enclosing &&
        !aliases.has(definition.name) &&
        (before === undefined || locationEndsBefore(definition.location, before)) &&
        definition.aliasedFrom?.some(
          (path) => path.length === 1 && path[0] !== undefined && aliases.has(path[0]),
        ) === true,
    ),
  };
};

const fieldWasAssigned = (
  module: ModuleFacts,
  roots: ReadonlySet<string>,
  field: string,
  enclosing: string | undefined,
  before: SourceLocation | undefined,
): boolean =>
  module.assignments.some(
    (assignment) =>
      assignment.target[0] !== undefined &&
      roots.has(assignment.target[0]) &&
      (assignment.target.length === 1 || assignment.target.at(-1) === field) &&
      assignment.enclosing === enclosing &&
      (before === undefined || locationEndsBefore(assignment.location, before)),
  );

type InstanceBinding = {
  readonly module: ModuleFacts;
  readonly definition: DefinitionFact;
  readonly locations: readonly SourceLocation[];
};

const dataclassInstance = (query: DataclassQuery, root: string): InstanceBinding | undefined => {
  const local = stableVariable(query.module, root, query.enclosing, query.before);
  if (local !== undefined) return { module: query.module, definition: local, locations: [] };
  if (hasContainingCallableBinding(query.module, query.before, root)) {
    return undefined;
  }
  if (
    query.module.definitions.some(
      (definition) =>
        definition.name === root && locationEndsBefore(definition.location, query.before),
    ) ||
    query.module.assignments.some(
      (assignment) =>
        assignment.target[0] === root && locationEndsBefore(assignment.location, query.before),
    )
  ) {
    return undefined;
  }
  const imports = query.module.imports.filter(
    (entry) =>
      entry.local === root && !entry.isType && locationEndsBefore(entry.location, query.before),
  );
  const imported = imports[0];
  if (imports.length !== 1 || imported === undefined) return undefined;
  const resolved = query.context.symbols.resolve(query.module.file, root);
  if (resolved?.definition?.kind !== 'variable') return undefined;
  const module = query.context.symbols.moduleOf(resolved.file);
  if (module === undefined) return undefined;
  const definitions = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === resolved.definition?.name &&
      definition.enclosing === resolved.definition?.enclosing,
  );
  if (definitions.length !== 1) return undefined;
  return { module, definition: resolved.definition, locations: [imported.location] };
};

/** Resolves one member through an exact frozen dataclass instance and its literal field default. */
export const dataclassFieldDefault = (
  query: DataclassQuery,
  path: readonly string[],
): DataclassDefault | undefined => {
  const [root, field, ...rest] = path;
  if (root === undefined || field === undefined || rest.length > 0) return undefined;
  const instance = dataclassInstance(query, root);
  if (instance?.definition.value?.kind !== 'call') return undefined;
  if (instance.definition.value.path.length !== 1) return undefined;
  if (instance.definition.value.args.length > 0) return undefined;
  const className = instance.definition.value.path[0];
  if (className === undefined) return undefined;
  if (hasContainingCallableBinding(instance.module, instance.definition.location, className)) {
    return undefined;
  }
  const resolvedType = query.context.symbols.resolve(instance.module.file, className);
  if (resolvedType?.definition?.kind !== 'class' || resolvedType.file !== instance.module.file) {
    return undefined;
  }
  const declarations = instance.module.definitions.filter(
    (definition) =>
      definition.kind === 'class' && definition.name === resolvedType.definition?.name,
  );
  const declaration = declarations[0];
  if (declarations.length !== 1 || declaration === undefined) return undefined;
  if (!locationEndsBefore(declaration.location, instance.definition.location)) return undefined;
  const dataclassLocations = exactFrozenDataclass(query.context, instance.module, declaration);
  if (dataclassLocations === undefined) return undefined;
  const fields = instance.module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.enclosing === declaration.name &&
      definition.name === field,
  );
  const declared = fields[0];
  if (fields.length !== 1 || declared?.value === undefined) return undefined;
  if (!locationEndsBefore(declared.location, instance.definition.location)) return undefined;
  const instanceAliases = boundedAliases(
    instance.module,
    [instance.definition.name, declaration.name],
    instance.definition.enclosing,
    instance.module.file === query.module.file ? query.before : undefined,
  );
  const queryAliases = boundedAliases(query.module, [root], query.enclosing, query.before);
  const instanceBefore = instance.module.file === query.module.file ? query.before : undefined;
  if (
    !instanceAliases.complete ||
    !queryAliases.complete ||
    fieldWasAssigned(
      instance.module,
      instanceAliases.names,
      field,
      instance.definition.enclosing,
      instanceBefore,
    ) ||
    fieldWasAssigned(query.module, queryAliases.names, field, query.enclosing, query.before)
  ) {
    return undefined;
  }
  const nested = valueUnder(declared.value, rest);
  if (nested === undefined) return undefined;
  return {
    value: nested.value,
    basis: 'configuration_default',
    locations: sortedLocations([
      ...instance.locations,
      instance.definition.location,
      ...dataclassLocations,
      declared.location,
      ...nested.locations,
    ]),
  };
};
