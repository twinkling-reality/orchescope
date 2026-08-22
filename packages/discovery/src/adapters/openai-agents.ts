import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, EdgeKind, EdgePolicy, SourceLocation } from '@orchescope/schema';
import type {
  ArgumentFact,
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
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
import {
  decoratedDefinitions,
  definitionForCall,
  matchCalls,
  matchRuntimeSymbol,
  projectUses,
} from '../matching.ts';

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

const decoratorName = (decorator: DefinitionFact['decorators'][number]): string | undefined =>
  decorator.origin !== undefined &&
  decorator.origin.imported !== '*' &&
  decorator.origin.imported !== 'default'
    ? decorator.origin.imported
    : decorator.path[decorator.path.length - 1];

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
      (entry) => decoratorName(entry) === 'function_tool',
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
 * A guardrail the repository declares, which is a different thing from the agent it runs.
 *
 * `@input_guardrail` decorates a function, and that function usually runs an agent of its own, so a repository
 * declares both and this adapter read only the second. On the pinned customer service demo the graph held an agent
 * named `Relevance Guardrail` and nothing else, while a run reported an evaluation under the same name. The kinds
 * disagreed, reconciliation matches on kind and name, and one guardrail became two components with the run's half
 * reported at high severity as having executed undeclared.
 *
 * `evaluator` is the kind because it is what a run calls this, and agreeing with the run is the whole point: a span
 * whose operation is an evaluation resolves to `evaluator`, so declaring one here is what lets the two meet. It also
 * gives that kind and the `validated_by` relation below their first producer that reads source rather than a trace.
 */
const registerGuardrails = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { components: number } => {
  let components = 0;
  const decorators = ['input_guardrail', 'output_guardrail'];
  for (const decorated of decoratedDefinitions(context.modules, decorators, PACKAGES)) {
    const decorator = decorated.definition.decorators.find((entry) =>
      decorators.includes(decoratorName(entry) ?? ''),
    );
    const entries = decorator?.args[0]?.kind === 'object' ? decorator.args[0].entries : [];
    // The decorator names the guardrail the way a run reports it; the function name is what the agent list cites.
    const declaredName =
      stringValue(findEntry(entries, 'name')?.value) ?? decorated.definition.name;
    const guards =
      decorator !== undefined && decoratorName(decorator) === 'output_guardrail'
        ? 'output'
        : 'input';
    const identity = sourceIdentity('evaluator', decorated.module.file, declaredName);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'evaluator',
        file: decorated.module.file,
        name: declaredName,
        location: decorated.definition.location,
        symbol: `@${guards}_guardrail ${decorated.definition.name}`,
        confidence: decorated.resolved
          ? CONFIDENCE_BANDS.deterministic
          : CONFIDENCE_BANDS.heuristic,
        metadata: { framework: 'openai-agents', declaredName, guards },
        tags: ['openai-agents', 'guardrail'],
      }),
    );
    components += 1;
    context.bindings.register(decorated.module.file, decorated.definition.name, identity);
    context.bindings.register(decorated.module.file, declaredName, identity);
    context.implementations.record({
      identity,
      file: decorated.module.file,
      body: decorated.definition.location,
      symbol: `@${guards}_guardrail ${decorated.definition.name}`,
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

const agentConstructionCalls = (context: DiscoveryContext) => {
  const matches = matchCalls(context.modules, { names: ['Agent'], packages: PACKAGES }).filter(
    (match) => match.call.calleePath[match.call.calleePath.length - 1] !== 'create',
  );
  for (const module of context.modules) {
    for (const call of module.calls) {
      if (call.calleePath.length !== 2 || call.calleePath[1] !== 'create') continue;
      const matched = matchRuntimeSymbol(
        context.modules,
        module,
        {
          path: call.calleePath,
          origin: call.origin,
          enclosing: call.enclosing,
        },
        { names: ['Agent'], packages: PACKAGES },
      );
      if (matched !== undefined) matches.push({ module, call, ...matched });
    }
  }
  return matches;
};

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
  /*
   * Read as two lists rather than one, because an agent may declare both and `addNamedRelations` takes the first key
   * that matches. What guards the input and what checks the output are different claims about the same agent.
   */
  edges += addNamedRelations(context, builder, agent, {
    key: ['input_guardrails', 'inputGuardrails'],
    kind: () => 'validated_by',
    label: 'input_guardrails',
  });
  edges += addNamedRelations(context, builder, agent, {
    key: ['output_guardrails', 'outputGuardrails'],
    kind: () => 'validated_by',
    label: 'output_guardrails',
  });
  return edges;
};

/**
 * A handoff a repository wires after construction, which is the only way it can wire a cycle.
 *
 * `Agent(handoffs=[...])` names peers that already exist, so a set of agents that hand off to one another cannot be
 * written that way and is not: the customer service demo constructs its triage agent with `handoffs=[]` and assigns
 * five on the next line, then appends and extends onto five more. Read from the constructor alone that repository
 * declares no handoff at all, and a run of it reported six the graph had never heard of.
 *
 * Three spellings, because all three are used in one file: an assignment, an `append` of one, and an `extend` of a
 * list. Each item is either the agent itself or `handoff(agent=..., on_handoff=...)`, which names it in an argument.
 */
const HANDOFF_MEMBER = 'handoffs';

const handoffTargets = (value: ArgumentFact | undefined): readonly string[] => {
  const items = value?.kind === 'array' ? value.items : value === undefined ? [] : [value];
  const names: string[] = [];
  for (const item of items) {
    if (item.kind === 'identifier') names.push(item.name);
    // `handoff(agent=X)` names its destination in an argument rather than being one.
    if (item.kind === 'call') {
      const entries = item.args.find((argument) => argument.kind === 'object');
      const agent =
        entries?.kind === 'object' ? findEntry(entries.entries, 'agent')?.value : undefined;
      if (agent?.kind === 'identifier') names.push(agent.name);
    }
  }
  return names;
};

const addAssignedHandoffs = (context: DiscoveryContext, builder: SystemGraphBuilder): number => {
  let edges = 0;
  const draw = (
    file: string,
    holder: string,
    value: ArgumentFact | undefined,
    location: SourceLocation,
    symbol: string,
  ): void => {
    const from = context.bindings.lookup(file, holder);
    if (from === undefined || from.kind !== 'agent') return;
    for (const name of handoffTargets(value)) {
      const to = context.bindings.lookup(file, name);
      if (to === undefined || to.kind !== 'agent') continue;
      builder.addEdge(
        drafts.edge({ kind: 'hands_off_to', from, to, location, symbol: `${symbol}: ${name}` }),
      );
      edges += 1;
    }
  };

  for (const module of context.modules) {
    for (const assignment of module.assignments) {
      if (assignment.target[assignment.target.length - 1] !== HANDOFF_MEMBER) continue;
      const holder = assignment.target[assignment.target.length - 2];
      if (holder === undefined) continue;
      draw(module.file, holder, assignment.value, assignment.location, 'handoffs');
    }
    for (const call of module.calls) {
      const path = call.calleePath;
      const method = path[path.length - 1];
      if (method !== 'append' && method !== 'extend') continue;
      if (path[path.length - 2] !== HANDOFF_MEMBER) continue;
      const holder = path[path.length - 3];
      if (holder === undefined) continue;
      draw(module.file, holder, call.args[0], call.location, `handoffs.${method}`);
    }
  }
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
  // After the agents, because both ends of a handoff have to be registered before the relation can resolve.
  edges += addAssignedHandoffs(context, builder);
  return { components: added.components, edges };
};

export const openAiAgentsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  packages: PACKAGES,
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const tools = registerTools(context, builder);
    // Before the agents, because an agent's guardrail list is resolved through the bindings this registers.
    const guardrails = registerGuardrails(context, builder);
    const servers = registerMcpServers(context, builder);
    const agents = registerAgents(context, builder);
    const filesInspected = context.modules
      .filter((module) => module.imports.some((entry) => PACKAGES.includes(entry.module)))
      .map((module) => module.file);
    return {
      componentsFound:
        tools.components + guardrails.components + servers.components + agents.components,
      edgesFound: agents.edges,
      filesInspected,
    };
  },
};
