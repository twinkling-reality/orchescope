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
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { definitionForCall, hasBindingAt, matchCalls, projectUses } from '../matching.ts';
import { addModelReference } from '../model-reference.ts';
import { promptCallSupport, registerPromptEntries } from '../prompt-input.ts';

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
  readonly file: string;
  readonly variable: string | undefined;
  readonly enclosing: string | undefined;
  readonly supportingLocations: readonly import('@orchescope/schema').SourceLocation[];
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
      channels: ['instructions', 'system_prompt'],
      supportingLocations,
    });

    const stableVariable =
      definition?.kind === 'variable' &&
      match.module.definitions.filter(
        (candidate) =>
          candidate.name === definition.name && candidate.enclosing === definition.enclosing,
      ).length === 1 &&
      !match.module.assignments.some(
        (assignment) => assignment.target.length === 1 && assignment.target[0] === definition.name,
      );
    agents.push({
      identity,
      file: match.module.file,
      variable: stableVariable ? definition.name : undefined,
      enclosing: definition?.enclosing,
      supportingLocations,
      retries: numberValue(findEntry(entries, 'retries')?.value),
    });

    const model = declaredModel(match.call, entries);
    if (model === undefined) continue;
    const added = addModelReference({
      drafts,
      builder,
      declared: model,
      file: match.module.file,
      location: match.call.location,
      framework: 'pydantic-ai',
      invokedBy: identity,
      confidence: match.confidence,
    });
    components += added.components;
    edges += added.edges;
  }
  return { components, edges, agents };
};

const runInputConsumer = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  receiver: string,
  agents: readonly DiscoveredAgent[],
):
  | {
      readonly identity: ComponentIdentity;
      readonly supportingLocations: readonly import('@orchescope/schema').SourceLocation[];
    }
  | undefined => {
  const local = agents.filter(
    (agent) =>
      agent.file === module.file &&
      agent.variable === receiver &&
      agent.enclosing === call.enclosing,
  );
  if (local.length === 1) {
    const agent = local[0];
    return agent === undefined
      ? undefined
      : { identity: agent.identity, supportingLocations: agent.supportingLocations };
  }
  if (local.length > 1 || hasBindingAt(module, call.enclosing, receiver, call.location)) {
    return undefined;
  }
  const consumer = context.bindings.lookup(module.file, receiver);
  if (consumer?.kind !== 'agent') return undefined;
  const matches = agents.filter((agent) => identityKey(agent.identity) === identityKey(consumer));
  if (matches.length !== 1) return undefined;
  const imported = module.imports.filter((entry) => entry.local === receiver && !entry.isType);
  return {
    identity: consumer,
    supportingLocations: [
      ...(matches[0]?.supportingLocations ?? []),
      ...(imported.length === 1 && imported[0] !== undefined ? [imported[0].location] : []),
    ],
  };
};

const registerRunInputs = (context: DiscoveryContext, agents: readonly DiscoveredAgent[]): void => {
  for (const module of context.modules) {
    for (const call of module.calls) {
      const method = call.calleePath.at(-1);
      if (!['run', 'run_sync', 'run_stream'].includes(method ?? '')) continue;
      const receiver = call.calleePath[0];
      if (receiver === undefined) continue;
      const resolved = runInputConsumer(context, module, call, receiver, agents);
      if (resolved === undefined) continue;
      const entries = keywordEntries(call);
      const prompt = findEntry(entries, 'user_prompt')?.value ?? call.args[0];
      if (prompt === undefined || prompt.kind === 'object') continue;
      context.promptInputs.register({
        producer: ADAPTER_ID,
        module,
        call,
        consumer: resolved.identity,
        channel: 'user_prompt',
        value: prompt,
        location: findEntry(entries, 'user_prompt')?.location ?? call.location,
        supportingLocations: [...resolved.supportingLocations, call.location],
      });
    }
  }
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

const addDecoratedTool = (input: {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly module: ModuleFacts;
  readonly definition: DefinitionFact;
  readonly method: string;
  readonly owner: string;
  readonly agent: DiscoveredAgent;
}): void => {
  const { context, builder, module, definition, method, owner, agent } = input;
  const entries = decoratorEntries(definition, method);
  const name = stringValue(findEntry(entries, 'name')?.value) ?? definition.name;
  const identity = sourceIdentity('tool', module.file, name);
  const requiresApproval = booleanValue(findEntry(entries, 'requires_approval')?.value);
  const attempts = numberValue(findEntry(entries, 'retries')?.value) ?? agent.retries;

  builder.addComponent(
    drafts.sourceComponent({
      kind: 'tool',
      file: module.file,
      name,
      location: definition.location,
      symbol: `@${owner}.${method} ${definition.name}`,
      confidence: CONFIDENCE_BANDS.deterministic,
      details: {
        for: 'tool',
        ...(requiresApproval === undefined ? {} : { approvalRequired: requiresApproval }),
      },
      metadata: { framework: 'pydantic-ai', declaredName: name, registeredOn: owner },
      tags: ['pydantic-ai'],
    }),
  );
  context.bindings.register(module.file, definition.name, identity);
  context.bindings.register(module.file, name, identity);
  context.implementations.record({
    identity,
    file: module.file,
    body: definition.location,
    symbol: `@${owner}.${method} ${definition.name}`,
  });

  const policy = retryPolicy(attempts);
  builder.addEdge(
    drafts.edge({
      kind: 'calls_tool',
      from: agent.identity,
      to: identity,
      location: definition.location,
      symbol: `@${owner}.${method} ${name}`,
      ...(policy === undefined ? {} : { policy }),
    }),
  );
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

  for (const module of context.modules) {
    for (const definition of module.definitions) {
      for (const decorator of definition.decorators) {
        const method = decorator.path[decorator.path.length - 1];
        const owner = decorator.path[0];
        if (method === undefined || !TOOL_DECORATORS.includes(method)) continue;
        if (owner === undefined || decorator.path.length < 2) continue;
        const agent = agents.find(
          (candidate) =>
            candidate.file === module.file &&
            candidate.variable === owner &&
            candidate.enclosing === definition.enclosing,
        );
        if (agent === undefined) continue;

        addDecoratedTool({ context, builder, module, definition, method, owner, agent });
        components += 1;
        edges += 1;
        break;
      }
    }
  }
  return { components, edges };
};

export const pydanticAiAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  packages: PACKAGES,
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const agents = addAgents(context, builder);
    const tools = addTools(context, builder, agents.agents);
    registerRunInputs(context, agents.agents);
    const filesInspected = context.modules
      .filter((module) => module.imports.some((entry) => PACKAGES.includes(entry.module)))
      .map((module) => module.file);
    return {
      componentsFound: agents.components + tools.components,
      edgesFound: agents.edges + tools.edges,
      filesInspected,
    };
  },
};
