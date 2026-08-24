import type { SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { findEntry, numberValue } from '@orchescope/source-analysis';
import { entriesOf } from './agentflow-components.ts';
import {
  argumentMentions,
  bindingDominates,
  contains,
  type DiscoveryState,
  endsBefore,
  type InvocationLimit,
  locationKey,
  REFUSAL_LIMIT,
} from './agentflow-state.ts';

export const exactDefinitionBefore = (
  module: ModuleFacts,
  name: string,
  use: CallFact,
): DefinitionFact | undefined => {
  const candidates = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === name &&
      definition.enclosing === use.enclosing &&
      bindingDominates(definition, use),
  );
  const definition = candidates.length === 1 ? candidates[0] : undefined;
  if (definition === undefined) return undefined;
  const changed = module.assignments.some(
    (assignment) =>
      assignment.target[0] === name &&
      assignment.enclosing === use.enclosing &&
      endsBefore(definition.location, assignment.location) &&
      endsBefore(assignment.location, use.location),
  );
  return changed ? undefined : definition;
};

export const configObjectAt = (
  module: ModuleFacts,
  invocation: CallFact,
):
  | {
      readonly entries: readonly ObjectEntryFact[];
      readonly location: SourceLocation;
      readonly complete: boolean;
    }
  | 'unsettled'
  | undefined => {
  const keywordEntry = findEntry(entriesOf(invocation), 'config');
  const keyword = keywordEntry?.value ?? invocation.args[1];
  if (keyword === undefined) return undefined;
  if (keyword?.kind === 'object') {
    return {
      entries: keyword.entries,
      location: invocation.location,
      complete: keyword.complete === true,
    };
  }
  if (keyword?.kind !== 'identifier') return 'unsettled';
  const definition = exactDefinitionBefore(module, keyword.name, invocation);
  if (definition?.value?.kind !== 'object') return 'unsettled';
  const escaped =
    module.definitions.some(
      (candidate) =>
        candidate !== definition &&
        candidate.enclosing === definition.enclosing &&
        endsBefore(definition.location, candidate.location) &&
        endsBefore(candidate.location, invocation.location) &&
        candidate.value !== undefined &&
        argumentMentions(candidate.value, definition.name),
    ) ||
    module.calls.some(
      (call) =>
        call !== invocation &&
        call.enclosing === definition.enclosing &&
        endsBefore(definition.location, call.location) &&
        endsBefore(call.location, invocation.location) &&
        (call.calleePath[0] === definition.name ||
          call.args.some((argument) => argumentMentions(argument, definition.name))),
    );
  return escaped
    ? 'unsettled'
    : {
        entries: definition.value.entries,
        location: definition.location,
        complete: definition.value.complete === true,
      };
};

export const parameterShadows = (
  module: ModuleFacts,
  name: string,
  location: SourceLocation,
): boolean =>
  module.definitions.some(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      contains(definition.location, location) &&
      definition.parameters?.some((parameter) => parameter.name === name) === true,
  );

export const mapDefinitionFor = (
  state: DiscoveryState,
  module: ModuleFacts,
  root: string,
  use: DefinitionFact,
): { readonly module: ModuleFacts; readonly definition: DefinitionFact } | undefined => {
  if (parameterShadows(module, root, use.location)) return undefined;
  const local = module.definitions
    .filter(
      (candidate) =>
        candidate.kind === 'variable' &&
        candidate.name === root &&
        candidate.enclosing === use.enclosing &&
        endsBefore(candidate.location, use.location) &&
        (candidate.branches ?? []).every((branch) =>
          use.branches?.some(
            (owner) =>
              owner.operator === branch.operator &&
              owner.branch === branch.branch &&
              locationKey(owner.location) === locationKey(branch.location),
          ),
        ),
    )
    .sort((left, right) => right.location.startLine - left.location.startLine);
  if (local[0] !== undefined) return { module, definition: local[0] };
  const resolved = state.context.symbols.resolve(module.file, root);
  const resolvedModule =
    resolved === undefined ? undefined : state.context.symbols.moduleOf(resolved.file);
  return resolved?.definition?.kind === 'variable' && resolvedModule !== undefined
    ? { module: resolvedModule, definition: resolved.definition }
    : undefined;
};

export const mapDefinitionStable = (
  mapModule: ModuleFacts,
  map: DefinitionFact,
  useModule: ModuleFacts,
  use: DefinitionFact,
): boolean => {
  const sameModule = mapModule.file === useModule.file;
  const changed = mapModule.assignments.some(
    (assignment) =>
      assignment.target[0] === map.name &&
      endsBefore(map.location, assignment.location) &&
      (!sameModule || endsBefore(assignment.location, use.location)),
  );
  const escaped = mapModule.definitions.some(
    (candidate) =>
      candidate !== map &&
      candidate.value !== undefined &&
      endsBefore(map.location, candidate.location) &&
      (!sameModule || endsBefore(candidate.location, use.location)) &&
      argumentMentions(candidate.value, map.name),
  );
  const called = mapModule.calls.some(
    (call) =>
      endsBefore(map.location, call.location) &&
      (!sameModule || endsBefore(call.location, use.location)) &&
      (call.calleePath[0] === map.name ||
        call.args.some((argument) => argumentMentions(argument, map.name))),
  );
  return !changed && !escaped && !called;
};

export const boundedGetLimit = (
  state: DiscoveryState,
  module: ModuleFacts,
  invocation: CallFact,
  value: ArgumentFact,
): { readonly value: number; readonly declaration: SourceLocation } | undefined => {
  if (value.kind !== 'identifier') return undefined;
  const definition = exactDefinitionBefore(module, value.name, invocation);
  if (
    definition?.value?.kind !== 'call' ||
    definition.value.path.length !== 2 ||
    definition.value.path[1] !== 'get'
  ) {
    return undefined;
  }
  const fallback = numberValue(definition.value.args[1]);
  const root = definition.value.path[0];
  if (fallback === undefined || root === undefined) return undefined;
  const settledMap = mapDefinitionFor(state, module, root, definition);
  const resolved = settledMap?.definition;
  if (
    resolved?.value?.kind !== 'object' ||
    resolved.value.complete !== true ||
    settledMap === undefined ||
    !mapDefinitionStable(settledMap.module, resolved, module, definition)
  ) {
    return undefined;
  }
  const resolvedDefinitions = state.context.symbols
    .definitionsOf(settledMap.module.file)
    .filter((candidate) => candidate.kind === 'variable' && candidate.name === resolved.name);
  if (resolvedDefinitions.length !== 1) return undefined;
  const values = resolved.value.entries.map((entry) => numberValue(entry.value));
  if (values.length === 0 || values.some((entry) => entry === undefined)) return undefined;
  const possible = [...(values as number[]), fallback];
  if (possible.some((entry) => !Number.isInteger(entry) || entry <= 0)) return undefined;
  return { value: Math.max(...possible), declaration: resolved.location };
};

export const invocationLimit = (
  state: DiscoveryState,
  module: ModuleFacts,
  invocation: CallFact,
): InvocationLimit | 'unsettled' | undefined => {
  const config = configObjectAt(module, invocation);
  if (config === 'unsettled') return 'unsettled';
  if (config === undefined) return undefined;
  const limitEntries = config.entries.filter((entry) => entry.key === 'recursion_limit');
  if (!config.complete || limitEntries.length > 1) return 'unsettled';
  const entry = limitEntries[0];
  if (entry === undefined) return undefined;
  const literal = numberValue(entry.value);
  if (literal !== undefined && Number.isInteger(literal) && literal > 0) {
    return { value: literal, reference: entry.location, declaration: entry.location };
  }
  const bounded = boundedGetLimit(state, module, invocation, entry.value);
  return bounded === undefined ? 'unsettled' : { ...bounded, reference: entry.location };
};

export const recordInvocationLimitFact = (state: DiscoveryState, limit: InvocationLimit): void => {
  state.topology.configurationBounds += 1;
  if (state.topology.configurationBoundFacts.length < REFUSAL_LIMIT) {
    state.topology.configurationBoundFacts.push({
      name: 'recursion_limit',
      kind: 'invocation_ceiling',
      ceilingValue: limit.value,
      reference: limit.reference,
      declaration: limit.declaration,
    });
  }
};
