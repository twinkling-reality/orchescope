import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SourceLocation } from '@orchescope/schema';
import type {
  CalleeOrigin,
  CallFact,
  DefinitionFact,
  ModuleFacts,
} from '@orchescope/source-analysis';
import type { DiscoveryContext } from './adapter.ts';
import { type LocalModules, localModules, namesLocalModule } from './local-modules.ts';

/**
 * Matching helpers shared by adapters.
 *
 * Runtime provider identity is recognised from the imported binding that owns a symbol. Written short
 * names are not provider evidence: `Client`, `Queue`, `Agent` and `tool` all belong to unrelated
 * ecosystems. A caller may explicitly opt into a lower-confidence unresolved spelling only for syntax
 * distinctive enough to justify that narrower heuristic.
 */

/**
 * Whether a module specifier belongs to one of these distributions.
 *
 * Two languages spell a submodule differently and both mean the same distribution: JavaScript writes
 * `@modelcontextprotocol/sdk/server`, Python writes `mcp.server`. Reading only the first form is how
 * `from mcp.server import FastMCP` came to be invisible to the adapter that claims MCP while the coverage report,
 * which already split on the dot, said the repository used it. One reader behind the other is what an adapter that
 * found nothing looks like from the outside, so both separators are honoured here rather than in each adapter.
 *
 * This answers about the specifier alone. Whether the name reaches a distribution at all or resolves to a file
 * this repository writes is a separate question that needs the importing file, and `namesLocalModule` in
 * `local-modules.ts` is what answers it.
 */
export const moduleMatches = (specifier: string, packages: readonly string[]): boolean =>
  packages.some(
    (name) =>
      specifier === name || specifier.startsWith(`${name}/`) || specifier.startsWith(`${name}.`),
  );

export const importsAny = (
  module: ModuleFacts,
  packages: readonly string[],
  local?: LocalModules,
): boolean =>
  module.imports.some(
    (entry) =>
      !entry.isType &&
      moduleMatches(entry.module, packages) &&
      !(local !== undefined && namesLocalModule(local, module, entry.module)),
  );

/**
 * Whether this repository uses one of these distributions at all.
 *
 * A declared dependency answers on its own, because declaring it is the repository saying so. An import answers
 * only once the name has been shown to reach a distribution rather than a file next to the one reading it.
 */
export const projectUses = (context: DiscoveryContext, packages: readonly string[]): boolean =>
  context.manifests.dependencies.some((entry) => moduleMatches(entry.name, packages)) ||
  context.modules.some((module) => importsAny(module, packages, localModules(context.modules)));

export type MatchedCall = {
  readonly call: CallFact;
  readonly module: ModuleFacts;
  /** Deterministic when the callee resolved to the framework package, heuristic otherwise. */
  readonly confidence: number;
  readonly resolved: boolean;
};

export type CallQuery = {
  readonly names: readonly string[];
  readonly packages: readonly string[];
  /** When set, only calls whose callee path has this length are matched. */
  readonly pathLength?: number;
  readonly kind?: CallFact['kind'];
  /** Canonical symbols this package documents as direct default exports. */
  readonly defaultExportNames?: readonly string[];
  /**
   * Permit an origin-less distinctive spelling when this file has a verified runtime import from the
   * provider. A wrong, type-only or local origin never falls back to this heuristic.
   */
  readonly allowUnresolvedWhenFrameworkImported?: boolean;
};

type RuntimeSymbol = {
  readonly path: readonly string[];
  readonly origin: CalleeOrigin | undefined;
  readonly enclosing: string | undefined;
  readonly location: SourceLocation;
};

export type RuntimeSymbolMatch = {
  readonly resolved: boolean;
  readonly confidence: number;
};

/** Whether a lexical scope declares the receiver name and therefore blocks a module binding fallback. */
export const hasLocalBinding = (
  module: ModuleFacts,
  enclosing: string | undefined,
  name: string,
): boolean => {
  if (enclosing === undefined) return false;
  return (
    module.definitions.some(
      (definition) =>
        (definition.kind === 'function' ||
          definition.kind === 'method' ||
          (definition.kind === 'variable' && definition.parameters !== undefined)) &&
        (definition.name === enclosing || definition.name.endsWith(`.${enclosing}`)) &&
        definition.parameters?.some((parameter) => parameter.name === name) === true,
    ) ||
    module.definitions.some(
      (definition) =>
        definition.kind === 'variable' &&
        definition.name === name &&
        definition.enclosing === enclosing,
    ) ||
    module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === name &&
        assignment.enclosing === enclosing,
    )
  );
};

const containsLocation = (container: SourceLocation, contained: SourceLocation): boolean => {
  const startsBefore =
    container.startLine < contained.startLine ||
    (container.startLine === contained.startLine &&
      (container.startColumn ?? 0) <= (contained.startColumn ?? 0));
  const containerEndLine = container.endLine ?? container.startLine;
  const containedEndLine = contained.endLine ?? contained.startLine;
  const endsAfter =
    containerEndLine > containedEndLine ||
    (containerEndLine === containedEndLine &&
      (container.endColumn ?? Number.MAX_SAFE_INTEGER) >= (contained.endColumn ?? 0));
  return startsBefore && endsAfter;
};

const locationEndsBefore = (declaration: SourceLocation, use: SourceLocation): boolean => {
  const endLine = declaration.endLine ?? declaration.startLine;
  if (endLine !== use.startLine) return endLine < use.startLine;
  if (declaration.endColumn === undefined || use.startColumn === undefined) return false;
  return declaration.endColumn <= use.startColumn;
};

const locationMayPrecede = (declaration: SourceLocation, use: SourceLocation): boolean =>
  locationEndsBefore(declaration, use) ||
  ((declaration.endLine ?? declaration.startLine) === use.startLine &&
    (declaration.endColumn === undefined || use.startColumn === undefined));

/** A binding in any function or method whose source range lexically contains this use. */
const callableScopesContaining = (
  module: ModuleFacts,
  use: SourceLocation,
): readonly DefinitionFact[] =>
  module.definitions.filter(
    (definition) =>
      (definition.kind === 'function' ||
        definition.kind === 'method' ||
        (definition.kind === 'variable' && definition.parameters !== undefined)) &&
      containsLocation(definition.location, use),
  );

/** A binding in any function or method whose source range lexically contains this use. */
export const hasContainingCallableBinding = (
  module: ModuleFacts,
  use: SourceLocation,
  name: string,
): boolean => {
  const scopes = callableScopesContaining(module, use);
  return scopes.some(
    (scope) =>
      scope.parameters?.some((parameter) => parameter.name === name) === true ||
      module.definitions.some(
        (definition) =>
          definition.kind === 'variable' &&
          definition.name === name &&
          definition.enclosing !== undefined &&
          (scope.name === definition.enclosing ||
            scope.name.endsWith(`.${definition.enclosing}`)) &&
          containsLocation(scope.location, definition.location),
      ) ||
      module.assignments.some(
        (assignment) =>
          assignment.target.length === 1 &&
          assignment.target[0] === name &&
          assignment.enclosing !== undefined &&
          (scope.name === assignment.enclosing ||
            scope.name.endsWith(`.${assignment.enclosing}`)) &&
          containsLocation(scope.location, assignment.location),
      ),
  );
};

/** Resolves a local binding against an exact lexical use, with a conservative fact-only fallback. */
export const hasBindingAt = (
  module: ModuleFacts,
  enclosing: string | undefined,
  name: string,
  use: SourceLocation,
): boolean =>
  callableScopesContaining(module, use).length > 0
    ? hasContainingCallableBinding(module, use, name)
    : hasLocalBinding(module, enclosing, name);

/**
 * A local declaration that can replace the imported root binding makes the recorded origin unsafe.
 * The analyzers intentionally retain import origins as compact facts rather than a full scope graph, so
 * this bounded refusal prevents a stale import binding from establishing provider identity.
 */
const hasExplicitLocalShadow = (module: ModuleFacts, symbol: RuntimeSymbol): boolean => {
  const root = symbol.path[0];
  if (root === undefined) return true;
  const enclosed = callableScopesContaining(module, symbol.location).length > 0;
  return (
    hasContainingCallableBinding(module, symbol.location, root) ||
    module.definitions.some(
      (definition) =>
        definition.name === root &&
        definition.enclosing === undefined &&
        (enclosed || locationMayPrecede(definition.location, symbol.location)),
    ) ||
    module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === root &&
        assignment.enclosing === undefined &&
        (enclosed || locationMayPrecede(assignment.location, symbol.location)),
    )
  );
};

/** The provider-exported name represented by direct, renamed, namespace and default imports. */
const importedRuntimeName = (symbol: RuntimeSymbol): string | undefined => {
  const written = symbol.path[symbol.path.length - 1];
  if (written === undefined || symbol.origin === undefined) return undefined;
  if (symbol.origin.imported !== '*' && symbol.origin.imported !== 'default') {
    return symbol.origin.imported;
  }
  if (symbol.origin.imported === 'default' && symbol.path.length === 1) return undefined;
  return written;
};

/**
 * Match one runtime symbol against an exact provider contract.
 *
 * Named aliases compare the original exported name. Namespace and supported default imports compare
 * the final member, so all of `Client`, `PgClient`, `pg.Client` and a default-imported `pg.Client` can
 * resolve to the same provider symbol without granting authority to an unrelated bare `Client`.
 */
export const matchRuntimeSymbol = (
  modules: readonly ModuleFacts[],
  module: ModuleFacts,
  symbol: RuntimeSymbol,
  query: Pick<
    CallQuery,
    'names' | 'packages' | 'defaultExportNames' | 'allowUnresolvedWhenFrameworkImported'
  >,
): RuntimeSymbolMatch | undefined => {
  const local = localModules(modules);
  if (hasExplicitLocalShadow(module, symbol)) return undefined;

  const origin = symbol.origin;
  if (origin !== undefined) {
    if (origin.isType) return undefined;
    if (!moduleMatches(origin.module, query.packages)) return undefined;
    if (namesLocalModule(local, module, origin.module)) return undefined;
    const imported = importedRuntimeName(symbol);
    if (imported === undefined) {
      if (origin.imported !== 'default' || symbol.path.length !== 1) return undefined;
      if (!query.names.some((name) => query.defaultExportNames?.includes(name) === true)) {
        return undefined;
      }
    } else if (!query.names.includes(imported)) return undefined;
    return { resolved: true, confidence: CONFIDENCE_BANDS.deterministic };
  }

  if (query.allowUnresolvedWhenFrameworkImported !== true) return undefined;
  const written = symbol.path[symbol.path.length - 1];
  if (written === undefined || !query.names.includes(written)) return undefined;
  if (!importsAny(module, query.packages, local)) return undefined;
  return { resolved: false, confidence: CONFIDENCE_BANDS.heuristic };
};

export const matchCalls = (
  modules: readonly ModuleFacts[],
  query: CallQuery,
): readonly MatchedCall[] => {
  const matches: MatchedCall[] = [];
  for (const module of modules) {
    for (const call of module.calls) {
      if (query.kind !== undefined && call.kind !== query.kind) continue;
      if (query.pathLength !== undefined && call.calleePath.length !== query.pathLength) continue;
      const matched = matchRuntimeSymbol(
        modules,
        module,
        {
          path: call.calleePath,
          origin: call.origin,
          enclosing: call.enclosing,
          location: call.location,
        },
        query,
      );
      if (matched === undefined) continue;
      matches.push({
        call,
        module,
        ...matched,
      });
    }
  }
  return matches;
};

/** Finds the definition a call is assigned to, so `const x = tool({...})` yields the name `x`. */
export const definitionForCall = (
  module: ModuleFacts,
  call: CallFact,
): DefinitionFact | undefined => {
  const candidates = module.definitions.filter(
    (definition) =>
      (definition.kind === 'variable' || definition.kind === 'function') &&
      definition.location.startLine <= call.location.startLine &&
      (definition.location.endLine ?? definition.location.startLine) >= call.location.startLine,
  );
  return candidates.sort(
    (left, right) =>
      (left.location.endLine ?? left.location.startLine) -
      left.location.startLine -
      ((right.location.endLine ?? right.location.startLine) - right.location.startLine),
  )[0];
};

export const decoratedDefinitions = (
  modules: readonly ModuleFacts[],
  decoratorNames: readonly string[],
  packages: readonly string[],
  options: Pick<CallQuery, 'allowUnresolvedWhenFrameworkImported'> = {},
): readonly {
  readonly module: ModuleFacts;
  readonly definition: DefinitionFact;
  readonly resolved: boolean;
}[] => {
  const results: { module: ModuleFacts; definition: DefinitionFact; resolved: boolean }[] = [];
  for (const module of modules) {
    for (const definition of module.definitions) {
      for (const decorator of definition.decorators) {
        const matched = matchRuntimeSymbol(
          modules,
          module,
          {
            path: decorator.path,
            origin: decorator.origin,
            enclosing: definition.enclosing,
            location: decorator.location,
          },
          { names: decoratorNames, packages, ...options },
        );
        if (matched === undefined) continue;
        results.push({ module, definition, resolved: matched.resolved });
        break;
      }
    }
  }
  return results;
};
