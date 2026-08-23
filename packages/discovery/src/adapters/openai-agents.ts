import { CONFIDENCE_BANDS, identityKey } from '@orchescope/domain';
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
import type {
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
  TopologyDiscovery,
} from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { implementationBody } from '../implementation-span.ts';
import {
  decoratedDefinitions,
  definitionForCall,
  hasBindingAt,
  matchCalls,
  matchRuntimeSymbol,
  projectUses,
} from '../matching.ts';
import { promptCallSupport, registerPromptEntries } from '../prompt-input.ts';

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

type ScopedBinding = {
  readonly file: string;
  readonly name: string;
  readonly identity: ComponentIdentity;
  readonly enclosing: string | undefined;
  readonly enclosingLocation: SourceLocation | undefined;
  readonly location: SourceLocation;
};

const registerScopedBinding = (
  context: DiscoveryContext,
  bindings: ScopedBinding[],
  binding: ScopedBinding,
): void => {
  bindings.push(binding);
  if (binding.enclosing === undefined && binding.enclosingLocation === undefined) {
    context.bindings.register(binding.file, binding.name, binding.identity);
  }
};

const registerDefinitionAliases = (
  context: DiscoveryContext,
  bindings: ScopedBinding[],
  file: string,
  definition: DefinitionFact,
  identity: ComponentIdentity,
  names: readonly string[],
): void => {
  for (const name of new Set(names)) {
    registerScopedBinding(context, bindings, {
      file,
      name,
      identity,
      enclosing: definition.enclosing,
      enclosingLocation: definition.enclosingLocation,
      location: definition.location,
    });
  }
};

const modelIdentity = (model: string): ComponentIdentity =>
  globalIdentity('model', GLOBAL_NAMESPACES.model, model);

const toolNameFrom = (entries: readonly ObjectEntryFact[], fallback: string): string =>
  stringValue(findEntry(entries, 'name')?.value) ??
  stringValue(findEntry(entries, 'name_override')?.value) ??
  fallback;

const explicitToolName = (entries: readonly ObjectEntryFact[]): string | undefined =>
  stringValue(findEntry(entries, 'name')?.value) ??
  stringValue(findEntry(entries, 'name_override')?.value);

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
  unresolved: TopologyDiscovery['unresolved'][number][],
): { components: number; bindings: readonly ScopedBinding[] } => {
  let components = 0;
  const bindings: ScopedBinding[] = [];

  for (const match of matchCalls(context.modules, { names: ['tool'], packages: PACKAGES })) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const explicitName = explicitToolName(entries);
    if (match.call.enclosingUnresolved === true && explicitName === undefined) {
      unresolved.push({
        kind: 'adapter_input',
        reason:
          'a tool inside a callable without an authoritative source name declares no distinct runtime name',
        location: match.call.location,
      });
      continue;
    }
    const declaredName = explicitName ?? definition?.name ?? 'tool';
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
      registerScopedBinding(context, bindings, {
        file: match.module.file,
        name: definition.name,
        identity,
        enclosing: definition.enclosing,
        enclosingLocation: definition.enclosingLocation,
        location: match.call.location,
      });
    }
    registerScopedBinding(context, bindings, {
      file: match.module.file,
      name: declaredName,
      identity,
      enclosing: definition?.enclosing ?? match.call.enclosing,
      enclosingLocation: definition?.enclosingLocation,
      location: match.call.location,
    });
    // The call holds the tool's `execute`, so what runs when the tool is invoked is written inside it.
    const body = implementationBody(match.module, match.call, findEntry(entries, 'execute')?.value);
    if (body !== undefined) {
      context.implementations.record({
        identity,
        file: match.module.file,
        body,
        symbol: `tool(${declaredName})`,
      });
    }
  }

  for (const decorated of decoratedDefinitions(context.modules, ['function_tool'], PACKAGES)) {
    const decorator = decorated.definition.decorators.find(
      (entry) => decoratorName(entry) === 'function_tool',
    );
    const entries = decorator?.args[0]?.kind === 'object' ? decorator.args[0].entries : [];
    const sourceName = decorated.definition.name.split('.').at(-1) ?? decorated.definition.name;
    const declaredName = toolNameFrom(entries, sourceName);
    const explicitName = explicitToolName(entries);
    if (decorated.definition.enclosingUnresolved === true && explicitName === undefined) {
      unresolved.push({
        kind: 'adapter_input',
        reason:
          'a decorated tool inside a callable without an authoritative source name declares no distinct runtime name',
        location: decorated.definition.location,
      });
      continue;
    }
    const identity = sourceIdentity(
      'tool',
      decorated.module.file,
      decorated.definition.enclosing === undefined ? declaredName : decorated.definition.name,
    );
    const needsApproval = approvalFrom(entries);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'tool',
        identity,
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
        metadata: {
          framework: 'openai-agents',
          declaredName,
          ...(decorated.definition.enclosing === undefined ? {} : { runtimeName: declaredName }),
        },
        tags: ['openai-agents'],
      }),
    );
    components += 1;
    registerDefinitionAliases(
      context,
      bindings,
      decorated.module.file,
      decorated.definition,
      identity,
      [decorated.definition.name, sourceName, declaredName],
    );
    context.implementations.record({
      identity,
      file: decorated.module.file,
      body: decorated.definition.location,
      symbol: `@function_tool ${decorated.definition.name}`,
    });
  }

  return { components, bindings };
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
  unresolved: TopologyDiscovery['unresolved'][number][],
): { components: number; bindings: readonly ScopedBinding[] } => {
  let components = 0;
  const bindings: ScopedBinding[] = [];
  const decorators = ['input_guardrail', 'output_guardrail'];
  for (const decorated of decoratedDefinitions(context.modules, decorators, PACKAGES)) {
    const decorator = decorated.definition.decorators.find((entry) =>
      decorators.includes(decoratorName(entry) ?? ''),
    );
    const entries = decorator?.args[0]?.kind === 'object' ? decorator.args[0].entries : [];
    // The decorator names the guardrail the way a run reports it; the function name is what the agent list cites.
    const sourceName = decorated.definition.name.split('.').at(-1) ?? decorated.definition.name;
    const declaredName = stringValue(findEntry(entries, 'name')?.value) ?? sourceName;
    if (
      decorated.definition.enclosingUnresolved === true &&
      stringValue(findEntry(entries, 'name')?.value) === undefined
    ) {
      unresolved.push({
        kind: 'adapter_input',
        reason:
          'a guardrail inside a callable without an authoritative source name declares no distinct runtime name',
        location: decorated.definition.location,
      });
      continue;
    }
    const guards =
      decorator !== undefined && decoratorName(decorator) === 'output_guardrail'
        ? 'output'
        : 'input';
    const identity = sourceIdentity(
      'evaluator',
      decorated.module.file,
      decorated.definition.enclosing === undefined ? declaredName : decorated.definition.name,
    );
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'evaluator',
        identity,
        file: decorated.module.file,
        name: declaredName,
        location: decorated.definition.location,
        symbol: `@${guards}_guardrail ${decorated.definition.name}`,
        confidence: decorated.resolved
          ? CONFIDENCE_BANDS.deterministic
          : CONFIDENCE_BANDS.heuristic,
        metadata: {
          framework: 'openai-agents',
          declaredName,
          guards,
          ...(decorated.definition.enclosing === undefined ? {} : { runtimeName: declaredName }),
        },
        tags: ['openai-agents', 'guardrail'],
      }),
    );
    components += 1;
    registerDefinitionAliases(
      context,
      bindings,
      decorated.module.file,
      decorated.definition,
      identity,
      [decorated.definition.name, sourceName, declaredName],
    );
    context.implementations.record({
      identity,
      file: decorated.module.file,
      body: decorated.definition.location,
      symbol: `@${guards}_guardrail ${decorated.definition.name}`,
    });
  }
  return { components, bindings };
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
  unresolved: TopologyDiscovery['unresolved'][number][],
): { components: number; bindings: readonly ScopedBinding[] } => {
  let components = 0;
  const bindings: ScopedBinding[] = [];
  const names = ['MCPServerStdio', 'MCPServerStreamableHttp', 'MCPServerSse', 'MCPServerSSE'];
  for (const match of matchCalls(context.modules, { names, packages: PACKAGES })) {
    const entries = objectArgument(match.call);
    const definition = definitionForCall(match.module, match.call);
    const explicitName = stringValue(findEntry(entries, 'name')?.value);
    if (match.call.enclosingUnresolved === true && explicitName === undefined) {
      unresolved.push({
        kind: 'adapter_input',
        reason:
          'an MCP server inside a callable without an authoritative source name declares no distinct runtime name',
        location: match.call.location,
      });
      continue;
    }
    const declared = explicitName ?? definition?.name ?? 'mcp-server';
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
    if (definition !== undefined) {
      registerScopedBinding(context, bindings, {
        file: match.module.file,
        name: definition.name,
        identity,
        enclosing: definition.enclosing,
        enclosingLocation: definition.enclosingLocation,
        location: match.call.location,
      });
      registerScopedBinding(context, bindings, {
        file: match.module.file,
        name: declared,
        identity,
        enclosing: definition.enclosing,
        enclosingLocation: definition.enclosingLocation,
        location: match.call.location,
      });
    }
  }
  return { components, bindings };
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
  readonly variable: string | undefined;
  readonly enclosing: string | undefined;
  readonly enclosingLocation: SourceLocation | undefined;
  readonly supportingLocations: readonly SourceLocation[];
};

const sameRange = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine === right.startLine &&
  left.startColumn === right.startColumn &&
  left.endLine === right.endLine &&
  left.endColumn === right.endColumn;

const sameOptionalRange = (
  left: SourceLocation | undefined,
  right: SourceLocation | undefined,
): boolean =>
  left === undefined ? right === undefined : right !== undefined && sameRange(left, right);

const endsBefore = (left: SourceLocation, right: SourceLocation): boolean => {
  const endLine = left.endLine ?? left.startLine;
  if (endLine !== right.startLine) return endLine < right.startLine;
  if (left.endColumn === undefined || right.startColumn === undefined) return false;
  return left.endColumn <= right.startColumn;
};

const bindingAtLocation = (
  module: ModuleFacts,
  name: string,
  bindings: readonly ScopedBinding[],
  enclosing: string | undefined,
  enclosingLocation: SourceLocation | undefined,
  useLocation: SourceLocation,
  captured = false,
): { readonly target?: ComponentIdentity; readonly blocked: boolean } => {
  const candidates = bindings.filter(
    (binding) =>
      binding.file === module.file &&
      binding.name === name &&
      binding.enclosing === enclosing &&
      sameOptionalRange(binding.enclosingLocation, enclosingLocation),
  );
  const preceding = candidates.filter((binding) => endsBefore(binding.location, useLocation));
  const identities = new Map(
    preceding.map((binding) => [identityKey(binding.identity), binding.identity]),
  );
  if (identities.size !== 1) {
    return { blocked: candidates.length > 0 || identities.size > 1 };
  }
  const changed = preceding.some((binding) =>
    module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === name &&
        assignment.enclosing === enclosing &&
        sameOptionalRange(assignment.enclosingLocation, enclosingLocation) &&
        endsBefore(binding.location, assignment.location) &&
        (captured || endsBefore(assignment.location, useLocation)),
    ),
  );
  const target = [...identities.values()][0];
  return changed || target === undefined ? { blocked: true } : { target, blocked: false };
};

const namedOwnerOfScope = (module: ModuleFacts, location: SourceLocation): string | undefined =>
  module.definitions.find(
    (definition) =>
      ((definition.kind === 'function' || definition.kind === 'method') &&
        sameRange(definition.location, location)) ||
      (definition.kind === 'variable' &&
        definition.value?.kind === 'function' &&
        sameRange(definition.value.location, location)),
  )?.name;

const resolveScopedBinding = (
  context: DiscoveryContext,
  agent: PendingAgent,
  name: string,
  bindings: readonly ScopedBinding[],
): { readonly target?: ComponentIdentity; readonly blocked: boolean } => {
  for (const scope of [...(agent.call.lexicalScopes ?? [])].reverse()) {
    const local = bindingAtLocation(
      agent.module,
      name,
      bindings,
      agent.enclosing,
      scope.location,
      agent.call.location,
    );
    if (local.target !== undefined || local.blocked) return local;
    const namedOwner = namedOwnerOfScope(agent.module, scope.location);
    if (namedOwner !== undefined && namedOwner !== agent.enclosing) {
      const namedOuter = bindingAtLocation(
        agent.module,
        name,
        bindings,
        namedOwner,
        scope.location,
        agent.call.location,
        agent.enclosingLocation === undefined ||
          !sameRange(scope.location, agent.enclosingLocation),
      );
      if (namedOuter.target !== undefined || namedOuter.blocked) return namedOuter;
    }
    if (scope.bindings.includes(name)) return { blocked: true };
  }
  if (agent.enclosingLocation === undefined && agent.enclosing !== undefined) {
    const namedLocal = bindingAtLocation(
      agent.module,
      name,
      bindings,
      agent.enclosing,
      undefined,
      agent.call.location,
    );
    if (namedLocal.target !== undefined || namedLocal.blocked) return namedLocal;
    const localNamedBinding =
      agent.module.definitions.some(
        (definition) =>
          definition.name === name &&
          definition.enclosing === agent.enclosing &&
          definition.enclosingLocation === undefined,
      ) ||
      agent.module.assignments.some(
        (assignment) =>
          assignment.target.length === 1 &&
          assignment.target[0] === name &&
          assignment.enclosing === agent.enclosing &&
          assignment.enclosingLocation === undefined,
      );
    if (localNamedBinding) return { blocked: true };
  }
  const moduleBinding = bindingAtLocation(
    agent.module,
    name,
    bindings,
    undefined,
    undefined,
    agent.call.location,
    agent.enclosing !== undefined || agent.enclosingLocation !== undefined,
  );
  if (moduleBinding.target !== undefined || moduleBinding.blocked) return moduleBinding;
  const localModuleBinding =
    agent.module.definitions.some(
      (definition) =>
        definition.name === name &&
        definition.enclosing === undefined &&
        definition.enclosingLocation === undefined,
    ) ||
    agent.module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === name &&
        assignment.enclosing === undefined &&
        assignment.enclosingLocation === undefined,
    );
  if (localModuleBinding) return { blocked: true };
  const imported = context.bindings.lookup(agent.module.file, name);
  return imported === undefined ? { blocked: false } : { target: imported, blocked: false };
};

const isDirectAgentCall = (call: CallFact): boolean =>
  call.calleePath.at(-1) === 'Agent' ||
  (call.calleePath.length === 1 && call.origin?.imported === 'Agent');

const matchAgentReceiver = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
): ReturnType<typeof matchRuntimeSymbol> => {
  if (call.calleePath.length < 2) return undefined;
  return matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: call.calleePath.slice(0, -1),
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: ['Agent'], packages: PACKAGES },
  );
};

const agentConstructionCalls = (context: DiscoveryContext) => {
  const matches = matchCalls(context.modules, { names: ['Agent'], packages: PACKAGES }).filter(
    (match) => isDirectAgentCall(match.call),
  );
  for (const module of context.modules) {
    for (const call of module.calls) {
      if (call.calleePath.at(-1) !== 'create') continue;
      const matched = matchAgentReceiver(context, module, call);
      if (matched !== undefined) matches.push({ module, call, ...matched });
    }
  }
  return matches;
};

const unsettledAgentChains = (context: DiscoveryContext): readonly CallFact[] => {
  const unsettled: CallFact[] = [];
  for (const module of context.modules) {
    for (const call of module.calls) {
      if (
        call.calleePath.length < 2 ||
        call.calleePath.at(-1) === 'Agent' ||
        call.calleePath.at(-1) === 'create'
      ) {
        continue;
      }
      const matched = matchAgentReceiver(context, module, call);
      if (matched !== undefined) unsettled.push(call);
    }
  }
  return unsettled;
};

const recordUnsettledAgentChains = (
  context: DiscoveryContext,
  unresolved: TopologyDiscovery['unresolved'][number][],
): void => {
  for (const call of unsettledAgentChains(context)) {
    unresolved.push({
      kind: 'adapter_input',
      reason:
        'a call chained from an Agent constructor does not retain the constructor arguments needed to identify that agent',
      location: call.location,
    });
  }
};

const samePath = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((segment, index) => segment === right[index]);

const startsAtOrBefore = (left: SourceLocation, right: SourceLocation): boolean =>
  left.startLine < right.startLine ||
  (left.startLine === right.startLine && (left.startColumn ?? 0) <= (right.startColumn ?? 0));

const endsAtOrAfter = (left: SourceLocation, right: SourceLocation): boolean => {
  const leftLine = left.endLine ?? left.startLine;
  const rightLine = right.endLine ?? right.startLine;
  return (
    leftLine > rightLine ||
    (leftLine === rightLine && (left.endColumn ?? left.startColumn ?? 0) >= (right.endColumn ?? 0))
  );
};

const strictlyContains = (container: SourceLocation, contained: SourceLocation): boolean =>
  !sameRange(container, contained) &&
  startsAtOrBefore(container, contained) &&
  endsAtOrAfter(container, contained);

/**
 * A containing variable is not necessarily the binding for an Agent construction. In
 * `result = Runner.run(Agent(...))`, the variable binds Runner's result, not the nested Agent.
 */
const directAgentDefinition = (
  module: ModuleFacts,
  call: CallFact,
): ReturnType<typeof definitionForCall> => {
  const definition = definitionForCall(module, call);
  return definition?.kind === 'variable' &&
    definition.initializer !== undefined &&
    samePath(definition.initializer, call.calleePath) &&
    !module.calls.some(
      (candidate) =>
        strictlyContains(definition.location, candidate.location) &&
        strictlyContains(candidate.location, call.location),
    )
    ? definition
    : undefined;
};

const preparedAgentConstructions = (context: DiscoveryContext) => {
  const constructions = agentConstructionCalls(context).map((match) => {
    const entries = objectArgument(match.call);
    const definition = directAgentDefinition(match.module, match.call);
    const explicitName = stringValue(findEntry(entries, 'name')?.value);
    const declared = explicitName ?? definition?.name ?? 'agent';
    const owner = definition?.enclosing ?? match.call.lexicalEnclosing ?? match.call.enclosing;
    const bindingName =
      definition === undefined ? declared : (definition.name.split('.').at(-1) ?? definition.name);
    return {
      match,
      entries,
      definition,
      explicitName,
      declared,
      scopedName: owner === undefined ? undefined : `${owner}.${bindingName}`,
    };
  });
  const moduleRuntimeCounts = new Map<string, number>();
  for (const construction of constructions) {
    if (construction.scopedName !== undefined) continue;
    const key = `${construction.match.module.file}\u0000${construction.declared}`;
    moduleRuntimeCounts.set(key, (moduleRuntimeCounts.get(key) ?? 0) + 1);
  }
  const prepared = constructions.map((construction) => {
    const moduleKey = `${construction.match.module.file}\u0000${construction.declared}`;
    const count = moduleRuntimeCounts.get(moduleKey) ?? 0;
    const sourceName =
      construction.scopedName ??
      (count > 1 && construction.definition?.kind === 'variable'
        ? construction.definition.name
        : count === 1
          ? construction.declared
          : undefined);
    const identity =
      sourceName === undefined
        ? undefined
        : sourceIdentity('agent', construction.match.module.file, sourceName);
    return { ...construction, sourceName, identity };
  });
  const sourceCounts = new Map<string, number>();
  for (const construction of prepared) {
    if (construction.identity === undefined) continue;
    const key = identityKey(construction.identity);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  return prepared.map((construction) => ({
    ...construction,
    identitySettled:
      construction.identity !== undefined &&
      (sourceCounts.get(identityKey(construction.identity)) ?? 0) === 1,
  }));
};

/**
 * Agents and the models they name, recorded first so that a relation between two agents can resolve both ends.
 */
const addAgents = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  unresolved: TopologyDiscovery['unresolved'][number][],
): {
  readonly components: number;
  readonly pending: readonly PendingAgent[];
  readonly bindings: readonly ScopedBinding[];
} => {
  const pending: PendingAgent[] = [];
  const bindings: ScopedBinding[] = [];
  let components = 0;

  for (const construction of preparedAgentConstructions(context)) {
    const { match, entries, definition, explicitName, declared, sourceName, identity } =
      construction;
    if (match.call.enclosingUnresolved === true && explicitName === undefined) {
      unresolved.push({
        kind: 'adapter_input',
        reason:
          'an agent inside a callable without an authoritative source name declares no distinct runtime name',
        location: match.call.location,
      });
      continue;
    }
    if (identity === undefined || !construction.identitySettled) {
      unresolved.push({
        kind: 'adapter_input',
        reason:
          'multiple agent constructions share one stable source binding without a distinct source identity',
        location: match.call.location,
      });
      continue;
    }
    const instructions = stringValue(findEntry(entries, 'instructions')?.value);
    const model = stringValue(findEntry(entries, 'model')?.value);
    const toolNames = identifierItems(findEntry(entries, 'tools')?.value);
    const handoffNames = identifierItems(findEntry(entries, 'handoffs')?.value);

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        identity,
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
        metadata: {
          framework: 'openai-agents',
          declaredName: declared,
          ...(sourceName === declared ? {} : { runtimeName: declared }),
        },
        tags: ['openai-agents'],
      }),
    );
    components += 1;
    if (definition !== undefined) {
      registerScopedBinding(context, bindings, {
        file: match.module.file,
        name: definition.name,
        identity,
        enclosing: definition.enclosing,
        enclosingLocation: definition.enclosingLocation,
        location: match.call.location,
      });
    }
    registerScopedBinding(context, bindings, {
      file: match.module.file,
      name: declared,
      identity,
      enclosing: definition?.enclosing ?? match.call.enclosing,
      enclosingLocation: definition?.enclosingLocation,
      location: match.call.location,
    });
    const supportingLocations = [
      ...promptCallSupport(match.module, match.call),
      ...(definition === undefined ? [] : [definition.location]),
    ];
    registerPromptEntries({
      registry: context.promptInputs,
      producer: ADAPTER_ID,
      module: match.module,
      call: match.call,
      consumer: identity,
      entries,
      channels: ['instructions'],
      supportingLocations,
    });
    const stableVariable =
      definition?.kind === 'variable' &&
      match.module.definitions.filter(
        (candidate) =>
          candidate.name === definition.name &&
          candidate.enclosing === definition.enclosing &&
          sameOptionalRange(candidate.enclosingLocation, definition.enclosingLocation),
      ).length === 1 &&
      !match.module.assignments.some(
        (assignment) =>
          assignment.target.length === 1 &&
          assignment.target[0] === definition.name &&
          assignment.enclosing === definition.enclosing &&
          sameOptionalRange(assignment.enclosingLocation, definition.enclosingLocation),
      );
    pending.push({
      identity,
      module: match.module,
      call: match.call,
      entries,
      variable: stableVariable ? definition.name : undefined,
      enclosing: definition?.enclosing ?? match.call.enclosing,
      enclosingLocation: definition?.enclosingLocation ?? match.call.enclosingLocation,
      supportingLocations,
    });

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
  return { components, pending, bindings };
};

/** Relations named by identifier, resolved through the bindings recorded while the agents were added. */
const addNamedRelations = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  agent: PendingAgent,
  bindings: readonly ScopedBinding[],
  unresolved: TopologyDiscovery['unresolved'][number][],
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
    const resolved = resolveScopedBinding(context, agent, name, bindings);
    const target = resolved.target;
    if (target === undefined && resolved.blocked) {
      unresolved.push({
        kind: 'explicit_relation',
        reason: `${named.label} names ${name}, but that binding is not settled in the agent's exact lexical scope`,
        location: agent.call.location,
      });
    }
    if (target === undefined) continue;
    if (
      named.label === 'handoffs' &&
      identityKey(target) === identityKey(agent.identity) &&
      name !== agent.variable
    ) {
      unresolved.push({
        kind: 'explicit_relation',
        reason: `handoffs names ${name}, but a distinct agent construction shares the source agent's graph identity`,
        location: agent.call.location,
      });
      continue;
    }
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
  bindings: readonly ScopedBinding[],
  unresolved: TopologyDiscovery['unresolved'][number][],
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

  edges += addNamedRelations(context, builder, agent, bindings, unresolved, {
    key: ['tools'],
    kind: (target) => (target.kind === 'mcp_server' ? 'provides_tool' : 'calls_tool'),
    label: 'tools',
  });
  edges += addNamedRelations(context, builder, agent, bindings, unresolved, {
    key: ['mcpServers', 'mcp_servers'],
    kind: () => 'provides_tool',
    reversed: true,
    label: 'mcpServers',
  });
  edges += addNamedRelations(context, builder, agent, bindings, unresolved, {
    key: ['handoffs'],
    kind: () => 'hands_off_to',
    label: 'handoffs',
  });
  /*
   * Read as two lists rather than one, because an agent may declare both and `addNamedRelations` takes the first key
   * that matches. What guards the input and what checks the output are different claims about the same agent.
   */
  edges += addNamedRelations(context, builder, agent, bindings, unresolved, {
    key: ['input_guardrails', 'inputGuardrails'],
    kind: () => 'validated_by',
    label: 'input_guardrails',
  });
  edges += addNamedRelations(context, builder, agent, bindings, unresolved, {
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

const addAssignedHandoffs = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  bindings: readonly ScopedBinding[],
  unresolved: TopologyDiscovery['unresolved'][number][],
): number => {
  let edges = 0;
  const draw = (
    module: ModuleFacts,
    holder: string,
    value: ArgumentFact | undefined,
    location: SourceLocation,
    symbol: string,
    enclosing: string | undefined,
    enclosingLocation: SourceLocation | undefined,
  ): void => {
    const source = bindingAtLocation(
      module,
      holder,
      bindings,
      enclosing,
      enclosingLocation,
      location,
    );
    const from = source.target;
    if (from === undefined || from.kind !== 'agent') {
      if (source.blocked) {
        unresolved.push({
          kind: 'explicit_relation',
          reason: `${symbol} names ${holder}, but that source agent binding is not settled in its exact lexical scope`,
          location,
        });
      }
      return;
    }
    for (const name of handoffTargets(value)) {
      const destination = bindingAtLocation(
        module,
        name,
        bindings,
        enclosing,
        enclosingLocation,
        location,
      );
      const to = destination.target;
      if (to === undefined || to.kind !== 'agent') {
        if (destination.blocked) {
          unresolved.push({
            kind: 'explicit_relation',
            reason: `${symbol} names ${name}, but that destination agent binding is not settled in its exact lexical scope`,
            location,
          });
        }
        continue;
      }
      if (identityKey(from) === identityKey(to) && holder !== name) {
        unresolved.push({
          kind: 'explicit_relation',
          reason: `${symbol} names ${name}, but a distinct agent construction shares ${holder}'s graph identity`,
          location,
        });
        continue;
      }
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
      draw(
        module,
        holder,
        assignment.value,
        assignment.location,
        'handoffs',
        assignment.enclosing,
        assignment.enclosingLocation,
      );
    }
    for (const call of module.calls) {
      const path = call.calleePath;
      const method = path[path.length - 1];
      if (method !== 'append' && method !== 'extend') continue;
      if (path[path.length - 2] !== HANDOFF_MEMBER) continue;
      const holder = path[path.length - 3];
      if (holder === undefined) continue;
      draw(
        module,
        holder,
        call.args[0],
        call.location,
        `handoffs.${method}`,
        call.enclosing,
        call.enclosingLocation,
      );
    }
  }
  return edges;
};

const registerAgents = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  unresolved: TopologyDiscovery['unresolved'][number][],
  resourceBindings: readonly ScopedBinding[],
): { components: number; edges: number; pending: readonly PendingAgent[] } => {
  const added = addAgents(context, builder, unresolved);
  const bindings = [...resourceBindings, ...added.bindings];
  let edges = 0;
  for (const agent of added.pending) {
    edges += addAgentRelations(context, builder, agent, bindings, unresolved);
  }
  // After the agents, because both ends of a handoff have to be registered before the relation can resolve.
  edges += addAssignedHandoffs(context, builder, added.bindings, unresolved);
  return { components: added.components, edges, pending: added.pending };
};

const runInputConsumer = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  agentName: string,
  agents: readonly PendingAgent[],
):
  | {
      readonly identity: ComponentIdentity;
      readonly supportingLocations: readonly SourceLocation[];
    }
  | undefined => {
  const lexicalEnclosing = call.lexicalEnclosing ?? call.enclosing;
  for (const scope of [...(call.lexicalScopes ?? [])].reverse()) {
    const local = agents.filter(
      (agent) =>
        agent.module.file === module.file &&
        agent.variable === agentName &&
        agent.enclosingLocation !== undefined &&
        sameRange(agent.enclosingLocation, scope.location),
    );
    if (local.length === 1 && local[0] !== undefined) {
      return {
        identity: local[0].identity,
        supportingLocations: local[0].supportingLocations,
      };
    }
    if (local.length > 1 || scope.bindings.includes(agentName)) return undefined;
  }
  if ((call.lexicalScopes?.length ?? 0) === 0 && call.lexicalShadows?.includes(agentName)) {
    return undefined;
  }
  const namedLocal = agents.filter(
    (agent) =>
      agent.module.file === module.file &&
      agent.variable === agentName &&
      agent.enclosingLocation === undefined &&
      agent.enclosing === lexicalEnclosing,
  );
  if (namedLocal.length === 1 && namedLocal[0] !== undefined) {
    return {
      identity: namedLocal[0].identity,
      supportingLocations: namedLocal[0].supportingLocations,
    };
  }
  if (namedLocal.length > 1 || hasBindingAt(module, lexicalEnclosing, agentName, call.location)) {
    return undefined;
  }
  const consumer = context.bindings.lookup(module.file, agentName);
  if (consumer?.kind !== 'agent') return undefined;
  const matches = agents.filter((agent) => identityKey(agent.identity) === identityKey(consumer));
  if (matches.length !== 1) return undefined;
  const imported = module.imports.filter((entry) => entry.local === agentName && !entry.isType);
  return {
    identity: consumer,
    supportingLocations: [
      ...(matches[0]?.supportingLocations ?? []),
      ...(imported.length === 1 && imported[0] !== undefined ? [imported[0].location] : []),
    ],
  };
};

const registerRunInputs = (context: DiscoveryContext, agents: readonly PendingAgent[]): void => {
  for (const module of context.modules) {
    for (const call of module.calls) {
      const method = call.calleePath.at(-1);
      if (method !== 'run' && method !== 'run_sync') continue;
      const providerCall = matchRuntimeSymbol(
        context.modules,
        module,
        {
          path: call.calleePath,
          origin: call.origin,
          enclosing: call.enclosing,
          location: call.location,
        },
        { names: ['Runner', 'run', 'run_sync'], packages: PACKAGES },
      );
      if (providerCall === undefined) continue;
      const entries = objectArgument(call);
      const startingAgent = findEntry(entries, 'starting_agent');
      const agentValue =
        startingAgent?.value ?? (call.args[0]?.kind === 'object' ? undefined : call.args[0]);
      const agentName = agentValue?.kind === 'identifier' ? agentValue.name : undefined;
      const resolved =
        agentName === undefined
          ? undefined
          : runInputConsumer(context, module, call, agentName, agents);
      const prompt = findEntry(entries, 'input')?.value ?? call.args[1];
      if (resolved === undefined || prompt === undefined || prompt.kind === 'object') continue;
      context.promptInputs.register({
        producer: ADAPTER_ID,
        module,
        call,
        consumer: resolved.identity,
        channel: 'input',
        value: prompt,
        location: findEntry(entries, 'input')?.location ?? call.location,
        supportingLocations: [...promptCallSupport(module, call), ...resolved.supportingLocations],
      });
    }
  }
};

export const openAiAgentsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  packages: PACKAGES,
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const unresolved: TopologyDiscovery['unresolved'][number][] = [];
    recordUnsettledAgentChains(context, unresolved);
    const tools = registerTools(context, builder, unresolved);
    // Before the agents, because an agent's guardrail list is resolved through the bindings this registers.
    const guardrails = registerGuardrails(context, builder, unresolved);
    const servers = registerMcpServers(context, builder, unresolved);
    const agents = registerAgents(context, builder, unresolved, [
      ...tools.bindings,
      ...guardrails.bindings,
      ...servers.bindings,
    ]);
    registerRunInputs(context, agents.pending);
    const filesInspected = context.modules
      .filter((module) => module.imports.some((entry) => PACKAGES.includes(entry.module)))
      .map((module) => module.file);
    return {
      componentsFound:
        tools.components + guardrails.components + servers.components + agents.components,
      edgesFound: agents.edges,
      filesInspected,
      ...(unresolved.length === 0
        ? {}
        : {
            topology: {
              status: 'incomplete',
              inspectedInputs:
                tools.components +
                guardrails.components +
                servers.components +
                agents.components +
                unresolved.length,
              explicitRelations: agents.edges,
              conditionalConstructs: 0,
              conditionalDestinations: 0,
              entryBoundaries: 0,
              entryTargets: [],
              terminalBoundaries: 0,
              boundaryFacts: [],
              configurationBounds: 0,
              configurationBoundFacts: [],
              unresolvedCount: unresolved.length,
              unresolved,
            },
          }),
    };
  },
};
