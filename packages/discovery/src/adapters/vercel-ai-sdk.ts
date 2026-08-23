import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';
import type { ArgumentFact, ObjectEntryFact } from '@orchescope/source-analysis';
import {
  dotted,
  findEntry,
  numberValue,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { promptCallSupport, registerPromptEntries } from '../prompt-input.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { definitionForCall, matchCalls, projectUses } from '../matching.ts';

/**
 * The Vercel AI SDK.
 *
 * Most usage of this package is a single `generateText` or `streamText` call with no agent topology, so
 * the adapter distinguishes the two shapes explicitly: a call that passes a `tools` map is a tool using
 * loop and is modelled as an agent, while a bare text generation is modelled as a model call attributed
 * to its enclosing function. Overstating a one shot completion as an agent system would make the graph
 * look busier than the code is.
 */

const PACKAGES = [
  'ai',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
  '@ai-sdk/provider',
  '@ai-sdk/react',
];
const ADAPTER_ID = 'adapter:vercel-ai-sdk';
const drafts = createDrafts(ADAPTER_ID);

const GENERATION_CALLS = ['generateText', 'streamText', 'generateObject', 'streamObject', 'embed'];

const modelIdentity = (name: string): ComponentIdentity =>
  globalIdentity('model', GLOBAL_NAMESPACES.model, name);

/** Reads the model from `model: openai('gpt-4o')` or `model: myModel`. */
/**
 * The model identifier, as this SDK expresses it.
 *
 * The idiomatic form is a provider call carrying the model as its first argument, as in `openai('gpt-4o-mini')`. When the
 * call names no model the provider is still recorded, with the model marked unspecified rather than guessed.
 */
const modelNameFrom = (value: ArgumentFact | undefined): string | undefined => {
  if (value === undefined) return undefined;
  if (value.kind === 'string') return value.value;
  if (value.kind === 'call') {
    const first = value.args[0];
    if (first !== undefined && first.kind === 'string') return first.value;
    const provider = value.path[value.path.length - 1];
    return provider === undefined ? undefined : `${provider}/unspecified`;
  }
  if (value.kind === 'identifier') return value.name;
  return undefined;
};

const toolNamesFrom = (entries: readonly ObjectEntryFact[]): readonly string[] => {
  const tools = findEntry(entries, 'tools')?.value;
  if (tools === undefined) return [];
  if (tools.kind === 'object') return tools.entries.map((entry) => entry.key);
  return [];
};

type Counts = { components: number; edges: number };

const discoverToolDefinitions = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  files: Set<string>,
): number => {
  let components = 0;
  for (const match of matchCalls(context.modules, { names: ['tool'], packages: PACKAGES })) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const description = stringValue(findEntry(entries, 'description')?.value);
    const name = definition?.name ?? description ?? 'tool';
    const identity = sourceIdentity('tool', match.module.file, name);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'tool',
        file: match.module.file,
        name,
        location: match.call.location,
        symbol: 'tool',
        confidence: match.confidence,
        ...(description === undefined ? {} : { description }),
        details: { for: 'tool' },
        metadata: { framework: 'vercel-ai-sdk', runtimeName: name },
        tags: ['vercel-ai-sdk'],
      }),
    );
    components += 1;
    files.add(match.module.file);
    context.bindings.register(match.module.file, name, identity);
    // The call holds the tool's `execute`, so what runs when the tool is invoked is written inside it.
    context.implementations.record({
      identity,
      file: match.module.file,
      body: match.call.location,
      symbol: `tool(${name})`,
    });
  }
  return components;
};

/**
 * The tools a generation call names.
 *
 * A name with no definition in the same file still becomes a component: the call proves the tool exists, and leaving it
 * out would make the model appear to run without tools.
 */
const linkNamedTools = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  caller: ComponentIdentity,
  match: ReturnType<typeof matchCalls>[number],
  toolNames: readonly string[],
): Counts => {
  let components = 0;
  let edges = 0;
  for (const toolName of toolNames) {
    const known = context.bindings.lookup(match.module.file, toolName);
    const target = known ?? sourceIdentity('tool', match.module.file, toolName);
    if (known === undefined) {
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'tool',
          file: match.module.file,
          name: toolName,
          location: match.call.location,
          symbol: `tools.${toolName}`,
          confidence: CONFIDENCE_BANDS.structural,
          details: { for: 'tool' },
          metadata: { framework: 'vercel-ai-sdk', runtimeName: toolName },
          tags: ['vercel-ai-sdk'],
        }),
      );
      components += 1;
      context.bindings.register(match.module.file, toolName, target);
    }
    builder.addEdge(
      drafts.edge({
        kind: 'calls_tool',
        from: caller,
        to: target,
        location: match.call.location,
        symbol: `tools.${toolName}`,
      }),
    );
    edges += 1;
  }
  return { components, edges };
};

/**
 * A generation call is the agent in this framework: there is no agent object to find, so the enclosing function is the
 * unit that plans and calls tools. A call with no tools is recorded as a single shot generation rather than as an agent
 * with an unknown role.
 */
const discoverGenerationCalls = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  files: Set<string>,
): Counts => {
  let components = 0;
  let edges = 0;

  for (const match of matchCalls(context.modules, {
    names: GENERATION_CALLS,
    packages: PACKAGES,
  })) {
    const entries = objectArgument(match.call);
    const modelName = modelNameFrom(findEntry(entries, 'model')?.value) ?? 'unspecified';
    const toolNames = toolNamesFrom(entries);
    const maxSteps = numberValue(findEntry(entries, 'maxSteps')?.value);
    const callee = dotted(match.call.calleePath);
    files.add(match.module.file);

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'model',
        identity: modelIdentity(modelName),
        file: match.module.file,
        name: modelName,
        location: match.call.location,
        symbol: callee,
        confidence: match.confidence,
        details: {
          for: 'model',
          modelId: modelName,
          streaming: callee.startsWith('stream'),
          structuredOutput: callee.includes('Object'),
        },
        metadata: { framework: 'vercel-ai-sdk' },
        tags: ['vercel-ai-sdk'],
      }),
    );
    components += 1;

    const callerName = match.call.enclosing ?? `${callee}-caller`;
    const callerIdentity = sourceIdentity('agent', match.module.file, callerName);
    const isToolLoop = toolNames.length > 0;
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        file: match.module.file,
        name: callerName,
        location: match.call.location,
        symbol: callerName,
        confidence: isToolLoop ? CONFIDENCE_BANDS.structural : CONFIDENCE_BANDS.heuristic,
        details: {
          for: 'agent',
          framework: 'vercel-ai-sdk',
          toolCount: toolNames.length,
          role: isToolLoop ? 'worker' : 'unspecified',
          ...(maxSteps === undefined ? {} : { maxTurns: maxSteps }),
        },
        metadata: {
          inferredFrom: isToolLoop ? 'tool using generation call' : 'single generation call',
          singleShot: !isToolLoop,
        },
        tags: ['vercel-ai-sdk'],
      }),
    );
    components += 1;
    if (!callee.endsWith('embed')) {
      registerPromptEntries({
        registry: context.promptInputs,
        producer: ADAPTER_ID,
        module: match.module,
        call: match.call,
        consumer: callerIdentity,
        entries,
        channels: ['system', 'prompt', 'messages'],
        supportingLocations: promptCallSupport(match.module, match.call),
      });
    }

    builder.addEdge(
      drafts.edge({
        kind: 'invokes_model',
        from: callerIdentity,
        to: modelIdentity(modelName),
        location: match.call.location,
        symbol: callee,
        ...(maxSteps === undefined
          ? {}
          : {
              policy: {
                retry: {
                  maxAttempts: maxSteps,
                  bounded: true,
                  backoff: 'none',
                  idempotency: 'unknown',
                },
              },
            }),
      }),
    );
    edges += 1;

    const linked = linkNamedTools(context, builder, callerIdentity, match, toolNames);
    components += linked.components;
    edges += linked.edges;
  }
  return { components, edges };
};

export const vercelAiSdkAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  packages: PACKAGES,
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const files = new Set<string>();
    const tools = discoverToolDefinitions(context, builder, files);
    const generations = discoverGenerationCalls(context, builder, files);
    return {
      componentsFound: tools + generations.components,
      edgesFound: generations.edges,
      filesInspected: [...files],
    };
  },
};
