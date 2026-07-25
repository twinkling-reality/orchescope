import { CONFIDENCE_BANDS, identityKey } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, EdgePolicy } from '@orchescope/schema';
import type {
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import { booleanValue, findEntry, numberValue, stringValue } from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { decoratedDefinitions, definitionForCall, matchCalls, projectUses } from '../matching.ts';

/**
 * Pydantic AI.
 *
 * Three things make this framework readable without running it. The model is the first positional argument in
 * the form `provider:model`, so a provider and a model are named rather than inferred. A tool is registered by a
 * decorator on the agent object, `@support_agent.tool`, so the relation between the two is written down rather
 * than reconstructed. And an agent with no `name` is named after the variable it is assigned to, because that is
 * what the library itself does: `name` is documented as inferred from the call frame when it is absent, and that
 * inferred name is the one that reaches a span, so reconciliation matches on it.
 *
 * A tool's `retries` is a real retry: a `ModelRetry` sends the call back to the model, which can invoke the tool
 * again. It is recorded as bounded with an unknown backoff and unknown idempotency, because the ceiling is
 * declared and the other two are not.
 */

const PACKAGES = ['pydantic-ai', 'pydantic_ai', 'pydantic-ai-slim', 'pydantic_ai_slim'];
const ADAPTER_ID = 'adapter:pydantic-ai';
const drafts = createDrafts(ADAPTER_ID);

const TOOL_DECORATORS = ['tool', 'tool_plain'];

const providerIdentity = (provider: string): ComponentIdentity =>
  globalIdentity('provider', GLOBAL_NAMESPACES.provider, provider);

const modelIdentity = (name: string): ComponentIdentity =>
  globalIdentity('model', GLOBAL_NAMESPACES.model, name);

/** `openai:gpt-4.1-mini` names both halves. A value without the separator names only a model. */
const splitModel = (
  value: string,
): { readonly provider: string | undefined; readonly model: string } => {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    return { provider: undefined, model: value };
  }
  return { provider: value.slice(0, separator), model: value.slice(separator + 1) };
};

/**
 * The keyword arguments of a call.
 *
 * Python keyword arguments arrive as one object argument appended after the positional ones, so the last object
 * argument is the keywords whether or not the model was passed positionally.
 */
const keywordEntries = (call: CallFact): readonly ObjectEntryFact[] => {
  for (let index = call.args.length - 1; index >= 0; index -= 1) {
    const argument = call.args[index];
    if (argument !== undefined && argument.kind === 'object') return argument.entries;
  }
  return [];
};

type DiscoveredAgent = {
  readonly identity: ComponentIdentity;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  /** Retries the agent declares, which a tool inherits when it declares none of its own. */
  readonly retries: number | undefined;
};

const instructionsOf = (entries: readonly ObjectEntryFact[]): string | undefined =>
  stringValue(findEntry(entries, 'instructions')?.value) ??
  stringValue(findEntry(entries, 'system_prompt')?.value);

/** The declared output type, when it is something other than the default of plain text. */
const outputTypeOf = (entries: readonly ObjectEntryFact[]): string | undefined => {
  const value = findEntry(entries, 'output_type')?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'identifier') return value.name === 'str' ? undefined : value.name;
  if (value.kind === 'member') return value.path[value.path.length - 1];
  return undefined;
};

const retryPolicy = (attempts: number | undefined): EdgePolicy | undefined =>
  attempts === undefined
    ? undefined
    : {
        retry: {
          maxAttempts: attempts,
          bounded: true,
          // The library documents the ceiling and nothing else, so nothing else is claimed.
          backoff: 'unknown',
          idempotency: 'unknown',
        },
      };

const addModel = (
  builder: SystemGraphBuilder,
  agent: DiscoveredAgent,
  declared: string,
): { readonly components: number; readonly edges: number } => {
  const { provider, model } = splitModel(declared);
  const identity = modelIdentity(provider === undefined ? model : `${provider}/${model}`);

  builder.addComponent(
    drafts.sourceComponent({
      kind: 'model',
      identity,
      file: agent.module.file,
      name: provider === undefined ? model : `${provider}/${model}`,
      displayName: model,
      location: agent.call.location,
      symbol: `model: ${declared}`,
      details: {
        for: 'model',
        modelId: model,
        ...(provider === undefined ? {} : { provider }),
      },
      metadata: { framework: 'pydantic-ai' },
    }),
  );
  builder.addEdge(
    drafts.edge({
      kind: 'invokes_model',
      from: agent.identity,
      to: identity,
      location: agent.call.location,
      symbol: `model: ${declared}`,
    }),
  );
  if (provider === undefined) return { components: 1, edges: 1 };

  builder.addComponent(
    drafts.sourceComponent({
      kind: 'provider',
      identity: providerIdentity(provider),
      file: agent.module.file,
      name: provider,
      location: agent.call.location,
      symbol: `provider: ${provider}`,
      permissions: [{ kind: 'network', scope: provider, mode: 'write' }],
      metadata: { framework: 'pydantic-ai' },
    }),
  );
  builder.addEdge(
    drafts.edge({
      kind: 'served_by_provider',
      from: identity,
      to: providerIdentity(provider),
      location: agent.call.location,
      symbol: `model: ${declared}`,
    }),
  );
  return { components: 2, edges: 2 };
};

/** The model is the first positional argument or the `model` keyword. */
const declaredModel = (call: CallFact, entries: readonly ObjectEntryFact[]): string | undefined =>
  stringValue(call.args[0]) ?? stringValue(findEntry(entries, 'model')?.value);

const addAgents = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { readonly components: number; readonly edges: number; readonly agents: DiscoveredAgent[] } => {
  const agents: DiscoveredAgent[] = [];
  let components = 0;
  let edges = 0;

  for (const match of matchCalls(context.modules, { names: ['Agent'], packages: PACKAGES })) {
    const entries = keywordEntries(match.call);
    const definition = definitionForCall(match.module, match.call);
    const declaredName = stringValue(findEntry(entries, 'name')?.value);
    const name = declaredName ?? definition?.name;
    if (name === undefined) continue;

    const identity = sourceIdentity('agent', match.module.file, name);
    const instructions = instructionsOf(entries);
    const summary = stringValue(findEntry(entries, 'description')?.value) ?? instructions;
    const outputType = outputTypeOf(entries);

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        file: match.module.file,
        name,
        location: match.call.location,
        symbol: definition?.name ?? 'Agent',
        confidence: match.confidence,
        ...(summary === undefined ? {} : { description: summary.slice(0, 240) }),
        details: {
          for: 'agent',
          framework: 'pydantic-ai',
          // Nothing in this framework declares a hierarchy, so no role is claimed.
          role: 'unspecified',
          ...(instructions === undefined ? {} : { instructionsRef: `inline:${name}` }),
        },
        metadata: {
          framework: 'pydantic-ai',
          declaredName: name,
          // Recorded on the agent rather than on the model: a model is shared between agents, and it is this
          // agent that asked for a validated output.
          ...(outputType === undefined ? {} : { outputType }),
          ...(declaredName === undefined ? { nameInferredFromVariable: true } : {}),
        },
        tags: ['pydantic-ai'],
      }),
    );
    components += 1;
    if (definition !== undefined) {
      context.bindings.register(match.module.file, definition.name, identity);
    }
    context.bindings.register(match.module.file, name, identity);

    const agent: DiscoveredAgent = {
      identity,
      module: match.module,
      call: match.call,
      retries: numberValue(findEntry(entries, 'retries')?.value),
    };
    agents.push(agent);

    const model = declaredModel(match.call, entries);
    if (model === undefined) continue;
    const added = addModel(builder, agent, model);
    components += added.components;
    edges += added.edges;
  }
  return { components, edges, agents };
};

const decoratorEntries = (
  definition: DefinitionFact,
  method: string,
): readonly ObjectEntryFact[] => {
  const decorator = definition.decorators.find(
    (entry) => entry.path[entry.path.length - 1] === method,
  );
  const first = decorator?.args[0];
  return first !== undefined && first.kind === 'object' ? first.entries : [];
};

/**
 * Tools, each attributed to the agent its decorator names.
 *
 * A decorator whose path does not begin with an agent this adapter discovered is left alone. `tool` is too
 * common a name to claim on its own, and a tool attributed to nothing would be a component nobody can act on.
 */
const addTools = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  agents: readonly DiscoveredAgent[],
): { readonly components: number; readonly edges: number } => {
  let components = 0;
  let edges = 0;
  const byIdentity = new Map(agents.map((agent) => [identityKey(agent.identity), agent]));

  for (const decorated of decoratedDefinitions(context.modules, TOOL_DECORATORS, PACKAGES)) {
    for (const decorator of decorated.definition.decorators) {
      const method = decorator.path[decorator.path.length - 1];
      const owner = decorator.path[0];
      if (method === undefined || !TOOL_DECORATORS.includes(method)) continue;
      if (owner === undefined || decorator.path.length < 2) continue;
      const ownerIdentity = context.bindings.lookup(decorated.module.file, owner);
      if (ownerIdentity === undefined) continue;
      const agent = byIdentity.get(identityKey(ownerIdentity));
      if (agent === undefined) continue;

      const entries = decoratorEntries(decorated.definition, method);
      const name = stringValue(findEntry(entries, 'name')?.value) ?? decorated.definition.name;
      const identity = sourceIdentity('tool', decorated.module.file, name);
      const requiresApproval = booleanValue(findEntry(entries, 'requires_approval')?.value);
      const attempts = numberValue(findEntry(entries, 'retries')?.value) ?? agent.retries;

      builder.addComponent(
        drafts.sourceComponent({
          kind: 'tool',
          file: decorated.module.file,
          name,
          location: decorated.definition.location,
          symbol: `@${owner}.${method} ${decorated.definition.name}`,
          confidence: decorated.resolved
            ? CONFIDENCE_BANDS.deterministic
            : CONFIDENCE_BANDS.heuristic,
          details: {
            for: 'tool',
            ...(requiresApproval === undefined ? {} : { approvalRequired: requiresApproval }),
          },
          metadata: { framework: 'pydantic-ai', declaredName: name, registeredOn: owner },
          tags: ['pydantic-ai'],
        }),
      );
      components += 1;
      context.bindings.register(decorated.module.file, decorated.definition.name, identity);
      context.bindings.register(decorated.module.file, name, identity);

      const policy = retryPolicy(attempts);
      builder.addEdge(
        drafts.edge({
          kind: 'calls_tool',
          from: agent.identity,
          to: identity,
          location: decorated.definition.location,
          symbol: `@${owner}.${method} ${name}`,
          ...(policy === undefined ? {} : { policy }),
        }),
      );
      edges += 1;
      break;
    }
  }
  return { components, edges };
};

export const pydanticAiAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'python',
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const agents = addAgents(context, builder);
    const tools = addTools(context, builder, agents.agents);
    const filesInspected = context.modules.filter((module) =>
      module.imports.some((entry) => PACKAGES.includes(entry.module)),
    ).length;
    return {
      componentsFound: agents.components + tools.components,
      edgesFound: agents.edges + tools.edges,
      filesInspected,
    };
  },
};
