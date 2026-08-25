import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { calleeName, findEntry, stringValue } from '@orchescope/source-analysis';
import type {
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
  TopologyDiscovery,
} from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { addModelReference } from '../model-reference.ts';
import { promptCallSupport, registerPromptEntries } from '../prompt-input.ts';
import {
  deepAgentApplicability,
  deepAgentCandidateImport,
  deepAgentIdentity,
  DEEP_AGENTS_FACTORY,
  DEEP_AGENTS_MODULE,
  DEEP_AGENTS_PACKAGES,
  exactDeepAgentImports,
  exactDeepAgentRuntimeCall,
  type DeepAgentIdentity,
  type ExactDeepAgentImport,
} from './deep-agents-origin.ts';
import { addCreateAgentTools } from './langchain-v1-create-agent-tools.ts';

/** Exact source contract exported by the Deep Agents package. */

const ADAPTER_ID = 'adapter:deep-agents';
const FRAMEWORK = 'deep-agents';
const TOPOLOGY_SAMPLE_LIMIT = 10;
const drafts = createDrafts(ADAPTER_ID);

type TopologyAccumulator = {
  status: 'complete' | 'incomplete';
  inspectedInputs: number;
  explicitRelations: number;
  entryBoundaries: number;
  entryTargets: ComponentIdentity[];
  boundaryFacts: TopologyDiscovery['boundaryFacts'][number][];
  unresolvedCount: number;
  unresolved: TopologyDiscovery['unresolved'][number][];
};

const topologyAccumulator = (inspectedInputs: number): TopologyAccumulator => ({
  status: 'complete',
  inspectedInputs,
  explicitRelations: 0,
  entryBoundaries: 0,
  entryTargets: [],
  boundaryFacts: [],
  unresolvedCount: 0,
  unresolved: [],
});

const refuseTopology = (
  topology: TopologyAccumulator,
  refusal: TopologyDiscovery['unresolved'][number],
): void => {
  topology.status = 'incomplete';
  topology.unresolvedCount += 1;
  if (topology.unresolved.length < TOPOLOGY_SAMPLE_LIMIT) topology.unresolved.push(refusal);
};

const topologyDiscovery = (topology: TopologyAccumulator): TopologyDiscovery => ({
  ...topology,
  conditionalConstructs: 0,
  conditionalDestinations: 0,
  entryBoundaries: topology.entryBoundaries,
  entryTargets: topology.entryTargets,
  terminalBoundaries: 0,
  boundaryFacts: topology.boundaryFacts,
  configurationBounds: 0,
  configurationBoundFacts: [],
});

const keywordEntries = (call: CallFact): readonly ObjectEntryFact[] => {
  for (let index = call.args.length - 1; index >= 0; index -= 1) {
    const argument = call.args[index];
    if (argument?.kind === 'object' && argument.role === 'keywords') return argument.entries;
  }
  return [];
};

const argumentAt = (
  call: CallFact,
  entries: readonly ObjectEntryFact[],
  name: string,
  position: number,
): { readonly value: ArgumentFact | undefined; readonly location: SourceLocation } => {
  const keyword = findEntry(entries, name);
  return {
    value:
      keyword?.value ?? (call.args[position]?.kind === 'object' ? undefined : call.args[position]),
    location: keyword?.location ?? call.location,
  };
};

const refuseUnsettledCollection = (
  topology: TopologyAccumulator,
  name: string,
  value: ArgumentFact | undefined,
  location: SourceLocation,
): void => {
  if (
    value === undefined ||
    (value.kind === 'array' && value.complete !== false && value.items.length === 0)
  ) {
    return;
  }
  refuseTopology(topology, {
    kind: 'explicit_relation',
    reason: `${DEEP_AGENTS_FACTORY} ${name} are not an empty bounded list whose endpoint population is source-settled.`,
    location,
  });
};

const invocationMethods = new Set(['invoke', 'ainvoke', 'stream', 'astream']);

const registerInvocationBoundary = (
  topology: TopologyAccumulator,
  module: ModuleFacts,
  call: CallFact,
  settlement: DeepAgentIdentity,
  identity: ComponentIdentity,
): void => {
  const bindings = new Set(settlement.bindings);
  const invocations = module.calls.filter(
    (candidate) =>
      candidate !== call &&
      bindings.has(candidate.calleePath[0] ?? '') &&
      invocationMethods.has(calleeName(candidate)),
  );
  if (invocations.length === 0) {
    refuseTopology(topology, {
      kind: 'entry_boundary',
      reason: `${DEEP_AGENTS_MODULE}.${DEEP_AGENTS_FACTORY} returned graph has no source-settled direct invocation boundary in its declaration module.`,
      location: call.location,
    });
    return;
  }
  topology.entryBoundaries += invocations.length;
  if (
    !topology.entryTargets.some(
      (candidate) =>
        candidate.namespace === identity.namespace &&
        candidate.localName === identity.localName &&
        candidate.kind === identity.kind,
    )
  ) {
    topology.entryTargets.push(identity);
  }
  for (const invocation of invocations) {
    topology.boundaryFacts.push({ kind: 'entry', location: invocation.location });
  }
};

const addDeepAgent = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  module: ModuleFacts,
  call: CallFact,
  imported: ExactDeepAgentImport,
  settlement: DeepAgentIdentity,
  topology: TopologyAccumulator,
): { readonly components: number; readonly edges: number } => {
  const identity: ComponentIdentity = sourceIdentity('agent', module.file, settlement.name);
  const common = {
    kind: 'agent' as const,
    identity,
    file: module.file,
    name: settlement.name,
    confidence: CONFIDENCE_BANDS.deterministic,
    details: { for: 'agent' as const, framework: FRAMEWORK, role: 'worker' as const },
    metadata: {
      framework: FRAMEWORK,
      factory: DEEP_AGENTS_FACTORY,
      sourceBinding: settlement.name,
      ...(settlement.declaredName === undefined ? {} : { declaredName: settlement.declaredName }),
    },
    tags: [FRAMEWORK],
  };
  for (const evidence of [
    {
      location: imported.entry.location,
      symbol: `${DEEP_AGENTS_MODULE}.${DEEP_AGENTS_FACTORY} import`,
    },
    {
      location: call.location,
      symbol: `${DEEP_AGENTS_MODULE}.${DEEP_AGENTS_FACTORY} call`,
    },
    { location: settlement.basis, symbol: `agent identity: ${settlement.name}` },
  ]) {
    builder.addComponent(drafts.sourceComponent({ ...common, ...evidence }));
  }
  for (const binding of new Set(settlement.bindings)) {
    context.bindings.register(module.file, binding, identity);
  }
  context.implementations.record({
    identity,
    file: module.file,
    body: settlement.implementation,
    symbol: `${DEEP_AGENTS_FACTORY}(${settlement.name})`,
  });
  registerInvocationBoundary(topology, module, call, settlement, identity);

  const entries = keywordEntries(call);
  registerPromptEntries({
    registry: context.promptInputs,
    producer: ADAPTER_ID,
    module,
    call,
    consumer: identity,
    entries,
    channels: ['system_prompt'],
    supportingLocations: [imported.entry.location, ...promptCallSupport(module, call)],
  });

  let components = 1;
  let edges = 0;
  const model = argumentAt(call, entries, 'model', 0);
  const declaredModel = stringValue(model.value);
  if (declaredModel === undefined || declaredModel.trim().length === 0) {
    refuseTopology(topology, {
      kind: 'explicit_relation',
      reason: `${DEEP_AGENTS_FACTORY} model is absent or computed rather than a source-settled literal reference.`,
      location: model.location,
    });
  } else {
    const added = addModelReference({
      drafts,
      builder,
      declared: declaredModel,
      file: module.file,
      location: model.location,
      framework: FRAMEWORK,
      invokedBy: identity,
      confidence: CONFIDENCE_BANDS.deterministic,
    });
    components += added.components;
    edges += added.edges;
  }

  const tools = argumentAt(call, entries, 'tools', 1);
  const addedTools = addCreateAgentTools({
    context,
    builder,
    drafts,
    module,
    agent: identity,
    value: tools.value,
    location: tools.location,
    factory: DEEP_AGENTS_FACTORY,
    framework: FRAMEWORK,
    refuse: (refusal) => refuseTopology(topology, refusal),
  });
  components += addedTools.components;
  edges += addedTools.edges;

  for (const name of ['subagents', 'skills', 'permissions'] as const) {
    const argument = argumentAt(call, entries, name, Number.MAX_SAFE_INTEGER);
    refuseUnsettledCollection(topology, name, argument.value, argument.location);
  }
  return { components, edges };
};

export const deepAgentsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  packages: DEEP_AGENTS_PACKAGES,
  applicability: deepAgentApplicability,
  appliesTo: (context) => deepAgentApplicability(context).length > 0,
  discover: (context, builder): AdapterFindings => {
    const applicable = deepAgentApplicability(context);
    const topology = topologyAccumulator(applicable.length);
    const inspected = new Set<string>();
    let components = 0;
    let edges = 0;

    for (const module of context.modules) {
      const imports = exactDeepAgentImports(context, module);
      if (imports.length === 0) continue;
      inspected.add(module.file);
      if (module.parseErrors.length > 0) {
        const firstImport = imports[0];
        refuseTopology(topology, {
          kind: 'adapter_input',
          reason: 'This exact Deep Agents factory module contains a syntax error.',
          ...(firstImport === undefined ? {} : { location: firstImport.entry.location }),
        });
      }
      const candidates = module.calls.filter(
        (call) => deepAgentCandidateImport(imports, call) !== undefined,
      );
      const accepted = candidates.filter(
        (call) => exactDeepAgentRuntimeCall(context, module, imports, call) !== undefined,
      );
      for (const call of candidates) {
        const imported = exactDeepAgentRuntimeCall(context, module, imports, call);
        if (imported === undefined) {
          refuseTopology(topology, {
            kind: 'adapter_input',
            reason: `${DEEP_AGENTS_FACTORY} did not retain the exact unshadowed ${DEEP_AGENTS_MODULE} runtime binding.`,
            location: call.location,
          });
          continue;
        }
        const settlement = deepAgentIdentity(module, call, accepted);
        if (settlement === undefined) {
          refuseTopology(topology, {
            kind: 'node_registration',
            reason: `${DEEP_AGENTS_MODULE}.${DEEP_AGENTS_FACTORY} has no unique literal, assigned-variable or enclosing-callable identity.`,
            location: call.location,
          });
          continue;
        }

        const added = addDeepAgent(context, builder, module, call, imported, settlement, topology);
        components += added.components;
        edges += added.edges;
      }
    }

    topology.explicitRelations = edges;
    return {
      componentsFound: components,
      edgesFound: edges,
      filesInspected: [...inspected],
      topology: topologyDiscovery(topology),
    };
  },
};
