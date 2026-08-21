import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { CallFact, DefinitionFact, ModuleFacts } from '@orchescope/source-analysis';
import { calleeName } from '@orchescope/source-analysis';
import type { DiscoveryContext } from './adapter.ts';
import { type LocalModules, localModules, namesLocalModule } from './local-modules.ts';

/**
 * Matching helpers shared by adapters.
 *
 * A framework call is recognised by its callee name plus the package the callee came from. When the
 * package cannot be established, because the helper was re-exported through a local module, the match
 * still succeeds if the file imports the framework at all, and the resulting component carries a lower
 * confidence. That distinction is the difference between "we resolved this" and "this is the only
 * plausible reading", and both are recorded rather than blurred.
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
};

export const matchCalls = (
  modules: readonly ModuleFacts[],
  query: CallQuery,
): readonly MatchedCall[] => {
  const matches: MatchedCall[] = [];
  const local = localModules(modules);
  for (const module of modules) {
    const frameworkImported = importsAny(module, query.packages, local);
    for (const call of module.calls) {
      if (query.kind !== undefined && call.kind !== query.kind) continue;
      if (query.pathLength !== undefined && call.calleePath.length !== query.pathLength) continue;
      if (!query.names.includes(calleeName(call))) continue;
      const resolved =
        call.origin !== undefined &&
        moduleMatches(call.origin.module, query.packages) &&
        !namesLocalModule(local, module, call.origin.module);
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
  const local = localModules(modules);
  for (const module of modules) {
    const frameworkImported = importsAny(module, packages, local);
    for (const definition of module.definitions) {
      for (const decorator of definition.decorators) {
        const name = decorator.path[decorator.path.length - 1];
        if (name === undefined || !decoratorNames.includes(name)) continue;
        const resolved =
          decorator.origin !== undefined &&
          moduleMatches(decorator.origin.module, packages) &&
          !namesLocalModule(local, module, decorator.origin.module);
        if (!resolved && !frameworkImported) continue;
        results.push({ module, definition, resolved });
        break;
      }
    }
  }
  return results;
};
