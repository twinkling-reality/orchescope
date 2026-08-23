import { CONFIDENCE_BANDS, identityKey, isTestFile, sha256Hex } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';

import type { AdapterFindings, AgentSystemAdapter, TopologyDiscovery } from '../adapter.ts';
import { configIdentity, createDrafts, sourceIdentity } from '../drafts.ts';
import type { PromptInput } from '../prompt-input.ts';
import { settlePromptInput, type PromptLeaf } from '../prompt-settlement.ts';

const ADAPTER_ID = 'adapter:prompts';
const drafts = createDrafts(ADAPTER_ID);
const MAX_REFUSALS = 10;

type SourcePromptInput = Exclude<PromptInput, { readonly kind: 'config' }>;

const promptIdentity = (input: SourcePromptInput, leaf: PromptLeaf): ComponentIdentity =>
  sourceIdentity(
    'prompt',
    leaf.file,
    leaf.name === undefined
      ? `${input.consumer.localName}-${input.channel}-${input.call.enclosing ?? 'call'}-${leaf.location.startLine}-${leaf.location.startColumn ?? 0}`
      : leaf.enclosing === undefined
        ? leaf.name
        : `${leaf.enclosing}.${leaf.name}`,
  );

const approximateTokens = (value: string): number =>
  Math.max(1, value.trim().split(/\s+/u).filter(Boolean).length);

const configInterpolates = (value: string): boolean =>
  /(?<!\{)\{[A-Za-z_][A-Za-z0-9_.]*\}(?!\})/u.test(value);
type ConfigPromptInput = Extract<PromptInput, { readonly kind: 'config' }>;

const addConfigPrompt = (
  builder: SystemGraphBuilder,
  input: ConfigPromptInput,
): { readonly component: string; readonly edge: string } => {
  const identity = configIdentity(
    'prompt',
    input.configFile,
    `${input.consumer.localName}-${input.channel}`,
  );
  const details = {
    for: 'prompt' as const,
    textHash: sha256Hex(input.value),
    approximateTokens: approximateTokens(input.value),
    interpolatesUntrustedInput: configInterpolates(input.value),
  };
  builder.addComponent(
    drafts.configComponent({
      kind: 'prompt',
      identity,
      configFile: input.configFile,
      pointer: input.pointer,
      name: `${input.consumer.localName} ${input.channel}`,
      value: input.value,
      details,
      metadata: { channel: input.channel, sourceProducer: input.producer },
      tags: ['prompt'],
    }),
  );
  for (const pointer of new Set([input.pointer, ...(input.supportingPointers ?? [])])) {
    builder.addEdge(
      drafts.edge({
        kind: 'uses_prompt',
        from: input.consumer,
        to: identity,
        configFile: input.configFile,
        pointer,
        symbol: input.channel,
        confidence: CONFIDENCE_BANDS.deterministic,
      }),
    );
  }
  return {
    component: identityKey(identity),
    edge: `${identityKey(input.consumer)}\u0000${identityKey(identity)}`,
  };
};

export const promptsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '3',
  packages: [],
  appliesTo: (context) =>
    context.promptInputs
      .inputs()
      .some((input) =>
        input.kind === 'config' ? !isTestFile(input.configFile) : !isTestFile(input.module.file),
      ),
  discover: (context, builder): AdapterFindings => {
    const registered = context.promptInputs.inputs();
    const inputs = registered.filter(
      (input): input is SourcePromptInput =>
        input.kind !== 'config' && !isTestFile(input.module.file),
    );
    const configInputs = registered.filter(
      (input): input is ConfigPromptInput =>
        input.kind === 'config' && !isTestFile(input.configFile),
    );
    const components = new Set<string>();
    const edges = new Set<string>();
    const files = new Set<string>();
    const unresolved: TopologyDiscovery['unresolved'][number][] = [];
    let unresolvedCount = 0;

    for (const input of configInputs) {
      files.add(input.configFile);
      const added = addConfigPrompt(builder, input);
      components.add(added.component);
      edges.add(added.edge);
    }

    for (const input of inputs) {
      files.add(input.module.file);
      const settlement = settlePromptInput(
        context,
        input.module,
        input.value,
        input.location,
        input.call.enclosing,
        [input.location],
      );
      if (settlement.reason !== undefined) {
        unresolvedCount += 1;
        if (unresolved.length < MAX_REFUSALS) {
          unresolved.push({
            kind: 'prompt_input',
            scope: 'prompt_use',
            reason: `${input.producer} ${input.channel}: ${settlement.reason}`,
            location: input.location,
          });
        }
      }
      for (const leaf of settlement.leaves) {
        const identity = promptIdentity(input, leaf);
        const text = leaf.value.value;
        const componentKey = identityKey(identity);
        const details = {
          for: 'prompt' as const,
          textHash: sha256Hex(text),
          approximateTokens: approximateTokens(text),
          interpolatesUntrustedInput: leaf.interpolates,
        };
        builder.addComponent(
          drafts.sourceComponent({
            kind: 'prompt',
            identity,
            file: leaf.file,
            name: leaf.name ?? `${input.consumer.localName} ${input.channel}`,
            location: leaf.location,
            symbol: leaf.name ?? input.channel,
            confidence: CONFIDENCE_BANDS.deterministic,
            details,
            metadata: {
              channel: input.channel,
              sourceProducer: input.producer,
              characters: text.length,
              hasSubstitutions: leaf.value.kind === 'template' && leaf.value.hasSubstitutions,
              ...(leaf.name !== undefined && leaf.interpolates ? { assembledElsewhere: true } : {}),
            },
            tags: ['prompt'],
          }),
        );
        for (const location of [...leaf.locations, ...input.supportingLocations]) {
          builder.addComponent(
            drafts.sourceComponent({
              kind: 'prompt',
              identity,
              file: location.file,
              name: leaf.name ?? `${input.consumer.localName} ${input.channel}`,
              location,
              symbol: input.channel,
              confidence: CONFIDENCE_BANDS.deterministic,
              details,
              tags: ['prompt'],
            }),
          );
        }
        components.add(componentKey);
        for (const location of new Map(
          [input.location, ...input.supportingLocations].map((candidate) => [
            `${candidate.file}:${candidate.startLine}:${candidate.startColumn ?? 0}:${candidate.endLine ?? candidate.startLine}:${candidate.endColumn ?? 0}`,
            candidate,
          ]),
        ).values()) {
          builder.addEdge(
            drafts.edge({
              kind: 'uses_prompt',
              from: input.consumer,
              to: identity,
              location,
              symbol: input.channel,
              confidence: CONFIDENCE_BANDS.deterministic,
            }),
          );
        }
        edges.add(`${identityKey(input.consumer)}\u0000${componentKey}`);
      }
    }

    return {
      componentsFound: components.size,
      edgesFound: edges.size,
      filesInspected: [...files],
      topology: {
        scope: 'prompt_use',
        status:
          unresolvedCount === 0 && inputs.length + configInputs.length > 0
            ? 'complete'
            : 'incomplete',
        inspectedInputs: inputs.length + configInputs.length,
        explicitRelations: edges.size,
        conditionalConstructs: 0,
        conditionalDestinations: 0,
        entryBoundaries: 0,
        entryTargets: [],
        terminalBoundaries: 0,
        boundaryFacts: [],
        configurationBounds: 0,
        configurationBoundFacts: [],
        unresolvedCount,
        unresolved,
      },
    };
  },
};
