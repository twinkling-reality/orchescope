import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SourceLocation } from '@orchescope/schema';
import type { CallFact, DefinitionFact, ModuleFacts } from '@orchescope/source-analysis';
import { findEntry } from '@orchescope/source-analysis';
import { createDrafts } from '../drafts.ts';
import {
  type CallableEnvironment,
  callableContaining,
  callableWithinComponentOwner,
  callUsesComponent,
  callValueReturnsComponent,
  componentAliasesAt,
  knownComponentConsumer,
  parameterArgument,
  resolveCallableName,
} from './agentflow-bindings.ts';
import {
  argumentIdentity,
  discoverAgentInputs,
  discoverToolPopulation,
  entriesOf,
} from './agentflow-components.ts';
import { AGENTFLOW_ADAPTER_ID } from './agentflow-origin.ts';
import {
  argumentMentions,
  type BoundComponent,
  bindingDominates,
  contains,
  type DiscoveryState,
  endsBefore,
  isWorkflowMethod,
  locationKey,
  refuse,
  rememberEdge,
  type Workflow,
} from './agentflow-state.ts';

const drafts = createDrafts(AGENTFLOW_ADAPTER_ID);

export const componentAssignmentEscape = (
  component: BoundComponent,
  callable: DefinitionFact,
): boolean =>
  component.module.assignments.some((assignment) => {
    if (
      locationKey(assignment.lexicalOwnerLocation) !== locationKey(callable.location) ||
      assignment.target[0] === undefined
    ) {
      return false;
    }
    const aliases = componentAliasesAt(component, callable, assignment.location, []);
    const writesThroughAlias = aliases.has(assignment.target[0]);
    const storesAlias =
      [...aliases].some(
        (alias) =>
          argumentMentions(assignment.value, alias) ||
          assignment.sourceReferences?.some((reference) => reference[0] === alias) === true,
      ) ||
      callValueReturnsComponent(component, assignment.value, assignment.location, [], new Set());
    return (
      (assignment.bindingScope !== undefined ||
        assignment.target.length > 1 ||
        assignment.targetIncludesSubscript === true) &&
      (writesThroughAlias || storesAlias)
    );
  });

export type ComponentOperation = 'mutates' | 'safe' | 'unsettled';

export const parameterEnvironment = (
  module: ModuleFacts,
  callable: DefinitionFact,
  invocation: CallFact,
  callerEnvironment: CallableEnvironment,
): CallableEnvironment => {
  const environment = new Map(callerEnvironment);
  for (const [index, parameter] of (callable.parameters ?? []).entries()) {
    const argument = parameterArgument(invocation, parameter, index);
    environment.set(
      parameter.name,
      argument?.kind === 'identifier'
        ? resolveCallableName(
            module,
            argument.name,
            invocation.location,
            invocation.branches ?? [],
            callerEnvironment,
          )
        : { kind: 'unsettled' },
    );
  }
  return environment;
};

export const directCallsIn = (module: ModuleFacts, callable: DefinitionFact): CallFact[] =>
  module.calls.filter(
    (call) =>
      locationKey(callableContaining(module, call.location)?.location) ===
      locationKey(callable.location),
  );

export const callableOperation = (
  component: BoundComponent,
  callable: DefinitionFact,
  invocation: CallFact,
  callerEnvironment: CallableEnvironment,
  seen: ReadonlySet<string>,
): ComponentOperation => {
  const key = locationKey(callable.location);
  if (seen.has(key)) return 'unsettled';
  const environment = parameterEnvironment(
    component.module,
    callable,
    invocation,
    callerEnvironment,
  );
  if (componentAssignmentEscape(component, callable)) return 'unsettled';
  let unsettled = false;
  for (const call of directCallsIn(component.module, callable)) {
    const aliases = componentAliasesAt(component, callable, call.location, call.branches ?? []);
    if (
      [...aliases].some((alias) => callUsesComponent(call, alias)) &&
      callableWithinComponentOwner(component, callable)
    ) {
      return aliases.has(component.definition.name) ? 'mutates' : 'unsettled';
    }
    const name = call.calleePath.length === 1 ? call.calleePath[0] : undefined;
    if (name === undefined) continue;
    const target = resolveCallableName(
      component.module,
      name,
      call.location,
      call.branches ?? [],
      environment,
    );
    if (target.kind === 'unsettled') {
      unsettled = true;
      continue;
    }
    if (target.kind !== 'callables') continue;
    for (const candidate of target.candidates) {
      const operation = callableOperation(
        component,
        candidate,
        call,
        environment,
        new Set([...seen, key]),
      );
      if (operation === 'mutates') return 'mutates';
      if (operation === 'unsettled') unsettled = true;
    }
  }
  return unsettled ? 'unsettled' : 'safe';
};

export const callInComponentOwner = (component: BoundComponent, call: CallFact): boolean => {
  const owner = callableContaining(component.module, call.location);
  return component.definition.lexicalOwnerLocation === undefined
    ? owner === undefined
    : locationKey(owner?.location) === locationKey(component.definition.lexicalOwnerLocation);
};

export const invokedLocalComponentOperation = (
  component: BoundComponent,
): SourceLocation | undefined => {
  for (const call of component.module.calls) {
    if (
      !callInComponentOwner(component, call) ||
      !endsBefore(component.definition.location, call.location) ||
      call.calleePath.length !== 1 ||
      call.calleePath[0] === undefined
    ) {
      continue;
    }
    const target = resolveCallableName(
      component.module,
      call.calleePath[0],
      call.location,
      call.branches ?? [],
      new Map(),
    );
    if (target.kind === 'unsettled') return call.location;
    if (target.kind !== 'callables') continue;
    const operations = target.candidates.map((candidate) =>
      callableOperation(component, candidate, call, new Map(), new Set()),
    );
    if (operations.some((operation) => operation !== 'safe')) return call.location;
  }
  return undefined;
};

export const componentUnstableAt = (
  state: DiscoveryState,
  component: BoundComponent,
): SourceLocation | undefined => {
  const { module, definition } = component;
  const afterConstruction = (location: SourceLocation): boolean =>
    endsBefore(definition.location, location);
  const assignment = module.assignments.find(
    (entry) =>
      entry.enclosing === definition.enclosing &&
      afterConstruction(entry.location) &&
      (entry.target[0] === definition.name || argumentMentions(entry.value, definition.name)),
  );
  if (assignment !== undefined) return assignment.location;
  const escapedDefinition = module.definitions.find((entry) => {
    if (
      entry === definition ||
      entry.enclosing !== definition.enclosing ||
      !afterConstruction(entry.location) ||
      entry.value === undefined ||
      !argumentMentions(entry.value, definition.name)
    ) {
      return false;
    }
    return !module.calls.some(
      (call) =>
        contains(entry.location, call.location) && knownComponentConsumer(state, component, call),
    );
  });
  if (escapedDefinition !== undefined) return escapedDefinition.location;
  const directCall = module.calls.find(
    (call) =>
      call.enclosing === definition.enclosing &&
      afterConstruction(call.location) &&
      ((call.calleePath[0] === definition.name && call.calleePath.length >= 2) ||
        (call.args.some((argument) => argumentMentions(argument, definition.name)) &&
          !knownComponentConsumer(state, component, call))),
  )?.location;
  return directCall ?? invokedLocalComponentOperation(component);
};

export const inspectComponentStability = (state: DiscoveryState): void => {
  for (const [key, agent] of state.agents) {
    const location = componentUnstableAt(state, agent);
    if (location === undefined) continue;
    state.unstableAgents.add(key);
    refuse(
      state.topology,
      'AgentFlow Agent endpoint population did not prove stable through its declared graph use.',
      location,
    );
  }
  for (const [key, toolNode] of state.toolNodes) {
    const location = componentUnstableAt(state, toolNode);
    if (location === undefined) continue;
    state.unstableToolNodes.add(key);
    refuse(
      state.topology,
      'AgentFlow ToolNode population did not prove stable through its declared graph use.',
      location,
    );
  }
};

export const discoverStableComponentInputs = (state: DiscoveryState): void => {
  for (const [key, agent] of state.agents) {
    if (!state.unstableAgents.has(key)) discoverAgentInputs(state, agent);
  }
  for (const [key, toolNode] of state.toolNodes) {
    if (!state.unstableToolNodes.has(key)) discoverToolPopulation(state, toolNode);
  }
};

export const invalidateWorkflow = (
  state: DiscoveryState,
  workflow: Workflow,
  location: SourceLocation,
  reason: string,
): void => {
  if (workflow.unsettledAt !== undefined) return;
  workflow.unsettledAt = location;
  state.topology.inspectedInputs += 1;
  refuse(state.topology, reason, location, 'explicit_relation');
};

export const inspectWorkflowStability = (state: DiscoveryState): void => {
  for (const workflow of state.workflows.values()) {
    const { module, definition } = workflow;
    const sameScope = (enclosing: string | undefined): boolean =>
      enclosing === definition.enclosing;
    const compileCalls = module.calls.filter(
      (call) =>
        sameScope(call.enclosing) &&
        call.calleePath[0] === definition.name &&
        call.calleePath[1] === 'compile' &&
        bindingDominates(definition, call),
    );
    if (compileCalls.length > 1 && compileCalls[1] !== undefined) {
      invalidateWorkflow(
        state,
        workflow,
        compileCalls[1].location,
        'AgentFlow graph was compiled more than once, so one authoritative topology snapshot was not established.',
      );
      continue;
    }
    const compile = compileCalls[0];
    if (compile !== undefined && (compile.branches?.length ?? 0) > 0) {
      invalidateWorkflow(
        state,
        workflow,
        compile.location,
        'AgentFlow graph compilation was conditional, so one authoritative topology snapshot was not established.',
      );
      continue;
    }
    const beforeCompile = (location: SourceLocation): boolean =>
      compile === undefined || endsBefore(location, compile.location);
    const invalidCall = module.calls.find((call) => {
      const receiver = call.calleePath[0];
      const method = call.calleePath[1];
      if (!sameScope(call.enclosing) || !beforeCompile(call.location)) return false;
      if (receiver === definition.name && isWorkflowMethod(method)) {
        return !bindingDominates(definition, call) || (call.branches?.length ?? 0) > 0;
      }
      return (
        endsBefore(definition.location, call.location) &&
        ((receiver === definition.name && call.calleePath.length >= 2) ||
          call.args.some((argument) => argumentMentions(argument, definition.name)))
      );
    });
    if (invalidCall !== undefined) {
      invalidateWorkflow(
        state,
        workflow,
        invalidCall.location,
        'AgentFlow graph topology did not prove stable through this conditional, unknown or escaping operation.',
      );
      continue;
    }
    const invalidDefinition = module.definitions.find(
      (candidate) =>
        candidate !== definition &&
        sameScope(candidate.enclosing) &&
        endsBefore(definition.location, candidate.location) &&
        beforeCompile(candidate.location) &&
        candidate.value !== undefined &&
        argumentMentions(candidate.value, definition.name),
    );
    if (invalidDefinition !== undefined) {
      invalidateWorkflow(
        state,
        workflow,
        invalidDefinition.location,
        'AgentFlow graph receiver escaped through another source binding, so later topology was not claimed.',
      );
      continue;
    }
    const invalidAssignment = module.assignments.find(
      (assignment) =>
        sameScope(assignment.enclosing) &&
        endsBefore(definition.location, assignment.location) &&
        beforeCompile(assignment.location) &&
        (assignment.target[0] === definition.name ||
          argumentMentions(assignment.value, definition.name)),
    );
    if (invalidAssignment !== undefined) {
      invalidateWorkflow(
        state,
        workflow,
        invalidAssignment.location,
        'AgentFlow graph receiver was reassigned or escaped, so later topology was not claimed.',
      );
    }
  }
};

export const connectAgentTools = (state: DiscoveryState): void => {
  for (const [key, agent] of state.agents) {
    if (state.unstableAgents.has(key)) continue;
    const entry = findEntry(entriesOf(agent.call), 'tool_node');
    const target = argumentIdentity(
      agent.module,
      agent.definition,
      agent.call,
      entry?.value,
      state.toolNodes,
    );
    if (target === undefined) {
      if (entry !== undefined) {
        refuse(
          state.topology,
          'AgentFlow Agent tool_node input did not resolve to one unchanged ToolNode binding.',
          entry.location,
        );
      }
      continue;
    }
    state.builder.addEdge(
      drafts.edge({
        kind: 'calls_tool',
        from: agent.identity,
        to: target,
        location: entry?.location ?? agent.call.location,
        symbol: 'tool_node',
        confidence: CONFIDENCE_BANDS.deterministic,
      }),
    );
    rememberEdge(state, 'calls_tool', agent.identity, target);
  }
};
