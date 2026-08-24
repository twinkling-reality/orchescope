import { CONFIDENCE_BANDS, identityKey } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
} from '@orchescope/source-analysis';
import type {
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
  TopologyDiscovery,
} from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { hasBindingAt, matchRuntimeSymbol } from '../matching.ts';
import {
  type LegacyEndpointChange,
  legacyEndpointStability,
} from './langchain-legacy-agent-endpoint-stability.ts';
import {
  LANGCHAIN_LEGACY_AGENT_ADAPTER_ID,
  LANGCHAIN_LEGACY_AGENT_PACKAGES,
  LANGCHAIN_LEGACY_EXECUTOR_EXPORT,
  LANGCHAIN_LEGACY_FACTORY_EXPORT,
  legacyAgentApplicability,
  legacyAgentCandidateCall,
  legacyAgentImports,
} from './langchain-legacy-agent-origin.ts';
import {
  type LegacyConstruction,
  type LegacyTemplate,
  legacyArgumentMentions,
  legacyDirectDefinition,
  legacyWrapperBindingHolds,
  settleLegacyAgentConstructions,
} from './langchain-legacy-agent-settlement.ts';
import { settleChatOpenAiConfiguration } from './langchain-openai-chat-configuration.ts';
import {
  exactChatOpenAiImports,
  exactChatOpenAiRuntimeCall,
} from './langchain-openai-chat-model-origin.ts';

const drafts = createDrafts(LANGCHAIN_LEGACY_AGENT_ADAPTER_ID);
const TOPOLOGY_SAMPLE_LIMIT = 10;

type Refusal = TopologyDiscovery['unresolved'][number];

type TopologyAccumulator = {
  status: 'complete' | 'incomplete';
  inspectedInputs: number;
  explicitRelations: number;
  unresolvedCount: number;
  controlFlowUnresolvedCount: number;
  promptUseUnresolvedCount: number;
  unresolved: Refusal[];
};

type StableDefinition = {
  readonly definition: DefinitionFact;
  readonly value: ArgumentFact | undefined;
};

const topologyAccumulator = (inspectedInputs: number): TopologyAccumulator => ({
  status: 'complete',
  inspectedInputs,
  explicitRelations: 0,
  unresolvedCount: 0,
  controlFlowUnresolvedCount: 0,
  promptUseUnresolvedCount: 0,
  unresolved: [],
});

const refuse = (topology: TopologyAccumulator, refusal: Refusal): void => {
  topology.status = 'incomplete';
  topology.unresolvedCount += 1;
  if (refusal.scope === 'prompt_use') topology.promptUseUnresolvedCount += 1;
  else topology.controlFlowUnresolvedCount += 1;
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

const endsBefore = (left: SourceLocation, right: SourceLocation): boolean => {
  const line = left.endLine ?? left.startLine;
  if (line !== right.startLine) return line < right.startLine;
  return (left.endColumn ?? Number.MAX_SAFE_INTEGER) <= (right.startColumn ?? 0);
};

const contains = (container: SourceLocation, contained: SourceLocation): boolean => {
  const beginsBefore =
    container.startLine < contained.startLine ||
    (container.startLine === contained.startLine &&
      (container.startColumn ?? 0) <= (contained.startColumn ?? 0));
  const containerEndLine = container.endLine ?? container.startLine;
  const containedEndLine = contained.endLine ?? contained.startLine;
  return (
    beginsBefore &&
    (containerEndLine > containedEndLine ||
      (containerEndLine === containedEndLine &&
        (container.endColumn ?? Number.MAX_SAFE_INTEGER) >= (contained.endColumn ?? 0)))
  );
};

const stableDefinition = (
  module: ModuleFacts,
  call: CallFact,
  name: string,
): StableDefinition | undefined => {
  const local = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === name &&
      definition.enclosing === call.enclosing &&
      endsBefore(definition.location, call.location),
  );
  const moduleDefinitions = module.definitions.filter(
    (definition) =>
      definition.kind === 'variable' &&
      definition.name === name &&
      definition.enclosing === undefined &&
      endsBefore(definition.location, call.location),
  );
  const candidates = local.length > 0 ? local : moduleDefinitions;
  if (local.length === 0 && hasBindingAt(module, call.enclosing, name, call.location)) {
    return undefined;
  }
  if (candidates.length !== 1) return undefined;
  const definition = candidates[0];
  if (definition === undefined) return undefined;
  if (
    local.length === 0 &&
    call.enclosing !== undefined &&
    module.definitions.filter(
      (candidate) =>
        candidate.kind === 'variable' &&
        candidate.name === name &&
        candidate.enclosing === undefined,
    ).length !== 1
  ) {
    return undefined;
  }
  const assigned = module.assignments.some(
    (assignment) => assignment.target[0] === name && assignment.enclosing === definition.enclosing,
  );
  return assigned ? undefined : { definition, value: definition.value };
};

const valueAt = (
  module: ModuleFacts,
  call: CallFact,
  value: ArgumentFact | undefined,
): StableDefinition | undefined => {
  if (value?.kind !== 'identifier') return undefined;
  return stableDefinition(module, call, value.name);
};

const chatOpenAiCallFor = (
  context: DiscoveryContext,
  module: ModuleFacts,
  binding: StableDefinition,
): CallFact | undefined => {
  const imports = exactChatOpenAiImports(context, module);
  const calls = module.calls.filter(
    (call) =>
      call.location.startLine >= binding.definition.location.startLine &&
      (call.location.endLine ?? call.location.startLine) <=
        (binding.definition.location.endLine ?? binding.definition.location.startLine) &&
      exactChatOpenAiRuntimeCall(context, module, imports, call) !== undefined,
  );
  return calls.length === 1 ? calls[0] : undefined;
};

const modelFor = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  construction: LegacyConstruction,
):
  | { readonly identity: ComponentIdentity; readonly locations: readonly SourceLocation[] }
  | undefined => {
  const binding = valueAt(construction.module, construction.call, construction.model);
  if (binding === undefined) return undefined;
  const clientCall = chatOpenAiCallFor(context, construction.module, binding);
  if (clientCall === undefined) return undefined;
  const configuration = settleChatOpenAiConfiguration({
    context,
    module: construction.module,
    call: clientCall,
    refuse: () => undefined,
  });
  if (configuration.providers.length !== 1 || configuration.models.length !== 1) return undefined;
  const provider = configuration.providers[0];
  const model = configuration.models[0];
  if (provider === undefined || model === undefined) return undefined;
  const identity = globalIdentity(
    'model',
    GLOBAL_NAMESPACES.model,
    `${provider.provider}/${model.model}`,
  );
  return builder.hasComponent(identity)
    ? {
        identity,
        locations: [binding.definition.location, clientCall.location, construction.call.location],
      }
    : undefined;
};

type SettledList = {
  readonly value: ArgumentFact;
  readonly location: SourceLocation;
  readonly enclosing: string | undefined;
};

const listValue = (
  module: ModuleFacts,
  call: CallFact,
  value: ArgumentFact | undefined,
  template: LegacyTemplate | undefined,
  factoryCall: CallFact,
): SettledList | undefined => {
  if (value?.kind === 'array') {
    return { value, location: call.location, enclosing: call.enclosing };
  }
  const binding = valueAt(module, call, value);
  if (binding === undefined) return undefined;
  const name = binding.definition.name;
  const wrapperName = template?.definition.name.split('.').at(-1);
  const isVerifiedWrapperCall = (candidate: CallFact): boolean =>
    template !== undefined &&
    wrapperName !== undefined &&
    candidate.origin === undefined &&
    candidate.calleePath.length === 1 &&
    candidate.calleePath[0] === wrapperName &&
    legacyWrapperBindingHolds(module, template, candidate);
  const referencesBinding = (input: {
    readonly enclosing?: string | undefined;
    readonly location: SourceLocation;
  }): boolean =>
    input.enclosing === binding.definition.enclosing ||
    (binding.definition.enclosing === undefined &&
      !hasBindingAt(module, input.enclosing, name, input.location));
  const aliased = module.definitions.some(
    (definition) =>
      definition !== binding.definition &&
      !contains(definition.location, call.location) &&
      legacyDirectDefinition(module, factoryCall) !== definition &&
      definition.value !== undefined &&
      legacyArgumentMentions(definition.value, name) &&
      endsBefore(binding.definition.location, definition.location) &&
      !module.calls.some(
        (candidate) =>
          legacyDirectDefinition(module, candidate) === definition &&
          isVerifiedWrapperCall(candidate),
      ) &&
      referencesBinding(definition),
  );
  const mutated =
    aliased ||
    module.assignments.some(
      (assignment) =>
        assignment.target[0] === name &&
        endsBefore(binding.definition.location, assignment.location) &&
        referencesBinding(assignment),
    ) ||
    module.assignments.some(
      (assignment) =>
        legacyArgumentMentions(assignment.value, name) &&
        endsBefore(binding.definition.location, assignment.location) &&
        referencesBinding(assignment),
    ) ||
    module.calls.some(
      (candidate) =>
        candidate !== call &&
        candidate !== factoryCall &&
        endsBefore(binding.definition.location, candidate.location) &&
        referencesBinding(candidate) &&
        !isVerifiedWrapperCall(candidate) &&
        (candidate.calleePath[0] === name ||
          candidate.args.some((argument) => legacyArgumentMentions(argument, name))),
    );
  return mutated || binding.value === undefined
    ? undefined
    : {
        value: binding.value,
        location: binding.definition.location,
        enclosing: binding.definition.enclosing,
      };
};

const toolDefinition = (
  context: DiscoveryContext,
  module: ModuleFacts,
  name: string,
  use: Pick<SettledList, 'location' | 'enclosing'>,
): DefinitionFact | undefined => {
  if (hasBindingAt(module, use.enclosing, name, use.location)) return undefined;
  const rebound =
    module.definitions.some(
      (definition) =>
        definition.kind === 'variable' &&
        definition.name === name &&
        definition.enclosing === use.enclosing &&
        endsBefore(definition.location, use.location),
    ) ||
    module.assignments.some(
      (assignment) =>
        assignment.target[0] === name &&
        assignment.enclosing === use.enclosing &&
        endsBefore(assignment.location, use.location),
    );
  if (rebound) return undefined;
  const localFunctions = module.definitions.filter(
    (definition) =>
      (definition.kind === 'function' || definition.kind === 'method') &&
      definition.enclosing === use.enclosing &&
      (definition.name.split('.').at(-1) ?? definition.name) === name,
  );
  if (use.enclosing !== undefined && localFunctions.length > 0) {
    const local = localFunctions[0];
    if (
      localFunctions.length !== 1 ||
      local === undefined ||
      !endsBefore(local.location, use.location)
    ) {
      return undefined;
    }
    const decorated = local.decorators.some(
      (decorator) =>
        matchRuntimeSymbol(
          context.modules,
          module,
          {
            path: decorator.path,
            origin: decorator.origin,
            enclosing: local.enclosing,
            location: decorator.location,
          },
          { names: ['tool'], packages: ['langchain.tools', 'langchain_core.tools'] },
        ) !== undefined,
    );
    return decorated ? local : undefined;
  }
  const resolved = context.symbols.resolve(module.file, name);
  const definition = resolved?.definition;
  if (resolved === undefined || definition?.kind !== 'function') return undefined;
  const definingModule = context.symbols.moduleOf(resolved.file);
  if (definingModule === undefined) return undefined;
  const definitions = context.symbols
    .definitionsOf(resolved.file)
    .filter((candidate) => candidate.kind === 'function' && candidate.name === definition.name);
  const reassigned = definingModule.assignments.some(
    (assignment) => assignment.target.length === 1 && assignment.target[0] === definition.name,
  );
  const decorated = definition.decorators.some(
    (decorator) =>
      matchRuntimeSymbol(
        context.modules,
        definingModule,
        {
          path: decorator.path,
          origin: decorator.origin,
          enclosing: definition.enclosing,
          location: decorator.location,
        },
        { names: ['tool'], packages: ['langchain.tools', 'langchain_core.tools'] },
      ) !== undefined,
  );
  return definitions.length === 1 && !reassigned && decorated ? definition : undefined;
};

const sourceNameOf = (definition: DefinitionFact): string =>
  definition.enclosing === undefined
    ? definition.name
    : `${definition.enclosing}.${definition.name.split('.').at(-1) ?? definition.name}`;

const toolsFor = (
  context: DiscoveryContext,
  construction: LegacyConstruction,
):
  | readonly { readonly identity: ComponentIdentity; readonly definition: DefinitionFact }[]
  | undefined => {
  const value = listValue(
    construction.module,
    construction.call,
    construction.tools,
    construction.template,
    construction.factoryCall,
  );
  if (value?.value.kind !== 'array' || value.value.complete === false) return undefined;
  const tools = value.value.items.map((item) => {
    if (item.kind !== 'identifier') return undefined;
    const definition = toolDefinition(context, construction.module, item.name, value);
    return definition === undefined
      ? undefined
      : {
          identity: sourceIdentity('tool', definition.location.file, sourceNameOf(definition)),
          definition,
        };
  });
  if (!tools.every((tool) => tool !== undefined)) return undefined;
  const settled = tools as readonly {
    identity: ComponentIdentity;
    definition: DefinitionFact;
  }[];
  return new Set(settled.map((tool) => identityKey(tool.identity))).size === settled.length
    ? settled
    : undefined;
};

const addAgentEvidence = (
  builder: SystemGraphBuilder,
  construction: LegacyConstruction,
  toolCount: number | undefined,
): void => {
  const locations = [
    construction.factoryCall.location,
    construction.executorCall.location,
    construction.definition.location,
    construction.call.location,
  ];
  for (const location of locations) {
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        identity: construction.identity,
        file: construction.module.file,
        name: construction.sourceName,
        location,
        symbol: `legacy LangChain agent: ${construction.sourceName}`,
        confidence: CONFIDENCE_BANDS.deterministic,
        details: {
          for: 'agent',
          framework: 'langchain-legacy',
          role: 'worker',
          ...(toolCount === undefined ? {} : { toolCount }),
        },
        metadata: {
          framework: 'langchain-legacy',
          declaredName: construction.sourceName,
          factory: LANGCHAIN_LEGACY_FACTORY_EXPORT,
          executor: LANGCHAIN_LEGACY_EXECUTOR_EXPORT,
        },
        tags: ['langchain', 'legacy-agent'],
      }),
    );
  }
};

const addRelationEvidence = (input: {
  readonly builder: SystemGraphBuilder;
  readonly kind: 'invokes_model' | 'calls_tool';
  readonly from: ComponentIdentity;
  readonly to: ComponentIdentity;
  readonly locations: readonly SourceLocation[];
  readonly symbol: string;
}): void => {
  for (const location of input.locations) {
    input.builder.addEdge(
      drafts.edge({
        kind: input.kind,
        from: input.from,
        to: input.to,
        location,
        symbol: input.symbol,
        confidence: CONFIDENCE_BANDS.deterministic,
      }),
    );
  }
};

const registerPrompt = (context: DiscoveryContext, construction: LegacyConstruction): void => {
  if (construction.prompt === undefined) return;
  context.promptInputs.register({
    producer: LANGCHAIN_LEGACY_AGENT_ADAPTER_ID,
    module: construction.module,
    call: construction.call,
    consumer: construction.identity,
    channel: 'system_prompt',
    value: construction.prompt,
    location: construction.call.location,
    supportingLocations: [construction.factoryCall.location, construction.executorCall.location],
  });
};

type DiscoveryPopulation = {
  readonly componentKeys: Set<string>;
  readonly edgeKeys: Set<string>;
};

const addTool = (input: {
  readonly builder: SystemGraphBuilder;
  readonly construction: LegacyConstruction;
  readonly identity: ComponentIdentity;
  readonly definition: DefinitionFact;
  readonly population: DiscoveryPopulation;
}): void => {
  const name = sourceNameOf(input.definition);
  input.builder.addComponent(
    drafts.sourceComponent({
      kind: 'tool',
      identity: input.identity,
      file: input.definition.location.file,
      name,
      location: input.definition.location,
      symbol: `LangChain tool: ${name}`,
      confidence: CONFIDENCE_BANDS.deterministic,
      details: { for: 'tool' },
      metadata: { framework: 'langchain-legacy' },
      tags: ['langchain', 'legacy-agent'],
    }),
  );
  input.population.componentKeys.add(identityKey(input.identity));
  addRelationEvidence({
    builder: input.builder,
    kind: 'calls_tool',
    from: input.construction.identity,
    to: input.identity,
    locations: [input.construction.call.location, input.definition.location],
    symbol: `AgentExecutor tools: ${name}`,
  });
  input.population.edgeKeys.add(
    `calls_tool:${identityKey(input.construction.identity)}->${identityKey(input.identity)}`,
  );
};

const endpointChangeReason = (
  change: LegacyEndpointChange,
  endpoint: 'delegated agent' | 'tool',
): string => {
  if (change.kind === 'proven_mutation') {
    return `A constructed legacy LangChain executor had its ${endpoint} endpoint assigned or mutated after construction, so its relations are not source-stable.`;
  }
  if (change.kind === 'escape') {
    return `A constructed legacy LangChain executor escaped through another value after construction, so its ${endpoint} endpoint is not source-stable.`;
  }
  return `A source operation involving a constructed legacy LangChain executor did not prove that its ${endpoint} endpoint remained stable.`;
};

const addConstruction = (input: {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly topology: TopologyAccumulator;
  readonly population: DiscoveryPopulation;
  readonly construction: LegacyConstruction;
}): void => {
  const stability = legacyEndpointStability(input.context, input.construction);
  const tools =
    stability.toolsChange === undefined ? toolsFor(input.context, input.construction) : undefined;
  const model =
    stability.modelChange === undefined
      ? modelFor(input.context, input.builder, input.construction)
      : undefined;
  addAgentEvidence(input.builder, input.construction, tools?.length);
  input.population.componentKeys.add(identityKey(input.construction.identity));
  input.context.bindings.register(
    input.construction.module.file,
    input.construction.sourceName,
    input.construction.identity,
  );
  if (input.construction.definition.enclosing === undefined) {
    input.context.bindings.register(
      input.construction.module.file,
      input.construction.definition.name,
      input.construction.identity,
    );
  }
  if (stability.promptChange === undefined) registerPrompt(input.context, input.construction);
  if (stability.promptChange !== undefined) {
    refuse(input.topology, {
      kind: 'prompt_input',
      scope: 'prompt_use',
      reason: endpointChangeReason(stability.promptChange, 'delegated agent'),
      location: stability.promptChange.location,
    });
  } else if (input.construction.prompt === undefined) {
    refuse(input.topology, {
      kind: 'prompt_input',
      scope: 'prompt_use',
      reason:
        'The prompt passed through a local legacy LangChain factory was not source-settled to the factory call site.',
      location: input.construction.call.location,
    });
  }

  if (stability.modelChange !== undefined) {
    refuse(input.topology, {
      kind: 'explicit_relation',
      reason: endpointChangeReason(stability.modelChange, 'delegated agent'),
      location: stability.modelChange.location,
    });
  } else if (model === undefined) {
    refuse(input.topology, {
      kind: 'explicit_relation',
      reason:
        'A legacy LangChain agent model argument did not settle to one exact source-declared model client.',
      location: input.construction.call.location,
    });
  } else {
    addRelationEvidence({
      builder: input.builder,
      kind: 'invokes_model',
      from: input.construction.identity,
      to: model.identity,
      locations: model.locations,
      symbol: 'create_openai_tools_agent model',
    });
    input.population.edgeKeys.add(
      `invokes_model:${identityKey(input.construction.identity)}->${identityKey(model.identity)}`,
    );
  }

  if (stability.toolsChange !== undefined) {
    refuse(input.topology, {
      kind: 'explicit_relation',
      reason: endpointChangeReason(stability.toolsChange, 'tool'),
      location: stability.toolsChange.location,
    });
    return;
  }
  if (tools === undefined) {
    refuse(input.topology, {
      kind: 'explicit_relation',
      reason:
        'A legacy LangChain AgentExecutor tool population was computed or lacked exact decorated implementations.',
      location: input.construction.call.location,
    });
    return;
  }
  for (const tool of tools) {
    addTool({
      builder: input.builder,
      construction: input.construction,
      identity: tool.identity,
      definition: tool.definition,
      population: input.population,
    });
  }
};

const addUnconsumedRefusals = (input: {
  readonly module: ModuleFacts;
  readonly imports: ReturnType<typeof legacyAgentImports>;
  readonly consumed: ReadonlySet<CallFact>;
  readonly topology: TopologyAccumulator;
}): void => {
  for (const name of [LANGCHAIN_LEGACY_FACTORY_EXPORT, LANGCHAIN_LEGACY_EXECUTOR_EXPORT] as const) {
    for (const call of input.module.calls) {
      if (!legacyAgentCandidateCall(input.imports, call, name) || input.consumed.has(call)) {
        continue;
      }
      refuse(input.topology, {
        kind: 'adapter_input',
        reason: `A ${name} call did not settle to one verified AgentExecutor construction or local returned factory.`,
        location: call.location,
      });
    }
  }
};

export const langChainLegacyAgentAdapter: AgentSystemAdapter = {
  id: LANGCHAIN_LEGACY_AGENT_ADAPTER_ID,
  version: '1',
  packages: LANGCHAIN_LEGACY_AGENT_PACKAGES,
  applicability: legacyAgentApplicability,
  appliesTo: (context) => legacyAgentApplicability(context).length > 0,
  discover: (context, builder): AdapterFindings => {
    const applicability = legacyAgentApplicability(context);
    const topology = topologyAccumulator(applicability.length);
    const files = new Set<string>();
    const population: DiscoveryPopulation = {
      componentKeys: new Set<string>(),
      edgeKeys: new Set<string>(),
    };

    for (const module of context.modules) {
      const imports = legacyAgentImports(context, module);
      if (imports.length === 0) continue;
      files.add(module.file);
      const settlement = settleLegacyAgentConstructions(context, module);
      for (const entry of settlement.refusals) refuse(topology, entry);
      addUnconsumedRefusals({
        module,
        imports,
        consumed: settlement.consumedCalls,
        topology,
      });
      for (const construction of settlement.constructions) {
        addConstruction({ context, builder, topology, population, construction });
      }
    }

    topology.explicitRelations = population.edgeKeys.size;
    return {
      componentsFound: population.componentKeys.size,
      edgesFound: population.edgeKeys.size,
      filesInspected: [...files],
      topology: topologyDiscovery(topology),
    };
  },
};
