import type { SourceLocation } from '@orchescope/schema';
import type { CallFact, DefinitionFact, ModuleFacts } from '@orchescope/source-analysis';
import { createDrafts } from '../drafts.ts';
import { hasBindingAt } from '../matching.ts';
import { directCallBinding, directStableBinding } from './agentflow-components.ts';
import { invocationLimit, recordInvocationLimitFact } from './agentflow-invocation-limit.ts';
import { AGENTFLOW_ADAPTER_ID } from './agentflow-origin.ts';
import {
  argumentMentions,
  bindingDominates,
  boundName,
  contains,
  type DiscoveryState,
  endsBefore,
  type InvocationLimit,
  locationKey,
  REFUSAL_LIMIT,
  refuse,
  sameBranchPath,
  type Workflow,
} from './agentflow-state.ts';

const drafts = createDrafts(AGENTFLOW_ADAPTER_ID);

export const discoverInvocations = (state: DiscoveryState): void => {
  const byFactory = new Map<string, Workflow[]>();
  for (const workflow of state.workflows.values()) {
    if (workflow.compiledAt === undefined || workflow.definition.enclosing === undefined) continue;
    const key = `${workflow.module.file}:${workflow.definition.enclosing}`;
    byFactory.set(key, [...(byFactory.get(key) ?? []), workflow]);
  }
  for (const module of state.context.modules) {
    for (const call of module.calls) {
      if (call.calleePath.length !== 1) continue;
      const local = call.calleePath[0];
      if (local === undefined) continue;
      if (hasBindingAt(module, call.enclosing, local, call.location)) continue;
      const resolved = state.context.symbols.resolve(module.file, local);
      if (resolved?.definition?.kind !== 'function') continue;
      const candidates = byFactory.get(`${resolved.file}:${resolved.definition.name}`);
      if (candidates === undefined) continue;
      const exactDefinitions = state.context.symbols
        .definitionsOf(resolved.file)
        .filter(
          (definition) =>
            definition.kind === 'function' && definition.name === resolved.definition?.name,
        );
      const workflow =
        candidates.length === 1 &&
        exactDefinitions.length === 1 &&
        candidates[0] !== undefined &&
        factoryReturnsCompiledWorkflow(candidates[0])
          ? candidates[0]
          : undefined;
      if (workflow === undefined) {
        state.inspected.add(module.file);
        state.topology.inspectedInputs += 1;
        refuse(
          state.topology,
          'AgentFlow factory call did not resolve to one unchanged synchronous definition returning the compiled graph.',
          call.location,
        );
        continue;
      }
      settleInvocation(state, module, call, workflow);
    }
  }
};

export const factoryReturnsCompiledWorkflow = (workflow: Workflow): boolean => {
  const factoryName = workflow.definition.enclosing;
  if (factoryName === undefined || workflow.compiledAt === undefined) return false;
  const candidates = workflow.module.definitions.filter(
    (definition) =>
      definition.kind === 'function' &&
      definition.name === factoryName &&
      contains(definition.location, workflow.definition.location),
  );
  const factory = candidates.length === 1 ? candidates[0] : undefined;
  if (
    factory === undefined ||
    factory.async ||
    factory.generator === true ||
    factory.decorators.length > 0 ||
    factory.returns?.length !== 1 ||
    factory.returns[0]?.predicate !== undefined ||
    factory.returns[0]?.value.kind !== 'call' ||
    factory.returns[0].value.path[0] !== workflow.definition.name ||
    factory.returns[0].value.path[1] !== 'compile' ||
    !contains(factory.returns[0].location, workflow.compiledAt)
  ) {
    return false;
  }
  const leaf = factoryName.split('.').at(-1) ?? factoryName;
  return !workflow.module.assignments.some(
    (assignment) => assignment.target.length === 1 && assignment.target[0] === leaf,
  );
};

export const receiverEscapedBefore = (
  module: ModuleFacts,
  binding: DefinitionFact,
  invocation: CallFact,
): SourceLocation | undefined => {
  const between = (location: SourceLocation): boolean =>
    endsBefore(binding.location, location) && endsBefore(location, invocation.location);
  const assignment = module.assignments.find(
    (entry) =>
      entry.enclosing === binding.enclosing &&
      between(entry.location) &&
      (entry.target[0] === binding.name || argumentMentions(entry.value, binding.name)),
  );
  if (assignment !== undefined) return assignment.location;
  const definition = module.definitions.find(
    (entry) =>
      entry !== binding &&
      entry.enclosing === binding.enclosing &&
      between(entry.location) &&
      (entry.name === binding.name ||
        (entry.value !== undefined && argumentMentions(entry.value, binding.name))),
  );
  if (definition !== undefined) return definition.location;
  const localCallableNames = new Set(
    module.definitions
      .filter(
        (entry) =>
          (entry.kind === 'function' || entry.kind === 'method') &&
          entry.enclosing === binding.enclosing,
      )
      .map((entry) => entry.name.split('.').at(-1) ?? entry.name),
  );
  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    for (const entry of module.definitions) {
      if (
        entry.kind !== 'variable' ||
        entry.enclosing !== binding.enclosing ||
        entry.value?.kind !== 'identifier' ||
        !localCallableNames.has(entry.value.name) ||
        localCallableNames.has(entry.name)
      ) {
        continue;
      }
      localCallableNames.add(entry.name);
      aliasesChanged = true;
    }
  }
  return module.calls.find(
    (entry) =>
      entry !== invocation &&
      entry.enclosing === binding.enclosing &&
      between(entry.location) &&
      ((entry.calleePath[0] === binding.name &&
        entry.calleePath[1] !== 'invoke' &&
        entry.calleePath[1] !== 'ainvoke') ||
        entry.args.some((argument) => argumentMentions(argument, binding.name)) ||
        (entry.calleePath.length === 1 &&
          entry.calleePath[0] !== undefined &&
          localCallableNames.has(entry.calleePath[0]))),
  )?.location;
};

export const applyWorkflowInvocationPopulation = (
  state: DiscoveryState,
  workflow: Workflow,
): void => {
  if (workflow.invocations.length === 0) return;
  const bounded = workflow.invocations.filter(
    (entry): entry is (typeof workflow.invocations)[number] & { readonly limit: InvocationLimit } =>
      entry.limit !== undefined && entry.limit !== 'unsettled',
  );
  for (const entry of bounded) recordInvocationLimitFact(state, entry.limit);
  for (const entry of workflow.invocations) {
    if (entry.limit !== 'unsettled') continue;
    refuse(
      state.topology,
      'AgentFlow recursion_limit was present but did not resolve to one positive source-declared ceiling.',
      entry.call.location,
      'config_backed_bound',
    );
  }
  if (bounded.length !== workflow.invocations.length) {
    if (bounded.length > 0) {
      const firstUnbounded = workflow.invocations.find((entry) => entry.limit === undefined);
      if (firstUnbounded !== undefined) {
        refuse(
          state.topology,
          `Only ${bounded.length} of ${workflow.invocations.length} AgentFlow invocation boundaries declared a source-settled recursion ceiling.`,
          firstUnbounded.call.location,
          'config_backed_bound',
        );
      }
    }
    return;
  }
  const ceiling = bounded.reduce((highest, entry) =>
    entry.limit.value > highest.limit.value ? entry : highest,
  );
  for (const transition of workflow.transitions) {
    state.builder.addEdge(
      drafts.edge({
        kind: 'transitions_to',
        from: transition.from,
        to: transition.to,
        location: ceiling.limit.reference,
        symbol: 'recursion_limit',
        metadata: {
          conditionalBoundName: 'recursion_limit',
          conditionalBoundDefault: ceiling.limit.value,
          conditionalBoundOperator: '<=',
          conditionalBoundKind: 'invocation_ceiling',
        },
      }),
    );
    for (const entry of bounded) {
      if (locationKey(entry.limit.declaration) === locationKey(entry.limit.reference)) continue;
      state.builder.addEdge(
        drafts.edge({
          kind: 'transitions_to',
          from: transition.from,
          to: transition.to,
          location: entry.limit.declaration,
          symbol: 'recursion_limit bound population',
        }),
      );
    }
  }
};

export const recordInvocationBoundary = (
  state: DiscoveryState,
  module: ModuleFacts,
  workflow: Workflow,
  binding: DefinitionFact,
  invocation: CallFact,
): void => {
  state.builder.addComponent(
    drafts.sourceComponent({
      kind: 'workflow',
      identity: workflow.identity,
      file: module.file,
      name: boundName(workflow.definition),
      location: invocation.location,
      symbol: `${binding.name}.${invocation.calleePath[1] ?? 'invoke'}`,
      metadata: { framework: 'agentflow', invoked: true },
      tags: ['agentflow'],
    }),
  );
  state.topology.entryBoundaries += 1;
  if (state.topology.boundaryFacts.length < REFUSAL_LIMIT) {
    state.topology.boundaryFacts.push({ kind: 'entry', location: invocation.location });
  }
  state.invocationBoundaries += 1;
  workflow.invocations.push({
    module,
    call: invocation,
    limit: invocationLimit(state, module, invocation),
  });
};

export function settleDirectCompiledInvocation(
  state: DiscoveryState,
  module: ModuleFacts,
  workflow: Workflow,
  compile: CallFact,
): void {
  const binding = directCallBinding(module, compile);
  if (binding === undefined) return;
  const invocations = module.calls.filter(
    (candidate) =>
      candidate.calleePath[0] === binding.name &&
      (candidate.calleePath[1] === 'invoke' || candidate.calleePath[1] === 'ainvoke') &&
      candidate.enclosing === binding.enclosing &&
      bindingDominates(binding, candidate),
  );
  if (invocations.length === 0) {
    refuse(
      state.topology,
      'Assigned compiled AgentFlow graph had no unique source-settled invoke or ainvoke boundary.',
      compile.location,
      'entry_boundary',
    );
    return;
  }
  for (const invocation of invocations) {
    const escapedAt = receiverEscapedBefore(module, binding, invocation);
    if (escapedAt !== undefined) {
      refuse(
        state.topology,
        'Assigned compiled AgentFlow graph did not prove stable through the candidate invocation.',
        escapedAt,
        'entry_boundary',
      );
      continue;
    }
    recordInvocationBoundary(state, module, workflow, binding, invocation);
  }
}

export const settleInvocation = (
  state: DiscoveryState,
  module: ModuleFacts,
  call: CallFact,
  workflow: Workflow,
): void => {
  state.inspected.add(module.file);
  state.topology.inspectedInputs += 1;
  const binding = directStableBinding(module, call);
  if (binding === undefined) {
    refuse(
      state.topology,
      'Compiled AgentFlow factory result had no unique unchanged assigned receiver.',
      call.location,
    );
    return;
  }
  const invocation = module.calls.filter(
    (candidate) =>
      candidate.calleePath[0] === binding.name &&
      candidate.calleePath[1] === 'ainvoke' &&
      candidate.enclosing === binding.enclosing &&
      endsBefore(binding.location, candidate.location) &&
      sameBranchPath(binding, candidate),
  );
  if (invocation.length !== 1 || invocation[0] === undefined) {
    refuse(
      state.topology,
      'Compiled AgentFlow receiver had no unique source-settled ainvoke boundary.',
      call.location,
      'entry_boundary',
    );
    return;
  }
  const escapedAt = receiverEscapedBefore(module, binding, invocation[0]);
  if (escapedAt !== undefined) {
    refuse(
      state.topology,
      'Compiled AgentFlow receiver did not prove stable through the candidate ainvoke call.',
      escapedAt,
      'entry_boundary',
    );
    return;
  }
  recordInvocationBoundary(state, module, workflow, binding, invocation[0]);
};
