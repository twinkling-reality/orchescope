import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, EdgeKind, EdgePolicy } from '@orchescope/schema';
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
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
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

/** Both spellings, because the two SDKs differ only in the case convention of the option. */
const approvalFrom = (entries: readonly ObjectEntryFact[]): boolean | undefined =>
  booleanValue(findEntry(entries, 'needsApproval')?.value) ??
  booleanValue(findEntry(entries, 'needs_approval')?.value);

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
    const needsApproval = approvalFrom(entries);
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
    // The call holds the tool's `execute`, so what runs when the tool is invoked is written inside it.
    context.implementations.record({
      identity,
      file: match.module.file,
      body: match.call.location,
      symbol: `tool(${declaredName})`,
    });
  }

  for (const decorated of decoratedDefinitions(context.modules, ['function_tool'], PACKAGES)) {
    const decorator = decorated.definition.decorators.find(
      (entry) => entry.path[entry.path.length - 1] === 'function_tool',
    );
    const entries = decorator?.args[0]?.kind === 'object' ? decorator.args[0].entries : [];
    const declaredName = toolNameFrom(entries, decorated.definition.name);
    const identity = sourceIdentity('tool', decorated.module.file, declaredName);
    const needsApproval = approvalFrom(entries);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'tool',
        file: decorated.module.file,
        name: declaredName,
        location: decorated.definition.location,
        symbol: `@function_tool ${decorated.definition.name}`,
        confidence: decorated.resolved
          ? CONFIDENCE_BANDS.deterministic
          : CONFIDENCE_BANDS.heuristic,
        details: {
          for: 'tool',
          ...(needsApproval === undefined ? {} : { approvalRequired: needsApproval }),
        },
        metadata: { framework: 'openai-agents', declaredName },
        tags: ['openai-agents'],
      }),
    );
    components += 1;
    context.bindings.register(decorated.module.file, decorated.definition.name, identity);
    context.bindings.register(decorated.module.file, declaredName, identity);
    context.implementations.record({
      identity,
      file: decorated.module.file,
      body: decorated.definition.location,
      symbol: `@function_tool ${decorated.definition.name}`,
    });
  }

  return { components };
};

/**
 * How a server is reached, from either spelling.
 *
 * TypeScript passes `fullCommand` or `url` at the top level. Python nests the same facts inside `params`, as
 * `{"command": "npx", "args": [...]}`, so the invocation has to be reassembled from two entries. Both end up as
 * one invocation string, because that is what the permission scope has to name.
 */
const serverTransport = (
  entries: readonly ObjectEntryFact[],
): { readonly command: string | undefined; readonly url: string | undefined } => {
  const params = findEntry(entries, 'params')?.value;
  const nested = params !== undefined && params.kind === 'object' ? params.entries : [];
  const command =
    stringValue(findEntry(entries, 'fullCommand')?.value) ??
    stringValue(findEntry(entries, 'command')?.value) ??
    stringValue(findEntry(nested, 'command')?.value);
  const args = identifierItems(findEntry(nested, 'args')?.value);
  return {
    command: command === undefined ? undefined : [command, ...args].join(' '),
    url:
      stringValue(findEntry(entries, 'url')?.value) ?? stringValue(findEntry(nested, 'url')?.value),
  };
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
    const { command, url } = serverTransport(entries);
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
          // The agent in this repository connects to it, so it is part of the system this repository runs.
          role: 'consumed',
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
    if (definition !== undefined)
      context.bindings.register(match.module.file, definition.name, identity);
  }
  return { components };
};

const retryPolicyFor = (entries: readonly ObjectEntryFact[]): EdgePolicy | undefined => {
  const maxTurns = numberValue(
    findEntry(entries, 'maxTurns')?.value ?? findEntry(entries, 'max_turns')?.value,
  );
  if (maxTurns === undefined) return undefined;
  return {
    concurrency: 1,
    retry: { maxAttempts: maxTurns, bounded: true, backoff: 'none', idempotency: 'unknown' },
  };
};

type PendingAgent = {
  readonly identity: ComponentIdentity;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly entries: readonly ObjectEntryFact[];
};

const agentConstructionCalls = (context: DiscoveryContext) => [
  ...matchCalls(context.modules, { names: ['Agent'], packages: PACKAGES }),
  ...matchCalls(context.modules, { names: ['create'], packages: PACKAGES, pathLength: 2 }).filter(
    (match) => match.call.calleePath[0] === 'Agent',
  ),
];

/**
 * Agents and the models they name, recorded first so that a relation between two agents can resolve both ends.
 */
const addAgents = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { readonly components: number; readonly pending: readonly PendingAgent[] } => {
  const pending: PendingAgent[] = [];
  let components = 0;

  for (const match of agentConstructionCalls(context)) {
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
        ...(instructions === undefined ? {} : { description: instructions.slice(0, 240) }),
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
    if (definition !== undefined) {
      context.bindings.register(match.module.file, definition.name, identity);
    }
    context.bindings.register(match.module.file, declared, identity);
    pending.push({ identity, module: match.module, call: match.call, entries });

    if (model === undefined) continue;
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
  return { components, pending };
};

/** Relations named by identifier, resolved through the bindings recorded while the agents were added. */
const addNamedRelations = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  agent: PendingAgent,
  named: {
    readonly key: readonly string[];
    readonly kind: (target: ComponentIdentity) => EdgeKind;
    readonly reversed?: boolean;
    readonly label: string;
  },
): number => {
  const value = named.key
    .map((key) => findEntry(agent.entries, key)?.value)
    .find((candidate) => candidate !== undefined);
  let edges = 0;
  for (const name of identifierItems(value)) {
    const target = context.bindings.lookup(agent.module.file, name);
    if (target === undefined) continue;
    builder.addEdge(
      drafts.edge({
        kind: named.kind(target),
        from: named.reversed === true ? target : agent.identity,
        to: named.reversed === true ? agent.identity : target,
        location: agent.call.location,
        symbol: `${named.label}: ${name}`,
      }),
    );
    edges += 1;
  }
  return edges;
};

const addAgentRelations = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  agent: PendingAgent,
): number => {
  let edges = 0;
  const policy = retryPolicyFor(agent.entries);
  const modelName = stringValue(findEntry(agent.entries, 'model')?.value);
  if (modelName !== undefined) {
    builder.addEdge(
      drafts.edge({
        kind: 'invokes_model',
        from: agent.identity,
        to: modelIdentity(modelName),
        location: agent.call.location,
        symbol: `model: ${modelName}`,
        ...(policy === undefined ? {} : { policy }),
      }),
    );
    edges += 1;
  }

  edges += addNamedRelations(context, builder, agent, {
    key: ['tools'],
    kind: (target) => (target.kind === 'mcp_server' ? 'provides_tool' : 'calls_tool'),
    label: 'tools',
  });
  edges += addNamedRelations(context, builder, agent, {
    key: ['mcpServers', 'mcp_servers'],
    kind: () => 'provides_tool',
    reversed: true,
    label: 'mcpServers',
  });
  edges += addNamedRelations(context, builder, agent, {
    key: ['handoffs'],
    kind: () => 'hands_off_to',
    label: 'handoffs',
  });
  return edges;
};

const registerAgents = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { components: number; edges: number } => {
  const added = addAgents(context, builder);
  let edges = 0;
  for (const agent of added.pending) {
    edges += addAgentRelations(context, builder, agent);
  }
  return { components: added.components, edges };
};

export const openAiAgentsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'javascript',
  packages: PACKAGES,
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const tools = registerTools(context, builder);
    const servers = registerMcpServers(context, builder);
    const agents = registerAgents(context, builder);
    const filesInspected = context.modules.filter((module) =>
      module.imports.some((entry) => PACKAGES.includes(entry.module)),
    ).length;
    return {
      componentsFound: tools.components + servers.components + agents.components,
      edgesFound: agents.edges,
      filesInspected,
    };
  },
};
