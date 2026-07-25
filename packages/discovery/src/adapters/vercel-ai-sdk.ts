import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { ComponentIdentity } from '@orchescope/schema';
import type { ArgumentFact, ObjectEntryFact } from '@orchescope/source-analysis';
import { dotted, findEntry, numberValue, objectArgument, stringValue } from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter } from '../adapter.ts';
import { GLOBAL_NAMESPACES, createDrafts, globalIdentity, sourceIdentity } from '../drafts.ts';
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
const modelNameFrom = (value: ArgumentFact | undefined): string | undefined => {
  if (value === undefined) return undefined;
  if (value.kind === 'string') return value.value;
  if (value.kind === 'call') {
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

export const vercelAiSdkAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'javascript',
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    let components = 0;
    let edges = 0;
    const files = new Set<string>();

    for (const match of matchCalls(context.modules, { names: ['tool'], packages: PACKAGES })) {
      const entries = objectArgument(match.call);
      const definition = definitionForCall(match.module, match.call);
      const name = definition?.name ?? stringValue(findEntry(entries, 'description')?.value) ?? 'tool';
      const identity = sourceIdentity('tool', match.module.file, name);
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'tool',
          file: match.module.file,
          name,
          location: match.call.location,
          symbol: 'tool',
          confidence: match.confidence,
          ...(stringValue(findEntry(entries, 'description')?.value) === undefined
            ? {}
            : { description: stringValue(findEntry(entries, 'description')?.value) as string }),
          details: { for: 'tool' },
          metadata: { framework: 'vercel-ai-sdk', runtimeName: name },
          tags: ['vercel-ai-sdk'],
        }),
      );
      components += 1;
      files.add(match.module.file);
      context.bindings.register(match.module.file, name, identity);
    }

    for (const match of matchCalls(context.modules, { names: GENERATION_CALLS, packages: PACKAGES })) {
      const entries = objectArgument(match.call);
      const modelName = modelNameFrom(findEntry(entries, 'model')?.value) ?? 'unspecified';
      const toolNames = toolNamesFrom(entries);
      const maxSteps = numberValue(findEntry(entries, 'maxSteps')?.value);
      files.add(match.module.file);

      builder.addComponent(
        drafts.sourceComponent({
          kind: 'model',
          identity: modelIdentity(modelName),
          file: match.module.file,
          name: modelName,
          location: match.call.location,
          symbol: dotted(match.call.calleePath),
          confidence: match.confidence,
          details: {
            for: 'model',
            modelId: modelName,
            streaming: dotted(match.call.calleePath).startsWith('stream'),
            structuredOutput: dotted(match.call.calleePath).includes('Object'),
          },
          metadata: { framework: 'vercel-ai-sdk' },
          tags: ['vercel-ai-sdk'],
        }),
      );
      components += 1;

      const callerName = match.call.enclosing ?? `${dotted(match.call.calleePath)}-caller`;
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

      builder.addEdge(
        drafts.edge({
          kind: 'invokes_model',
          from: callerIdentity,
          to: modelIdentity(modelName),
          location: match.call.location,
          symbol: dotted(match.call.calleePath),
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

      for (const toolName of toolNames) {
        const target =
          context.bindings.lookup(match.module.file, toolName) ??
          sourceIdentity('tool', match.module.file, toolName);
        if (context.bindings.lookup(match.module.file, toolName) === undefined) {
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
            from: callerIdentity,
            to: target,
            location: match.call.location,
            symbol: `tools.${toolName}`,
          }),
        );
        edges += 1;
      }
    }

    return { componentsFound: components, edgesFound: edges, filesInspected: files.size };
  },
};
