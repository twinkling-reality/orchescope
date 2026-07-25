import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { CallFact, DefinitionFact, ModuleFacts } from '@orchescope/source-analysis';
import { calleeName } from '@orchescope/source-analysis';
import type { DiscoveryContext } from './adapter.ts';

/**
 * Matching helpers shared by adapters.
 *
 * A framework call is recognised by its callee name plus the package the callee came from. When the
 * package cannot be established, because the helper was re-exported through a local module, the match
 * still succeeds if the file imports the framework at all, and the resulting component carries a lower
 * confidence. That distinction is the difference between "we resolved this" and "this is the only
 * plausible reading", and both are recorded rather than blurred.
 */

export const moduleMatches = (specifier: string, packages: readonly string[]): boolean =>
  packages.some((name) => specifier === name || specifier.startsWith(`${name}/`));

export const importsAny = (module: ModuleFacts, packages: readonly string[]): boolean =>
  module.imports.some((entry) => moduleMatches(entry.module, packages));

export const projectUses = (context: DiscoveryContext, packages: readonly string[]): boolean =>
  context.manifests.dependencies.some((entry) => moduleMatches(entry.name, packages)) ||
  context.modules.some((module) => importsAny(module, packages));

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
};

export const matchCalls = (
  modules: readonly ModuleFacts[],
  query: CallQuery,
): readonly MatchedCall[] => {
  const matches: MatchedCall[] = [];
  for (const module of modules) {
    const frameworkImported = importsAny(module, query.packages);
    for (const call of module.calls) {
      if (query.kind !== undefined && call.kind !== query.kind) continue;
      if (query.pathLength !== undefined && call.calleePath.length !== query.pathLength) continue;
      if (!query.names.includes(calleeName(call))) continue;
      const resolved =
        call.origin !== undefined && moduleMatches(call.origin.module, query.packages);
      if (!resolved && !frameworkImported) continue;
      matches.push({
        call,
        module,
        resolved,
        confidence: resolved ? CONFIDENCE_BANDS.deterministic : CONFIDENCE_BANDS.heuristic,
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
): readonly {
  readonly module: ModuleFacts;
  readonly definition: DefinitionFact;
  readonly resolved: boolean;
}[] => {
  const results: { module: ModuleFacts; definition: DefinitionFact; resolved: boolean }[] = [];
  for (const module of modules) {
    const frameworkImported = importsAny(module, packages);
    for (const definition of module.definitions) {
      for (const decorator of definition.decorators) {
        const name = decorator.path[decorator.path.length - 1];
        if (name === undefined || !decoratorNames.includes(name)) continue;
        const resolved =
          decorator.origin !== undefined && moduleMatches(decorator.origin.module, packages);
        if (!resolved && !frameworkImported) continue;
        results.push({ module, definition, resolved });
        break;
      }
    }
  }
  return results;
};
