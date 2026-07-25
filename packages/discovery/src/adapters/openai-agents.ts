import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, EdgePolicy } from '@orchescope/schema';
import type { CallFact, ModuleFacts, ObjectEntryFact } from '@orchescope/source-analysis';
import {
  booleanValue,
  findEntry,
  identifierItems,
  numberValue,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { GLOBAL_NAMESPACES, createDrafts, globalIdentity, sourceIdentity } from '../drafts.ts';
import { decoratedDefinitions, definitionForCall, matchCalls, projectUses } from '../matching.ts';

/**
 * The OpenAI Agents SDK, in both ecosystems.
 *
 * TypeScript writes `new Agent({ name, instructions, tools, handoffs })` and Python writes
 * `Agent(name=..., instructions=..., tools=[...], handoffs=[...])`. Both reduce to the same call fact
 * with the same object entries, so one adapter covers both. Python tools declared with the
 * `@function_tool` decorator are handled separately because a decorator is not a call site.
 */

const PACKAGES = ['@openai/agents', '@openai/agents-core', 'agents', 'openai-agents'];
const ADAPTER_ID = 'adapter:openai-agents';
const drafts = createDrafts(ADAPTER_ID);

const modelIdentity = (model: string): ComponentIdentity =>
  globalIdentity('model', GLOBAL_NAMESPACES.model, model);

const toolNameFrom = (entries: readonly ObjectEntryFact[], fallback: string): string =>
  stringValue(findEntry(entries, 'name')?.value) ??
  stringValue(findEntry(entries, 'name_override')?.value) ??
  fallback;

const registerTools = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { components: number } => {
  let components = 0;

  for (const match of matchCalls(context.modules, { names: ['tool'], packages: PACKAGES })) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const declaredName = toolNameFrom(entries, definition?.name ?? 'tool');
    const identity = sourceIdentity('tool', match.module.file, declaredName);
    const needsApproval = booleanValue(findEntry(entries, 'needsApproval')?.value);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'tool',
        file: match.module.file,
        name: declaredName,
        location: match.call.location,
        symbol: definition?.name ?? 'tool',
        confidence: match.confidence,
        ...(stringValue(findEntry(entries, 'description')?.value) === undefined
          ? {}
          : { description: stringValue(findEntry(entries, 'description')?.value) as string }),
        details: {
          for: 'tool',
          ...(needsApproval === undefined ? {} : { approvalRequired: needsApproval }),
        },
        metadata: { framework: 'openai-agents', declaredName },
        tags: ['openai-agents'],
      }),
    );
    components += 1;
    if (definition !== undefined) {
      context.bindings.register(match.module.file, definition.name, identity);
    }
    context.bindings.register(match.module.file, declaredName, identity);
  }

  for (const decorated of decoratedDefinitions(context.modules, ['function_tool'], PACKAGES)) {
    const decorator = decorated.definition.decorators.find(
      (entry) => entry.path[entry.path.length - 1] === 'function_tool',
    );
    const entries = decorator?.args[0]?.kind === 'object' ? decorator.args[0].entries : [];
    const declaredName = toolNameFrom(entries, decorated.definition.name);
    const identity = sourceIdentity('tool', decorated.module.file, declaredName);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'tool',
        file: decorated.module.file,
        name: declaredName,
        location: decorated.definition.location,
        symbol: `@function_tool ${decorated.definition.name}`,
        confidence: decorated.resolved ? CONFIDENCE_BANDS.deterministic : CONFIDENCE_BANDS.heuristic,
        details: { for: 'tool' },
        metadata: { framework: 'openai-agents', declaredName },
        tags: ['openai-agents'],
      }),
    );
    components += 1;
    context.bindings.register(decorated.module.file, decorated.definition.name, identity);
    context.bindings.register(decorated.module.file, declaredName, identity);
  }

  return { components };
};

const registerMcpServers = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { components: number } => {
  let components = 0;
  const names = ['MCPServerStdio', 'MCPServerStreamableHttp', 'MCPServerSse', 'MCPServerSSE'];
  for (const match of matchCalls(context.modules, { names, packages: PACKAGES })) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const declared =
      stringValue(findEntry(entries, 'name')?.value) ?? definition?.name ?? 'mcp-server';
    const url = stringValue(findEntry(entries, 'url')?.value);
    const command =
      stringValue(findEntry(entries, 'fullCommand')?.value) ??
      stringValue(findEntry(entries, 'command')?.value);
    const transport = url !== undefined ? 'http' : command !== undefined ? 'stdio' : 'unknown';
    const identity = sourceIdentity('mcp_server', match.module.file, declared);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'mcp_server',
        file: match.module.file,
        name: declared,
        location: match.call.location,
        symbol: match.call.calleePath.join('.'),
        confidence: match.confidence,
        details: {
          for: 'mcp_server',
          transport,
          ...(command === undefined ? {} : { command }),
          ...(url === undefined ? {} : { url }),
        },
        permissions: [
          url === undefined
            ? { kind: 'process', scope: command ?? 'unknown', mode: 'execute' }
            : { kind: 'network', scope: url, mode: 'write' },
        ],
        metadata: { framework: 'openai-agents' },
        tags: ['openai-agents', 'mcp'],
      }),
    );
    components += 1;
    if (definition !== undefined) context.bindings.register(match.module.file, definition.name, identity);
  }
  return { components };
};

const retryPolicyFor = (entries: readonly ObjectEntryFact[]): EdgePolicy | undefined => {
  const maxTurns = numberValue(findEntry(entries, 'maxTurns')?.value ?? findEntry(entries, 'max_turns')?.value);
  if (maxTurns === undefined) return undefined;
  return { concurrency: 1, retry: { maxAttempts: maxTurns, bounded: true, backoff: 'none', idempotency: 'unknown' } };
};

const registerAgents = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { components: number; edges: number } => {
  let components = 0;
  let edges = 0;

  const agentCalls = [
    ...matchCalls(context.modules, { names: ['Agent'], packages: PACKAGES }),
    ...matchCalls(context.modules, { names: ['create'], packages: PACKAGES, pathLength: 2 }).filter(
      (match) => match.call.calleePath[0] === 'Agent',
    ),
  ];

  type Pending = {
    readonly identity: ComponentIdentity;
    readonly module: ModuleFacts;
    readonly call: CallFact;
    readonly entries: readonly ObjectEntryFact[];
  };
  const pending: Pending[] = [];

  for (const match of agentCalls) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const declared = stringValue(findEntry(entries, 'name')?.value) ?? definition?.name ?? 'agent';
    const identity = sourceIdentity('agent', match.module.file, declared);
    const instructions = stringValue(findEntry(entries, 'instructions')?.value);
    const model = stringValue(findEntry(entries, 'model')?.value);
    const toolNames = identifierItems(findEntry(entries, 'tools')?.value);
    const handoffNames = identifierItems(findEntry(entries, 'handoffs')?.value);

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        file: match.module.file,
        name: declared,
        location: match.call.location,
        symbol: definition?.name ?? 'Agent',
        confidence: match.confidence,
        ...(instructions === undefined
          ? {}
          : { description: instructions.slice(0, 240) }),
        details: {
          for: 'agent',
          framework: 'openai-agents',
          toolCount: toolNames.length,
          role: handoffNames.length > 0 ? 'orchestrator' : 'worker',
          ...(instructions === undefined ? {} : { instructionsRef: `inline:${declared}` }),
        },
        metadata: { framework: 'openai-agents', declaredName: declared },
        tags: ['openai-agents'],
      }),
    );
    components += 1;
    if (definition !== undefined) context.bindings.register(match.module.file, definition.name, identity);
    context.bindings.register(match.module.file, declared, identity);
    pending.push({ identity, module: match.module, call: match.call, entries });

    if (model !== undefined) {
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'model',
          identity: modelIdentity(model),
          file: match.module.file,
          name: model,
          location: match.call.location,
          symbol: `model: ${model}`,
          confidence: match.confidence,
          details: { for: 'model', modelId: model },
          metadata: { framework: 'openai-agents' },
        }),
      );
      components += 1;
    }
  }

  for (const entry of pending) {
    const policy = retryPolicyFor(entry.entries);
    const modelName = stringValue(findEntry(entry.entries, 'model')?.value);
    if (modelName !== undefined) {
      builder.addEdge(
        drafts.edge({
          kind: 'invokes_model',
          from: entry.identity,
          to: modelIdentity(modelName),
          location: entry.call.location,
          symbol: `model: ${modelName}`,
          ...(policy === undefined ? {} : { policy }),
        }),
      );
      edges += 1;
    }

    for (const toolName of identifierItems(findEntry(entry.entries, 'tools')?.value)) {
      const target = context.bindings.lookup(entry.module.file, toolName);
      if (target === undefined) continue;
      builder.addEdge(
        drafts.edge({
          kind: target.kind === 'mcp_server' ? 'provides_tool' : 'calls_tool',
          from: entry.identity,
          to: target,
          location: entry.call.location,
          symbol: `tools: ${toolName}`,
        }),
      );
      edges += 1;
    }

    for (const serverName of identifierItems(
      findEntry(entry.entries, 'mcpServers')?.value ?? findEntry(entry.entries, 'mcp_servers')?.value,
    )) {
      const target = context.bindings.lookup(entry.module.file, serverName);
      if (target === undefined) continue;
      builder.addEdge(
        drafts.edge({
          kind: 'provides_tool',
          from: target,
          to: entry.identity,
          location: entry.call.location,
          symbol: `mcpServers: ${serverName}`,
        }),
      );
      edges += 1;
    }

    for (const handoffName of identifierItems(findEntry(entry.entries, 'handoffs')?.value)) {
      const target = context.bindings.lookup(entry.module.file, handoffName);
      if (target === undefined) continue;
      builder.addEdge(
        drafts.edge({
          kind: 'hands_off_to',
          from: entry.identity,
          to: target,
          location: entry.call.location,
          symbol: `handoffs: ${handoffName}`,
        }),
      );
      edges += 1;
    }
  }

  return { components, edges };
};

export const openAiAgentsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'javascript',
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const tools = registerTools(context, builder);
    const servers = registerMcpServers(context, builder);
    const agents = registerAgents(context, builder);
    const filesInspected = context.modules.filter(
      (module) => module.imports.some((entry) => PACKAGES.includes(entry.module)),
    ).length;
    return {
      componentsFound: tools.components + servers.components + agents.components,
      edgesFound: agents.edges,
      filesInspected,
    };
  },
};
