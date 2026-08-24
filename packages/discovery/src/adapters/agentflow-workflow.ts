import type { CallFact, ModuleFacts } from '@orchescope/source-analysis';
import { stringValue } from '@orchescope/source-analysis';
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { argumentIdentity, literalDestination, matchingReceiver } from './agentflow-components.ts';
import { settleDirectCompiledInvocation } from './agentflow-invocation.ts';
import { AGENTFLOW_ADAPTER_ID } from './agentflow-origin.ts';
import {
  boundName,
  type DiscoveryState,
  isWorkflowMethod,
  REFUSAL_LIMIT,
  refuse,
  rememberComponent,
  rememberEdge,
  type Workflow,
} from './agentflow-state.ts';

const drafts = createDrafts(AGENTFLOW_ADAPTER_ID);

export const addWorkflowNode = (
  state: DiscoveryState,
  module: ModuleFacts,
  workflow: Workflow,
  call: CallFact,
): void => {
  state.topology.inspectedInputs += 1;
  const name = stringValue(call.args[0]);
  if (name === undefined) {
    refuse(
      state.topology,
      'AgentFlow add_node did not state a bounded literal node name.',
      call.location,
      'node_registration',
    );
    return;
  }
  const identity = sourceIdentity(
    'workflow_step',
    module.file,
    `${boundName(workflow.definition)}.${name}`,
  );
  workflow.steps.set(name, identity);
  const implementation = argumentIdentity(
    module,
    workflow.definition,
    call,
    call.args[1],
    new Map([...state.agents, ...state.toolNodes]),
  );
  if (implementation !== undefined) workflow.implementation.set(name, implementation);
  else {
    refuse(
      state.topology,
      `AgentFlow node ${name} implementation did not resolve to one unchanged Agent or ToolNode binding.`,
      call.location,
      'node_registration',
    );
  }
  state.builder.addComponent(
    drafts.sourceComponent({
      kind: 'workflow_step',
      identity,
      file: module.file,
      name,
      location: call.location,
      symbol: `add_node("${name}")`,
      metadata: {
        framework: 'agentflow',
        declaredName: name,
        ...(implementation === undefined
          ? {}
          : {
              implementation: `${implementation.kind}:${implementation.namespace}/${implementation.localName}`,
            }),
      },
      tags: ['agentflow'],
    }),
  );
  state.builder.addEdge(
    drafts.edge({
      kind: 'contains',
      from: workflow.identity,
      to: identity,
      location: call.location,
      symbol: `add_node("${name}")`,
    }),
  );
  rememberComponent(state, identity);
  rememberEdge(state, 'contains', workflow.identity, identity);
};

export const addWorkflowEdge = (
  state: DiscoveryState,
  workflow: Workflow,
  call: CallFact,
): void => {
  state.topology.inspectedInputs += 1;
  const from = stringValue(call.args[0]);
  const to = stringValue(call.args[1]);
  const fromIdentity = from === undefined ? undefined : workflow.steps.get(from);
  const toIdentity = to === undefined ? undefined : workflow.steps.get(to);
  if (fromIdentity === undefined || toIdentity === undefined) {
    refuse(
      state.topology,
      'AgentFlow add_edge endpoints did not resolve to declared literal nodes.',
      call.location,
      'explicit_relation',
    );
    return;
  }
  state.builder.addEdge(
    drafts.edge({
      kind: 'transitions_to',
      from: fromIdentity,
      to: toIdentity,
      location: call.location,
      symbol: 'add_edge',
    }),
  );
  state.topology.explicitRelations += 1;
  workflow.transitions.push({
    from: fromIdentity,
    to: toIdentity,
    location: call.location,
    symbol: 'add_edge',
  });
  rememberEdge(state, 'transitions_to', fromIdentity, toIdentity);
};

export const addConditionalEdges = (
  state: DiscoveryState,
  module: ModuleFacts,
  workflow: Workflow,
  call: CallFact,
): void => {
  state.topology.inspectedInputs += 1;
  state.topology.conditionalConstructs += 1;
  const from = stringValue(call.args[0]);
  const fromIdentity = from === undefined ? undefined : workflow.steps.get(from);
  const destinations = call.args[2];
  if (fromIdentity === undefined || destinations?.kind !== 'object') {
    refuse(
      state.topology,
      'AgentFlow conditional routing source or destination map was not bounded.',
      call.location,
      'conditional_destination',
    );
    return;
  }
  for (const entry of destinations.entries) {
    const destination = literalDestination(state.context, module, call, entry.value);
    if (destination === 'END') {
      state.topology.conditionalDestinations += 1;
      state.topology.terminalBoundaries += 1;
      if (state.topology.boundaryFacts.length < REFUSAL_LIMIT) {
        state.topology.boundaryFacts.push({ kind: 'terminal', location: entry.location });
      }
      continue;
    }
    const target = destination === undefined ? undefined : workflow.steps.get(destination);
    if (target === undefined) {
      refuse(
        state.topology,
        'AgentFlow conditional destination did not resolve to a declared literal node.',
        entry.location,
        'conditional_destination',
      );
      continue;
    }
    state.builder.addEdge(
      drafts.edge({
        kind: 'transitions_to',
        from: fromIdentity,
        to: target,
        location: entry.location,
        symbol: 'add_conditional_edges',
      }),
    );
    workflow.transitions.push({
      from: fromIdentity,
      to: target,
      location: entry.location,
      symbol: 'add_conditional_edges',
    });
    state.topology.conditionalDestinations += 1;
    state.topology.explicitRelations += 1;
    rememberEdge(state, 'transitions_to', fromIdentity, target);
  }
};

export const addEntryPoint = (state: DiscoveryState, workflow: Workflow, call: CallFact): void => {
  state.topology.inspectedInputs += 1;
  const targetName = stringValue(call.args[0]);
  const target = targetName === undefined ? undefined : workflow.steps.get(targetName);
  if (target === undefined) {
    refuse(
      state.topology,
      'AgentFlow entry point did not resolve to a declared literal node.',
      call.location,
      'entry_boundary',
    );
    return;
  }
  state.topology.entryBoundaries += 1;
  state.topology.entryTargets.push(target);
  if (state.topology.boundaryFacts.length < REFUSAL_LIMIT) {
    state.topology.boundaryFacts.push({ kind: 'entry', location: call.location });
  }
};

export const addCompile = (
  state: DiscoveryState,
  module: ModuleFacts,
  workflow: Workflow,
  call: CallFact,
): void => {
  state.topology.inspectedInputs += 1;
  workflow.compiledAt = call.location;
  state.builder.addComponent(
    drafts.sourceComponent({
      kind: 'workflow',
      identity: workflow.identity,
      file: module.file,
      name: boundName(workflow.definition),
      location: call.location,
      symbol: 'compile',
      metadata: { framework: 'agentflow', compiled: true },
      tags: ['agentflow'],
    }),
  );
  settleDirectCompiledInvocation(state, module, workflow, call);
};

export const namesKnownWorkflow = (
  state: DiscoveryState,
  module: ModuleFacts,
  call: CallFact,
): boolean => {
  const receiver = call.calleePath[0];
  return (
    receiver !== undefined &&
    [...state.workflows.values()].some(
      (workflow) => workflow.module.file === module.file && workflow.definition.name === receiver,
    )
  );
};

export const discoverWorkflowCalls = (state: DiscoveryState): void => {
  for (const module of state.context.modules) {
    for (const call of module.calls) {
      const workflow = matchingReceiver(module, call, state.workflows);
      if (workflow === undefined) {
        if (isWorkflowMethod(call.calleePath[1]) && namesKnownWorkflow(state, module, call)) {
          state.topology.inspectedInputs += 1;
          refuse(
            state.topology,
            'AgentFlow graph receiver was used before construction or outside the control-flow path that establishes it.',
            call.location,
          );
        }
        continue;
      }
      state.inspected.add(module.file);
      if (workflow.unsettledAt !== undefined) continue;
      const method = call.calleePath[1];
      if (method === 'add_node') addWorkflowNode(state, module, workflow, call);
      else if (method === 'add_edge') addWorkflowEdge(state, workflow, call);
      else if (method === 'add_conditional_edges') {
        addConditionalEdges(state, module, workflow, call);
      } else if (method === 'set_entry_point') addEntryPoint(state, workflow, call);
      else if (method === 'compile') addCompile(state, module, workflow, call);
    }
  }
};
