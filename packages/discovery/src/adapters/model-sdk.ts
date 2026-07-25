import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';
import type { CallFact, ModuleFacts } from '@orchescope/source-analysis';
import {
  dotted,
  findEntry,
  numberValue,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { importsAny, moduleMatches, projectUses } from '../matching.ts';

/**
 * Raw model SDK usage.
 *
 * The plain provider clients out-download every agent framework by an order of magnitude, so a system
 * built as a hand written loop over `openai` or `anthropic` has to be discovered or the graph will look
 * empty on the most common shape there is. The call sites are recognised by their documented method
 * paths, and the caller is attributed to the enclosing function, which is the honest limit of what
 * syntax alone can establish.
 */

const PROVIDERS = [
  {
    provider: 'openai',
    packages: ['openai', '@ai-sdk/openai'],
    clients: ['OpenAI', 'AzureOpenAI', 'AsyncOpenAI', 'AsyncAzureOpenAI'],
    methods: [
      'chat.completions.create',
      'responses.create',
      'completions.create',
      'embeddings.create',
      'beta.chat.completions.parse',
      'responses.stream',
    ],
  },
  {
    provider: 'anthropic',
    packages: ['@anthropic-ai/sdk', 'anthropic'],
    clients: ['Anthropic', 'AsyncAnthropic', 'AnthropicBedrock'],
    methods: ['messages.create', 'messages.stream', 'beta.messages.create', 'completions.create'],
  },
  {
    provider: 'google',
    packages: ['@google/genai', 'google.genai', 'google-genai', 'google.generativeai'],
    clients: ['GoogleGenAI', 'Client'],
    methods: ['models.generateContent', 'models.generateContentStream', 'generate_content'],
  },
] as const;

const ALL_PACKAGES = PROVIDERS.flatMap((entry) => [...entry.packages]);
const ADAPTER_ID = 'adapter:model-sdk';
const drafts = createDrafts(ADAPTER_ID);

const providerIdentity = (provider: string): ComponentIdentity =>
  globalIdentity('provider', GLOBAL_NAMESPACES.provider, provider);

const modelIdentity = (provider: string, model: string): ComponentIdentity =>
  globalIdentity('model', GLOBAL_NAMESPACES.model, `${provider}/${model}`);

/** Matches a call path against a provider method suffix, ignoring the client variable name. */
const matchesMethod = (call: CallFact, methods: readonly string[]): string | undefined => {
  const path = dotted(call.calleePath);
  for (const method of methods) {
    if (path === method || path.endsWith(`.${method}`)) return method;
  }
  return undefined;
};

type Discovered = { components: number; edges: number; files: Set<string> };

const registerProviderClients = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  context: DiscoveryContext,
  found: Discovered,
): void => {
  for (const provider of PROVIDERS) {
    if (!importsAny(module, provider.packages)) continue;
    for (const call of module.calls) {
      const name = call.calleePath[call.calleePath.length - 1];
      if (name === undefined || !provider.clients.includes(name as never)) continue;
      const resolved =
        call.origin !== undefined && moduleMatches(call.origin.module, provider.packages);
      const entries = objectArgument(call);
      const timeout = numberValue(findEntry(entries, 'timeout')?.value);
      const baseUrlFromConfig =
        stringValue(findEntry(entries, 'baseURL')?.value) ??
        stringValue(findEntry(entries, 'base_url')?.value);
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'provider',
          identity: providerIdentity(provider.provider),
          file: module.file,
          name: provider.provider,
          location: call.location,
          symbol: dotted(call.calleePath),
          confidence: resolved ? CONFIDENCE_BANDS.deterministic : CONFIDENCE_BANDS.structural,
          permissions: [
            { kind: 'network', scope: baseUrlFromConfig ?? provider.provider, mode: 'write' },
          ],
          metadata: {
            client: dotted(call.calleePath),
            ...(baseUrlFromConfig === undefined ? {} : { baseUrl: baseUrlFromConfig }),
            ...(timeout === undefined ? {} : { timeoutMs: timeout }),
          },
          tags: ['model-sdk'],
        }),
      );
      found.components += 1;
      found.files.add(module.file);
      const definitionName = module.definitions.find(
        (definition) =>
          definition.kind === 'variable' &&
          definition.initializer !== undefined &&
          dotted(definition.initializer) === dotted(call.calleePath),
      )?.name;
      if (definitionName !== undefined) {
        context.bindings.register(module.file, definitionName, providerIdentity(provider.provider));
      }
    }
  }
};

const registerModelCalls = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  found: Discovered,
): void => {
  for (const provider of PROVIDERS) {
    if (!importsAny(module, provider.packages)) continue;
    for (const call of module.calls) {
      const method = matchesMethod(call, provider.methods);
      if (method === undefined) continue;
      const entries = objectArgument(call);
      const model = stringValue(findEntry(entries, 'model')?.value) ?? 'unspecified';
      const maxTokens =
        numberValue(findEntry(entries, 'max_tokens')?.value) ??
        numberValue(findEntry(entries, 'maxTokens')?.value) ??
        numberValue(findEntry(entries, 'max_output_tokens')?.value);
      const temperature = numberValue(findEntry(entries, 'temperature')?.value);
      const streaming = method.includes('stream') || findEntry(entries, 'stream') !== undefined;

      builder.addComponent(
        drafts.sourceComponent({
          kind: 'model',
          identity: modelIdentity(provider.provider, model),
          file: module.file,
          name: `${provider.provider}/${model}`,
          location: call.location,
          symbol: dotted(call.calleePath),
          confidence: CONFIDENCE_BANDS.deterministic,
          details: {
            for: 'model',
            provider: provider.provider,
            modelId: model,
            streaming,
            ...(temperature === undefined ? {} : { temperature }),
            ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
          },
          metadata: { callSite: dotted(call.calleePath), operation: method },
          tags: ['model-sdk'],
        }),
      );
      found.components += 1;
      found.files.add(module.file);

      builder.addEdge(
        drafts.edge({
          kind: 'served_by_provider',
          from: modelIdentity(provider.provider, model),
          to: providerIdentity(provider.provider),
          location: call.location,
          symbol: dotted(call.calleePath),
        }),
      );
      found.edges += 1;

      // The caller is attributed to its enclosing function, recorded as an entry point when the
      // repository has no framework declared agent to attach the call to.
      const enclosing = call.enclosing;
      if (enclosing !== undefined) {
        const callerIdentity = sourceIdentity('agent', module.file, enclosing);
        builder.addComponent(
          drafts.sourceComponent({
            kind: 'agent',
            file: module.file,
            name: enclosing,
            location: call.location,
            symbol: enclosing,
            confidence: CONFIDENCE_BANDS.heuristic,
            details: { for: 'agent', role: 'unspecified', framework: 'hand-written' },
            metadata: { inferredFrom: 'model call site' },
            tags: ['hand-written-loop'],
          }),
        );
        found.components += 1;
        builder.addEdge(
          drafts.edge({
            kind: 'invokes_model',
            from: callerIdentity,
            to: modelIdentity(provider.provider, model),
            location: call.location,
            symbol: dotted(call.calleePath),
            confidence: CONFIDENCE_BANDS.structural,
          }),
        );
        found.edges += 1;
      }
    }
  }
};

export const modelSdkAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'javascript',
  appliesTo: (context) => projectUses(context, ALL_PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const found: Discovered = { components: 0, edges: 0, files: new Set() };
    for (const module of context.modules) {
      registerProviderClients(module, builder, context, found);
      registerModelCalls(module, builder, found);
    }
    return {
      componentsFound: found.components,
      edgesFound: found.edges,
      filesInspected: found.files.size,
    };
  },
};
