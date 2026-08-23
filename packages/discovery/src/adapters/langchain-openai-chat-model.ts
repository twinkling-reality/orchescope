import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type { CallFact, ModuleFacts } from '@orchescope/source-analysis';
import type { DiscoveryContext, TopologyDiscovery } from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity } from '../drafts.ts';
import {
  chatConfigurationLocations,
  settleChatOpenAiConfiguration,
} from './langchain-openai-chat-configuration.ts';
import {
  exactChatOpenAiImports,
  exactChatOpenAiRuntimeCall,
  type ExactChatOpenAiImport,
  indirectChatOpenAiCalls,
  isChatOpenAiCandidateCall,
  LANGCHAIN_OPENAI_EXPORT,
} from './langchain-openai-chat-model-origin.ts';

const ADAPTER_ID = 'adapter:model-sdk';
const TOPOLOGY_SAMPLE_LIMIT = 10;
const drafts = createDrafts(ADAPTER_ID);

type TopologyAccumulator = {
  status: 'complete' | 'incomplete';
  inspectedInputs: number;
  explicitRelations: number;
  unresolvedCount: number;
  unresolved: TopologyDiscovery['unresolved'][number][];
};

type ProducerPopulation = {
  readonly components: Set<string>;
  readonly edges: Set<string>;
};

const identityKey = (identity: ComponentIdentity): string =>
  `${identity.kind}:${identity.namespace}:${identity.localName}`;

const registerSettledCall = (input: {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly imported: ExactChatOpenAiImport;
  readonly topology: TopologyAccumulator;
  readonly population: ProducerPopulation;
}): void => {
  const configuration = settleChatOpenAiConfiguration({
    context: input.context,
    module: input.module,
    call: input.call,
    refuse: (reason, location) => refuse(input.topology, reason, location),
  });
  const commonLocations = chatConfigurationLocations([
    input.imported.entry.location,
    input.call.location,
    ...configuration.locations,
  ]);
  if (configuration.providers.length === 0) {
    for (const model of configuration.models) {
      input.population.components.add(
        identityKey(globalIdentity('model', GLOBAL_NAMESPACES.model, model.model)),
      );
      addUnqualifiedModelEvidence({
        builder: input.builder,
        model: model.model,
        locations: chatConfigurationLocations([...commonLocations, ...model.locations]),
        basis: model.basis,
      });
    }
  }
  for (const provider of configuration.providers) {
    const providerLocations = chatConfigurationLocations([
      ...commonLocations,
      ...provider.locations,
    ]);
    const providerMetadata = {
      framework: 'langchain-openai',
      providerBasis: provider.basis,
      configurationSelection: provider.possible ? 'possible' : 'source-settled',
    } as const;
    const providerComponent = providerIdentity(provider.provider);
    input.population.components.add(identityKey(providerComponent));
    addComponentEvidence({
      builder: input.builder,
      kind: 'provider',
      identity: providerComponent,
      provider: provider.provider,
      locations: providerLocations,
      possible: provider.possible,
      metadata: providerMetadata,
    });
    for (const model of configuration.models) {
      const possible = provider.possible || model.possible;
      const allLocations = chatConfigurationLocations([...providerLocations, ...model.locations]);
      const metadata = {
        framework: 'langchain-openai',
        providerBasis: provider.basis,
        configurationSelection: possible ? 'possible' : 'source-settled',
        modelValueBasis: model.basis === 'configuration_default' ? 'static_default' : 'literal',
      } as const;
      const identity = modelIdentity(provider.provider, model.model);
      input.population.components.add(identityKey(identity));
      input.population.edges.add(
        `served_by_provider:${identityKey(identity)}->${identityKey(providerComponent)}`,
      );
      addComponentEvidence({
        builder: input.builder,
        kind: 'model',
        identity,
        provider: provider.provider,
        model: model.model,
        locations: allLocations,
        possible,
        metadata,
      });
      for (const location of allLocations) {
        input.builder.addEdge(
          drafts.edge({
            kind: 'served_by_provider',
            from: identity,
            to: providerComponent,
            location,
            symbol: `${LANGCHAIN_OPENAI_EXPORT} provider settlement`,
            confidence: CONFIDENCE_BANDS.deterministic,
            metadata,
          }),
        );
      }
    }
  }
};

export type ChatOpenAiDiscovery = {
  readonly components: number;
  readonly edges: number;
  readonly componentKeys: ReadonlySet<string>;
  readonly edgeKeys: ReadonlySet<string>;
  readonly files: ReadonlySet<string>;
  readonly topology: TopologyAccumulator;
};

const refuse = (topology: TopologyAccumulator, reason: string, location: SourceLocation): void => {
  topology.status = 'incomplete';
  topology.unresolvedCount += 1;
  if (topology.unresolved.length < TOPOLOGY_SAMPLE_LIMIT) {
    topology.unresolved.push({ kind: 'adapter_input', reason, location });
  }
};

const providerIdentity = (provider: string): ComponentIdentity =>
  globalIdentity('provider', GLOBAL_NAMESPACES.provider, provider);

const modelIdentity = (provider: string, model: string): ComponentIdentity =>
  globalIdentity('model', GLOBAL_NAMESPACES.model, `${provider}/${model}`);

const addComponentEvidence = (input: {
  readonly builder: SystemGraphBuilder;
  readonly kind: 'provider' | 'model';
  readonly identity: ComponentIdentity;
  readonly provider: string;
  readonly model?: string;
  readonly locations: readonly SourceLocation[];
  readonly possible: boolean;
  readonly metadata: Readonly<Record<string, string | boolean>>;
}): void => {
  for (const location of input.locations) {
    const name = input.model === undefined ? input.provider : `${input.provider}/${input.model}`;
    input.builder.addComponent(
      drafts.sourceComponent({
        kind: input.kind,
        identity: input.identity,
        file: location.file,
        name,
        ...(input.model === undefined ? {} : { displayName: input.model }),
        location,
        symbol: `${LANGCHAIN_OPENAI_EXPORT} configuration`,
        confidence: CONFIDENCE_BANDS.deterministic,
        ...(input.kind === 'provider'
          ? {
              permissions: [
                { kind: 'network' as const, scope: input.provider, mode: 'write' as const },
              ],
            }
          : {
              details: {
                for: 'model' as const,
                provider: input.provider,
                modelId: input.model ?? '',
                streaming: false,
              },
            }),
        metadata: input.metadata,
        tags: input.possible
          ? ['model-sdk', 'langchain-openai', 'configuration-possibility']
          : ['model-sdk', 'langchain-openai'],
      }),
    );
  }
};

const addUnqualifiedModelEvidence = (input: {
  readonly builder: SystemGraphBuilder;
  readonly model: string;
  readonly locations: readonly SourceLocation[];
  readonly basis: 'binding' | 'configuration_default';
}): void => {
  const identity = globalIdentity('model', GLOBAL_NAMESPACES.model, input.model);
  const metadata = {
    framework: 'langchain-openai',
    providerBasis: 'unresolved',
    configurationSelection: 'possible',
    modelValueBasis: input.basis === 'configuration_default' ? 'static_default' : 'literal',
  } as const;
  for (const location of input.locations) {
    input.builder.addComponent(
      drafts.sourceComponent({
        kind: 'model',
        identity,
        file: location.file,
        name: input.model,
        displayName: input.model,
        location,
        symbol: `${LANGCHAIN_OPENAI_EXPORT} model with unresolved provider`,
        confidence: CONFIDENCE_BANDS.deterministic,
        details: { for: 'model', modelId: input.model, streaming: false },
        metadata,
        tags: ['model-sdk', 'langchain-openai', 'configuration-possibility'],
      }),
    );
  }
};

/** Discovers direct exact `langchain_openai.ChatOpenAI` constructions only. */
export const discoverLangChainOpenAiModels = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): ChatOpenAiDiscovery => {
  const applicability = context.modules.flatMap((module) =>
    exactChatOpenAiImports(context, module),
  );
  const topology: TopologyAccumulator = {
    status: 'complete',
    inspectedInputs: applicability.length,
    explicitRelations: 0,
    unresolvedCount: 0,
    unresolved: [],
  };
  const files = new Set<string>();
  const population: ProducerPopulation = { components: new Set(), edges: new Set() };

  for (const module of context.modules) {
    const exact = exactChatOpenAiImports(context, module);
    if (exact.length === 0) continue;
    files.add(module.file);
    if (module.parseErrors.length > 0) {
      refuse(
        topology,
        'This ChatOpenAI module contains a syntax error, so its constructor population is partial.',
        exact[0]?.entry.location ?? { file: module.file, startLine: 1 },
      );
    }
    for (const imported of exact.filter((candidate) => candidate.form === 'wildcard')) {
      refuse(
        topology,
        'A langchain_openai wildcard import is applicable but does not establish an exact ChatOpenAI runtime binding.',
        imported.entry.location,
      );
    }
    const candidates = module.calls.filter((call) => isChatOpenAiCandidateCall(exact, call));
    const directCandidates = new Set(candidates);
    for (const indirect of indirectChatOpenAiCalls(module, exact)) {
      const { call } = indirect;
      if (directCandidates.has(call)) continue;
      refuse(
        topology,
        indirect.bounded
          ? 'A ChatOpenAI construction is reached through an assignment alias; this producer requires the exact imported runtime call binding.'
          : 'A ChatOpenAI assignment-alias chain exceeds the bounded source-resolution ceiling; runtime constructor authority remains unresolved.',
        call.location,
      );
    }
    for (const call of candidates) {
      const imported = exactChatOpenAiRuntimeCall(context, module, exact, call);
      if (imported === undefined) {
        refuse(
          topology,
          'A ChatOpenAI spelling did not retain the exact unshadowed langchain_openai runtime binding.',
          call.location,
        );
        continue;
      }
      registerSettledCall({ context, builder, module, call, imported, topology, population });
    }
  }
  topology.explicitRelations = population.edges.size;
  return {
    components: population.components.size,
    edges: population.edges.size,
    componentKeys: population.components,
    edgeKeys: population.edges,
    files,
    topology,
  };
};
