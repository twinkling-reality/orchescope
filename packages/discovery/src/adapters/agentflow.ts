import type { SystemGraphBuilder } from '@orchescope/graph';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { discoverConstructions } from './agentflow-components.ts';
import { applyWorkflowInvocationPopulation, discoverInvocations } from './agentflow-invocation.ts';
import {
  AGENTFLOW_ADAPTER_ID,
  AGENTFLOW_PACKAGES,
  agentflowApplicability,
} from './agentflow-origin.ts';
import {
  connectAgentTools,
  discoverStableComponentInputs,
  inspectComponentStability,
  inspectWorkflowStability,
} from './agentflow-stability.ts';
import { type DiscoveryState, refuse, topology } from './agentflow-state.ts';
import { discoverWorkflowCalls } from './agentflow-workflow.ts';

const discover = (context: DiscoveryContext, builder: SystemGraphBuilder): AdapterFindings => {
  const state = topology();
  const discovery: DiscoveryState = {
    context,
    builder,
    topology: state,
    inspected: new Set(),
    agents: new Map(),
    toolNodes: new Map(),
    workflows: new Map(),
    unstableAgents: new Set(),
    unstableToolNodes: new Set(),
    componentIds: new Set(),
    edgeIds: new Set(),
    invocationBoundaries: 0,
  };
  discoverConstructions(discovery);
  inspectWorkflowStability(discovery);
  inspectComponentStability(discovery);
  discoverStableComponentInputs(discovery);
  connectAgentTools(discovery);
  discoverWorkflowCalls(discovery);
  discoverInvocations(discovery);
  for (const workflow of discovery.workflows.values()) {
    applyWorkflowInvocationPopulation(discovery, workflow);
  }

  if (discovery.agents.size > 0 && discovery.workflows.size === 0) {
    const firstAgent = discovery.agents.values().next().value;
    if (firstAgent !== undefined) {
      refuse(
        state,
        'AgentFlow Agent construction had no source-settled StateGraph topology.',
        firstAgent.call.location,
      );
    }
  }

  if (state.inspectedInputs === 0) {
    state.status = 'incomplete';
    state.unresolvedCount += 1;
    state.unresolved.push({
      kind: 'adapter_input',
      reason:
        'AgentFlow imports were present but no supported graph construction input was inspected.',
    });
  }
  return {
    componentsFound: discovery.componentIds.size,
    edgesFound: discovery.edgeIds.size,
    filesInspected: [...discovery.inspected].sort(),
    note:
      discovery.componentIds.size === 0
        ? 'AgentFlow runtime imports were inspected, but no stable supported construction was retained.'
        : `AgentFlow source constructions were retained with ${discovery.edgeIds.size} distinct source-settled relations and ${discovery.invocationBoundaries} compiled invocation boundaries.`,
    topology: state,
  };
};

export const agentflowAdapter: AgentSystemAdapter = {
  id: AGENTFLOW_ADAPTER_ID,
  version: '1',
  packages: AGENTFLOW_PACKAGES,
  applicability: agentflowApplicability,
  appliesTo: (context) => agentflowApplicability(context).length > 0,
  discover,
};
