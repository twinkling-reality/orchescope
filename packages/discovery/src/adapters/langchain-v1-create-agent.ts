import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { findEntry, stringValue } from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, TopologyDiscovery } from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { addModelReference } from '../model-reference.ts';
import {
  createAgentApplicability,
  createAgentCandidateImport,
  exactCreateAgentImports,
  exactCreateAgentRuntimeCall,
  LANGCHAIN_CREATE_AGENT_ADAPTER_ID,
  LANGCHAIN_CREATE_AGENT_EXPORT,
  LANGCHAIN_CREATE_AGENT_MODULE,
  LANGCHAIN_CREATE_AGENT_PACKAGES,
  type ExactCreateAgentImport,
} from './langchain-v1-create-agent-origin.ts';
import { addCreateAgentTools } from './langchain-v1-create-agent-tools.ts';

/**
 * LangChain v1 `create_agent` declarations.
 *
 * The factory is deliberately separate from LangGraph. `create_agent` is exported by
 * `langchain.agents`, and a call is provider evidence only when its runtime binding resolves to that
 * exact export. A bare spelling, a nearby submodule and a local package with the same name prove
 * nothing.
 *
 * The factory accepts values the source may compute at runtime. This reader records only literal
 * model references and direct lists of locally resolved tools. Every other endpoint stays absent and
 * becomes a bounded topology refusal, so a partial graph cannot support a closed-world claim.
 */

const TOPOLOGY_SAMPLE_LIMIT = 10;
const drafts = createDrafts(LANGCHAIN_CREATE_AGENT_ADAPTER_ID);

type TopologyAccumulator = {
  status: 'complete' | 'incomplete';
  inspectedInputs: number;
  explicitRelations: number;
  unresolvedCount: number;
  unresolved: TopologyDiscovery['unresolved'][number][];
};

const topologyAccumulator = (inspectedInputs: number): TopologyAccumulator => ({
  status: 'complete',
  inspectedInputs,
  explicitRelations: 0,
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
  entryBoundaries: 0,
  entryTargets: [],
  terminalBoundaries: 0,
  boundaryFacts: [],
  configurationBounds: 0,
  configurationBoundFacts: [],
});

const keywordEntries = (call: CallFact): readonly ObjectEntryFact[] => {
  for (let index = call.args.length - 1; index >= 0; index -= 1) {
    const argument = call.args[index];
    if (argument?.kind === 'object') return argument.entries;
  }
  return [];
};

const containsLine = (definition: DefinitionFact, call: CallFact): boolean =>
  definition.location.startLine <= call.location.startLine &&
  (definition.location.endLine ?? definition.location.startLine) >= call.location.startLine;

const stableAssignedVariable = (
  module: ModuleFacts,
  call: CallFact,
): DefinitionFact | undefined => {
  const containing = module.definitions.filter(
    (definition) => definition.kind === 'variable' && containsLine(definition, call),
  );
  if (containing.length !== 1) return undefined;
  const candidate = containing[0];
  if (candidate === undefined) return undefined;
  const definitions = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === candidate.name &&
      definition.enclosing === candidate.enclosing,
  );
  const assigned = module.assignments.some(
    (assignment) =>
      assignment.target.length === 1 &&
      assignment.target[0] === candidate.name &&
      assignment.enclosing === candidate.enclosing,
  );
  return definitions.length === 1 && !assigned ? candidate : undefined;
};

const callableOwner = (module: ModuleFacts, call: CallFact): DefinitionFact | undefined => {
  if (call.enclosing === undefined) return undefined;
  const candidates = module.definitions.filter(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      (definition.name === call.enclosing || definition.name.endsWith(`.${call.enclosing}`)) &&
      containsLine(definition, call),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
};

const localNameOf = (definition: DefinitionFact): string =>
  definition.name.split('.').at(-1) ?? definition.name;

type IdentitySettlement = {
  readonly name: string;
  readonly basis: SourceLocation;
  readonly implementation: SourceLocation;
  readonly bindingNames: readonly string[];
};

const identityFor = (
  module: ModuleFacts,
  call: CallFact,
  acceptedCalls: readonly CallFact[],
): IdentitySettlement | undefined => {
  const entries = keywordEntries(call);
  const declaredEntry = findEntry(entries, 'name');
  const declaredName = stringValue(declaredEntry?.value);
  const variable = stableAssignedVariable(module, call);
  const owner = callableOwner(module, call);
  const implementation = owner?.location ?? variable?.location ?? call.location;
  const ownerCalls =
    owner === undefined ? [] : acceptedCalls.filter((candidate) => containsLine(owner, candidate));
  const ownerBindings =
    owner === undefined || ownerCalls.length !== 1 ? [] : [owner.name, localNameOf(owner)];

  if (declaredName !== undefined && declaredName.trim().length > 0 && declaredEntry !== undefined) {
    return {
      name: declaredName,
      basis: declaredEntry.location,
      implementation,
      bindingNames: [
        declaredName,
        ...(variable === undefined ? [] : [variable.name]),
        ...ownerBindings,
      ],
    };
  }
  if (variable !== undefined) {
    return {
      name: variable.name,
      basis: variable.location,
      implementation,
      bindingNames: [variable.name, ...ownerBindings],
    };
  }
  if (owner !== undefined && ownerCalls.length === 1) {
    const name = localNameOf(owner);
    return {
      name,
      basis: owner.location,
      implementation: owner.location,
      bindingNames: [name, owner.name],
    };
  }
  return undefined;
};

const addAgentEvidence = (input: {
  readonly builder: SystemGraphBuilder;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly imported: ExactCreateAgentImport;
  readonly settlement: IdentitySettlement;
  readonly identity: ComponentIdentity;
}): void => {
  const common = {
    kind: 'agent' as const,
    identity: input.identity,
    file: input.module.file,
    name: input.settlement.name,
    confidence: CONFIDENCE_BANDS.deterministic,
    details: {
      for: 'agent' as const,
      framework: 'langchain-v1',
      role: 'worker' as const,
    },
    metadata: {
      framework: 'langchain-v1',
      declaredName: input.settlement.name,
      factory: LANGCHAIN_CREATE_AGENT_EXPORT,
    },
    tags: ['langchain-v1'],
  };
  input.builder.addComponent(
    drafts.sourceComponent({
      ...common,
      location: input.imported.entry.location,
      symbol: `${LANGCHAIN_CREATE_AGENT_MODULE}.${LANGCHAIN_CREATE_AGENT_EXPORT} import`,
    }),
  );
  input.builder.addComponent(
    drafts.sourceComponent({
      ...common,
      location: input.call.location,
      symbol: `${LANGCHAIN_CREATE_AGENT_MODULE}.${LANGCHAIN_CREATE_AGENT_EXPORT} call`,
    }),
  );
  input.builder.addComponent(
    drafts.sourceComponent({
      ...common,
      location: input.settlement.basis,
      symbol: `agent identity: ${input.settlement.name}`,
    }),
  );
};

const modelArgument = (
  call: CallFact,
  entries: readonly ObjectEntryFact[],
): { readonly value: ArgumentFact | undefined; readonly location: SourceLocation } => {
  const keyword = findEntry(entries, 'model');
  return {
    value: keyword?.value ?? (call.args[0]?.kind === 'object' ? undefined : call.args[0]),
    location: keyword?.location ?? call.location,
  };
};

const toolsArgument = (
  call: CallFact,
  entries: readonly ObjectEntryFact[],
): { readonly value: ArgumentFact | undefined; readonly location: SourceLocation } => {
  const keyword = findEntry(entries, 'tools');
  return {
    value: keyword?.value ?? (call.args[1]?.kind === 'object' ? undefined : call.args[1]),
    location: keyword?.location ?? call.location,
  };
};

export const langChainV1CreateAgentAdapter: AgentSystemAdapter = {
  id: LANGCHAIN_CREATE_AGENT_ADAPTER_ID,
  version: '1',
  packages: LANGCHAIN_CREATE_AGENT_PACKAGES,
  applicability: createAgentApplicability,
  appliesTo: (context) => createAgentApplicability(context).length > 0,
  discover: (context, builder): AdapterFindings => {
    const applicability = createAgentApplicability(context);
    const topology = topologyAccumulator(applicability.length);
    const inspected = new Set<string>();
    let components = 0;
    let edges = 0;

    for (const module of context.modules) {
      const imports = exactCreateAgentImports(context, module);
      if (imports.length === 0) continue;
      inspected.add(module.file);
      if (module.parseErrors.length > 0) {
        const firstImport = imports[0];
        refuseTopology(topology, {
          kind: 'adapter_input',
          reason:
            'This create_agent module contains a syntax error, so its declaration population is partial.',
          ...(firstImport === undefined ? {} : { location: firstImport.entry.location }),
        });
      }

      const candidates = module.calls.filter(
        (call) => createAgentCandidateImport(imports, call) !== undefined,
      );
      const accepted = candidates.filter(
        (call) => exactCreateAgentRuntimeCall(module, imports, call) !== undefined,
      );
      for (const call of candidates) {
        const imported = exactCreateAgentRuntimeCall(module, imports, call);
        if (imported === undefined) {
          refuseTopology(topology, {
            kind: 'adapter_input',
            reason:
              'A create_agent spelling did not retain the exact unshadowed langchain.agents runtime binding.',
            location: call.location,
          });
          continue;
        }
        const settlement = identityFor(module, call, accepted);
        if (settlement === undefined) {
          refuseTopology(topology, {
            kind: 'node_registration',
            reason:
              'A langchain.agents.create_agent call has no unique literal, assigned-variable or enclosing-callable identity.',
            location: call.location,
          });
          continue;
        }

        const identity = sourceIdentity('agent', module.file, settlement.name);
        addAgentEvidence({ builder, module, call, imported, settlement, identity });
        components += 1;
        for (const binding of new Set(settlement.bindingNames)) {
          context.bindings.register(module.file, binding, identity);
        }
        context.implementations.record({
          identity,
          file: module.file,
          body: settlement.implementation,
          symbol: `${LANGCHAIN_CREATE_AGENT_EXPORT}(${settlement.name})`,
        });

        const entries = keywordEntries(call);
        const model = modelArgument(call, entries);
        const declaredModel = stringValue(model.value);
        if (declaredModel === undefined || declaredModel.trim().length === 0) {
          refuseTopology(topology, {
            kind: 'explicit_relation',
            reason:
              'create_agent model is absent or computed rather than a source-settled literal reference.',
            location: model.location,
          });
        } else {
          const added = addModelReference({
            drafts,
            builder,
            declared: declaredModel,
            file: module.file,
            location: model.location,
            framework: 'langchain-v1',
            invokedBy: identity,
            confidence: CONFIDENCE_BANDS.deterministic,
          });
          components += added.components;
          edges += added.edges;
        }

        const tools = toolsArgument(call, entries);
        const addedTools = addCreateAgentTools({
          context,
          builder,
          drafts,
          module,
          agent: identity,
          value: tools.value,
          location: tools.location,
          refuse: (refusal) => refuseTopology(topology, refusal),
        });
        components += addedTools.components;
        edges += addedTools.edges;
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
