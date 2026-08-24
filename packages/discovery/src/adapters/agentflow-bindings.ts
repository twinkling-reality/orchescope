import type { SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  BranchPredicateFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
} from '@orchescope/source-analysis';
import { findEntry } from '@orchescope/source-analysis';
import { entriesOf, exactRuntimeCall, matchingReceiver } from './agentflow-components.ts';
import {
  argumentMentionCount,
  argumentMentions,
  argumentUnsettled,
  type BoundComponent,
  contains,
  type DiscoveryState,
  endsBefore,
  locationKey,
} from './agentflow-state.ts';

export const knownComponentConsumer = (
  state: DiscoveryState,
  component: BoundComponent,
  call: CallFact,
): boolean => {
  const mentionCount = call.args.reduce(
    (sum, argument) => sum + argumentMentionCount(argument, component.definition.name),
    0,
  );
  if (mentionCount !== 1 || call.args.some(argumentUnsettled)) return false;
  if (exactRuntimeCall(state.context, component.module, call, 'Agent')) {
    const toolNode = findEntry(entriesOf(call), 'tool_node')?.value;
    return (
      exactRuntimeCall(state.context, component.module, component.call, 'ToolNode') &&
      toolNode?.kind === 'identifier' &&
      toolNode.name === component.definition.name
    );
  }
  return (
    call.calleePath[1] === 'add_node' &&
    matchingReceiver(component.module, call, state.workflows) !== undefined &&
    call.args[1]?.kind === 'identifier' &&
    call.args[1].name === component.definition.name
  );
};

export const callableContaining = (
  module: ModuleFacts,
  location: SourceLocation,
): DefinitionFact | undefined => callableScopesContaining(module, location)[0];

export const callableScopesContaining = (
  module: ModuleFacts,
  location: SourceLocation,
): DefinitionFact[] =>
  module.definitions
    .filter(
      (definition) =>
        (definition.kind === 'function' || definition.kind === 'method') &&
        contains(definition.location, location),
    )
    .sort((left, right) => {
      if (contains(left.location, right.location)) return 1;
      if (contains(right.location, left.location)) return -1;
      return 0;
    });

export const sourceBindingName = (definition: DefinitionFact): string =>
  definition.kind === 'function' || definition.kind === 'method'
    ? (definition.name.split('.').at(-1) ?? definition.name)
    : definition.name;

export const definitionsInOwner = (
  module: ModuleFacts,
  name: string,
  owner: SourceLocation | undefined,
  use: SourceLocation,
  requireSourceOrder: boolean,
): DefinitionFact[] =>
  module.definitions.filter(
    (definition) =>
      sourceBindingName(definition) === name &&
      definition.bindingScope === undefined &&
      locationKey(definition.lexicalOwnerLocation) === locationKey(owner) &&
      (!requireSourceOrder || endsBefore(definition.location, use)),
  );

export const samePredicateSite = (left: BranchPredicateFact, right: BranchPredicateFact): boolean =>
  left.operator === right.operator && locationKey(left.location) === locationKey(right.location);

export const branchPathApplies = (
  definition: DefinitionFact,
  useBranches: readonly BranchPredicateFact[],
): boolean =>
  (definition.branches ?? []).every((branch) =>
    useBranches.some(
      (candidate) => samePredicateSite(branch, candidate) && branch.branch === candidate.branch,
    ),
  );

export const branchPathConflicts = (
  definition: DefinitionFact,
  useBranches: readonly BranchPredicateFact[],
): boolean =>
  (definition.branches ?? []).some((branch) =>
    useBranches.some(
      (candidate) => samePredicateSite(branch, candidate) && branch.branch !== candidate.branch,
    ),
  );

export const sourceOrder = (left: DefinitionFact, right: DefinitionFact): number =>
  left.location.startLine === right.location.startLine
    ? (left.location.startColumn ?? 0) - (right.location.startColumn ?? 0)
    : left.location.startLine - right.location.startLine;

export const settledSourceBinding = (
  candidates: readonly DefinitionFact[],
  useBranches: readonly BranchPredicateFact[],
  allowLatest: boolean,
): DefinitionFact | undefined => {
  if (!allowLatest) return candidates.length === 1 ? candidates[0] : undefined;
  const reachable = candidates
    .filter(
      (candidate) =>
        (candidate.branches?.length ?? 0) === 0 || branchPathApplies(candidate, useBranches),
    )
    .sort(sourceOrder);
  const selected = reachable.at(-1);
  if (selected === undefined) return undefined;
  const possibleLaterAlternative = candidates.some(
    (candidate) =>
      !reachable.includes(candidate) &&
      !branchPathConflicts(candidate, useBranches) &&
      endsBefore(selected.location, candidate.location),
  );
  return possibleLaterAlternative ? undefined : selected;
};

export type SourceBindingSearch = {
  readonly candidates: readonly DefinitionFact[];
  readonly allowLatest: boolean;
  readonly shadow?: 'parameter' | 'import';
};

export const sourceBindingSearch = (
  module: ModuleFacts,
  name: string,
  use: SourceLocation,
): SourceBindingSearch => {
  const scopes = callableScopesContaining(module, use);
  const shadow = scopes
    .map((scope): SourceBindingSearch['shadow'] => {
      if (scope.parameters?.some((parameter) => parameter.name === name) === true) {
        return 'parameter';
      }
      return module.imports.some(
        (imported) => imported.local === name && imported.enclosing === scope.name,
      )
        ? 'import'
        : undefined;
    })
    .find((candidate) => candidate !== undefined);
  for (const [index, scope] of scopes.entries()) {
    const redirected = module.definitions.filter(
      (definition) =>
        definition.bindingScope !== undefined &&
        sourceBindingName(definition) === name &&
        locationKey(definition.lexicalOwnerLocation) === locationKey(scope.location) &&
        (index !== 0 || endsBefore(definition.location, use)),
    );
    const candidates = [
      ...definitionsInOwner(module, name, scope.location, use, index === 0),
      ...redirected,
    ];
    if (candidates.length > 0) {
      return { candidates, allowLatest: index === 0, ...(shadow === undefined ? {} : { shadow }) };
    }
  }
  if (shadow !== undefined) return { candidates: [], allowLatest: false, shadow };
  if (
    module.imports.some((imported) => imported.local === name && imported.enclosing === undefined)
  ) {
    return { candidates: [], allowLatest: false, shadow: 'import' };
  }
  return {
    candidates: definitionsInOwner(module, name, undefined, use, scopes.length === 0),
    allowLatest: scopes.length === 0,
    ...(shadow === undefined ? {} : { shadow }),
  };
};

export type CallableResolution =
  | { readonly kind: 'callables'; readonly candidates: readonly DefinitionFact[] }
  | { readonly kind: 'external' | 'none' | 'unsettled' };

export type CallableEnvironment = ReadonlyMap<string, CallableResolution>;

export const mergeCallableResolutions = (
  resolutions: readonly CallableResolution[],
): CallableResolution => {
  if (resolutions.some((resolution) => resolution.kind === 'unsettled')) {
    return { kind: 'unsettled' };
  }
  const callable = resolutions.filter(
    (resolution): resolution is Extract<CallableResolution, { readonly kind: 'callables' }> =>
      resolution.kind === 'callables',
  );
  const external = resolutions.some((resolution) => resolution.kind === 'external');
  if (external && callable.length > 0) return { kind: 'unsettled' };
  if (callable.length > 0) {
    const unique = new Map(
      callable
        .flatMap((resolution) => resolution.candidates)
        .map((candidate) => [locationKey(candidate.location), candidate]),
    );
    return { kind: 'callables', candidates: [...unique.values()] };
  }
  return external ? { kind: 'external' } : { kind: 'none' };
};

export const resolveCallableName = (
  module: ModuleFacts,
  name: string,
  use: SourceLocation,
  useBranches: readonly BranchPredicateFact[],
  environment: CallableEnvironment,
  seen: ReadonlySet<string> = new Set(),
): CallableResolution => {
  const search = sourceBindingSearch(module, name, use);
  const fallback =
    search.shadow === 'parameter'
      ? (environment.get(name) ?? { kind: 'unsettled' as const })
      : search.shadow === 'import'
        ? ({ kind: 'external' } as const)
        : undefined;
  const reachableCandidates = search.candidates.filter(
    (candidate) => !branchPathConflicts(candidate, useBranches),
  );
  if (reachableCandidates.length === 0) return fallback ?? { kind: 'none' };
  const settled = settledSourceBinding(reachableCandidates, useBranches, search.allowLatest);
  const candidates = settled === undefined ? reachableCandidates : [settled];
  const resolutions: CallableResolution[] = [];
  for (const candidate of candidates) {
    if (candidate.kind === 'function' || candidate.kind === 'method') {
      resolutions.push({ kind: 'callables', candidates: [candidate] });
      continue;
    }
    const key = locationKey(candidate.location);
    if (seen.has(key) || candidate.value?.kind !== 'identifier') return { kind: 'unsettled' };
    const alias = resolveCallableName(
      module,
      candidate.value.name,
      candidate.location,
      candidate.branches ?? [],
      environment,
      new Set([...seen, key]),
    );
    resolutions.push(alias.kind === 'none' ? { kind: 'unsettled' } : alias);
  }
  if (settled === undefined && fallback !== undefined) resolutions.push(fallback);
  return mergeCallableResolutions(resolutions);
};

export const parameterArgument = (
  invocation: CallFact,
  parameter: NonNullable<DefinitionFact['parameters']>[number],
  index: number,
): ArgumentFact | undefined =>
  invocation.args[index]?.kind === 'object' && invocation.args[index]?.role === 'keywords'
    ? findEntry(invocation.args[index].entries, parameter.name)?.value
    : (invocation.args[index] ?? findEntry(entriesOf(invocation), parameter.name)?.value);

export const callableShadows = (
  module: ModuleFacts,
  callable: DefinitionFact,
  name: string,
): boolean => {
  if (callable.parameters?.some((parameter) => parameter.name === name) === true) return true;
  const owns = (location: SourceLocation | undefined): boolean =>
    locationKey(location) === locationKey(callable.location);
  return (
    module.definitions.some(
      (definition) =>
        definition.kind === 'variable' &&
        definition.name === name &&
        definition.bindingScope === undefined &&
        owns(definition.lexicalOwnerLocation),
    ) ||
    module.assignments.some(
      (assignment) =>
        assignment.target[0] === name &&
        assignment.bindingScope === undefined &&
        owns(assignment.lexicalOwnerLocation),
    )
  );
};

export const callableWithinComponentOwner = (
  component: BoundComponent,
  callable: DefinitionFact,
): boolean =>
  component.definition.lexicalOwnerLocation === undefined ||
  contains(component.definition.lexicalOwnerLocation, callable.location);

export const callUsesComponent = (call: CallFact, name: string): boolean =>
  (call.calleePath[0] === name && call.calleePath.length >= 2) ||
  call.args.some((argument) => argumentMentions(argument, name));

export function componentAliasesAt(
  component: BoundComponent,
  callable: DefinitionFact,
  use: SourceLocation,
  useBranches: readonly BranchPredicateFact[],
  seenReturns: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
  const aliases = new Set<string>();
  if (!callableShadows(component.module, callable, component.definition.name)) {
    aliases.add(component.definition.name);
  }
  const names = new Set(
    component.module.definitions
      .filter(
        (definition) =>
          definition.kind === 'variable' &&
          locationKey(definition.lexicalOwnerLocation) === locationKey(callable.location) &&
          endsBefore(definition.location, use) &&
          !branchPathConflicts(definition, useBranches),
      )
      .map(sourceBindingName),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of names) {
      const candidates = definitionsInOwner(
        component.module,
        name,
        callable.location,
        use,
        true,
      ).filter((candidate) => !branchPathConflicts(candidate, useBranches));
      const settled = settledSourceBinding(candidates, useBranches, true);
      const possible = settled === undefined ? candidates : [settled];
      if (
        possible.some(
          (candidate) =>
            candidate.value !== undefined &&
            ([...aliases].some((alias) =>
              argumentMentions(candidate.value as ArgumentFact, alias),
            ) ||
              callValueReturnsComponent(
                component,
                candidate.value,
                candidate.location,
                candidate.branches ?? [],
                seenReturns,
              )),
        ) &&
        !aliases.has(name)
      ) {
        aliases.add(name);
        changed = true;
      }
    }
  }
  const assignments = component.module.assignments
    .filter(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.bindingScope === undefined &&
        locationKey(assignment.lexicalOwnerLocation) === locationKey(callable.location) &&
        endsBefore(assignment.location, use),
    )
    .sort((left, right) =>
      left.location.startLine === right.location.startLine
        ? (left.location.startColumn ?? 0) - (right.location.startColumn ?? 0)
        : left.location.startLine - right.location.startLine,
    );
  for (const assignment of assignments) {
    const name = assignment.target[0];
    if (name === undefined) continue;
    const derives =
      [...aliases].some(
        (alias) =>
          argumentMentions(assignment.value, alias) ||
          assignment.sourceReferences?.some((reference) => reference[0] === alias) === true,
      ) ||
      callValueReturnsComponent(component, assignment.value, assignment.location, [], seenReturns);
    aliases.delete(name);
    if (derives) aliases.add(name);
  }
  return aliases;
}

export function callValueReturnsComponent(
  component: BoundComponent,
  value: ArgumentFact,
  use: SourceLocation,
  useBranches: readonly BranchPredicateFact[],
  seen: ReadonlySet<string>,
): boolean {
  if (value.kind !== 'call' || value.path.length !== 1 || value.path[0] === undefined) {
    return false;
  }
  const resolution = resolveCallableName(
    component.module,
    value.path[0],
    use,
    useBranches,
    new Map(),
  );
  if (resolution.kind !== 'callables') return false;
  return resolution.candidates.some((candidate) => {
    const key = locationKey(candidate.location);
    if (seen.has(key) || !callableWithinComponentOwner(component, candidate)) return false;
    const nextSeen = new Set([...seen, key]);
    return (candidate.returns ?? []).some((returned) => {
      const aliases = componentAliasesAt(
        component,
        candidate,
        returned.location,
        returned.predicate === undefined ? [] : [returned.predicate],
        nextSeen,
      );
      return (
        [...aliases].some((alias) => argumentMentions(returned.value, alias)) ||
        callValueReturnsComponent(
          component,
          returned.value,
          returned.location,
          returned.predicate === undefined ? [] : [returned.predicate],
          nextSeen,
        )
      );
    });
  });
}
