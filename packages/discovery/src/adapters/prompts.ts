import { CONFIDENCE_BANDS, identityKey, isTestFile, sha256Hex } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';

import type {
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
  TopologyDiscovery,
} from '../adapter.ts';
import { configIdentity, createDrafts, sourceIdentity } from '../drafts.ts';
import type { PromptInput, SourcePromptInput } from '../prompt-input.ts';
import { type PromptLeaf, settlePromptInput } from '../prompt-settlement.ts';
import {
  discoverLangChainPromptTemplates,
  hasLangChainPromptTemplateImport,
  LANGCHAIN_PROMPT_TEMPLATE_PACKAGES,
} from './langchain-prompt-template.ts';

const ADAPTER_ID = 'adapter:prompts';
const drafts = createDrafts(ADAPTER_ID);
const MAX_REFUSALS = 10;

const settleSourcePrompt = (context: DiscoveryContext, input: SourcePromptInput) =>
  settlePromptInput(
    context,
    input.module,
    input.value,
    input.location,
    input.call.lexicalEnclosing ?? input.call.enclosing,
    [input.location],
    input.call.lexicalScopes ?? [],
    input.call.lexicalShadows ?? [],
  );

const promptIdentity = (input: SourcePromptInput, leaf: PromptLeaf): ComponentIdentity =>
  sourceIdentity(
    'prompt',
    leaf.file,
    input.identityName ??
      (leaf.name === undefined
        ? `${input.consumer?.localName ?? 'prompt'}-${input.channel}-${input.call.lexicalEnclosing ?? input.call.enclosing ?? 'call'}-${leaf.location.startLine}-${leaf.location.startColumn ?? 0}`
        : leaf.enclosing === undefined
          ? leaf.name
          : `${leaf.enclosing}.${leaf.name}`),
  );

const promptName = (input: SourcePromptInput, leaf: PromptLeaf): string =>
  leaf.name ?? input.identityName ?? `${input.consumer?.localName ?? 'prompt'} ${input.channel}`;

const addSourcePrompt = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  input: SourcePromptInput,
): {
  readonly components: readonly string[];
  readonly edges: readonly string[];
  readonly refusal?: TopologyDiscovery['unresolved'][number];
} => {
  const settlement = settleSourcePrompt(context, input);
  const refusalReasons = [
    settlement.reason,
    input.interpolationRefusal,
    input.relationRefusal ??
      (input.consumer === undefined
        ? 'the source establishes this prompt but not one authoritative consuming component'
        : undefined),
  ].filter((reason): reason is string => reason !== undefined);
  const components = new Set<string>();
  const edges = new Set<string>();
  for (const leaf of settlement.leaves) {
    const identity = promptIdentity(input, leaf);
    const text = leaf.value.value;
    const componentKey = identityKey(identity);
    const interpolation =
      input.runtimeInterpolation ??
      (input.interpolationRefusal === undefined ? leaf.interpolates : undefined);
    const details = {
      for: 'prompt' as const,
      textHash: sha256Hex(text),
      approximateTokens: approximateTokens(text),
      ...(interpolation === undefined ? {} : { interpolatesUntrustedInput: interpolation }),
    };
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'prompt',
        identity,
        file: leaf.file,
        name: promptName(input, leaf),
        location: leaf.location,
        symbol: leaf.name ?? input.channel,
        confidence: CONFIDENCE_BANDS.deterministic,
        details,
        metadata: {
          channel: input.channel,
          sourceProducer: input.producer,
          characters: text.length,
          hasSubstitutions: leaf.value.kind === 'template' && leaf.value.hasSubstitutions,
          ...(leaf.name !== undefined && interpolation === true
            ? { assembledElsewhere: true }
            : {}),
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
          name: promptName(input, leaf),
          location,
          symbol: input.channel,
          confidence: CONFIDENCE_BANDS.deterministic,
          details,
          tags: ['prompt'],
        }),
      );
    }
    components.add(componentKey);
    if (input.consumer === undefined) continue;
    const edgeLocations = new Map(
      [input.location, ...input.supportingLocations].map((candidate) => [
        `${candidate.file}:${candidate.startLine}:${candidate.startColumn ?? 0}:${candidate.endLine ?? candidate.startLine}:${candidate.endColumn ?? 0}`,
        candidate,
      ]),
    );
    for (const location of edgeLocations.values()) {
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
  return {
    components: [...components],
    edges: [...edges],
    ...(refusalReasons.length === 0
      ? {}
      : {
          refusal: {
            kind: 'prompt_input',
            scope: 'prompt_use',
            reason: `${input.producer} ${input.channel}: ${refusalReasons.join('; ')}`,
            location: input.interpolationRefusalLocation ?? input.location,
          },
        }),
  };
};

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
  version: '4',
  packages: LANGCHAIN_PROMPT_TEMPLATE_PACKAGES,
  appliesTo: (context) =>
    hasLangChainPromptTemplateImport(context) ||
    context.promptInputs
      .inputs()
      .some((input) =>
        input.kind === 'config' ? !isTestFile(input.configFile) : !isTestFile(input.module.file),
      ),
  discover: (context, builder): AdapterFindings => {
    const templates = discoverLangChainPromptTemplates(context);
    for (const input of templates.inputs) context.promptInputs.register(input);
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
    const files = new Set<string>(templates.files);
    const templateRefusals: TopologyDiscovery['unresolved'] = templates.refusals.map((refusal) => ({
      kind: 'prompt_input',
      scope: 'prompt_use',
      reason: `adapter:prompts chat_prompt_template: ${refusal.reason}`,
      location: refusal.location,
    }));
    const unresolved: TopologyDiscovery['unresolved'][number][] = templateRefusals.slice(
      0,
      MAX_REFUSALS,
    );
    let unresolvedCount = templateRefusals.length;

    for (const input of configInputs) {
      files.add(input.configFile);
      const added = addConfigPrompt(builder, input);
      components.add(added.component);
      edges.add(added.edge);
    }

    for (const input of inputs) {
      files.add(input.module.file);
      const added = addSourcePrompt(context, builder, input);
      for (const component of added.components) components.add(component);
      for (const edge of added.edges) edges.add(edge);
      if (added.refusal !== undefined) {
        unresolvedCount += 1;
        if (unresolved.length < MAX_REFUSALS) unresolved.push(added.refusal);
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
        inspectedInputs: inputs.length + configInputs.length + templates.refusals.length,
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
