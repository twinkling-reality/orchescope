import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';
import type { CallFact, ModuleFacts, ObjectEntryFact } from '@orchescope/source-analysis';
import {
  calleeName,
  dotted,
  findEntry,
  identifierItems,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { definitionForCall, importsAny, projectUses } from '../matching.ts';
import { addModelReference } from '../model-reference.ts';

/**
 * LangGraph, in both ecosystems.
 *
 * A LangGraph topology is declared imperatively: nodes are added by name, then edges are added between
 * those names. The adapter reads the declared names rather than the runtime graph object, which is what
 * makes the discovery work without importing the user's code. Conditional edges are recorded with their
 * router, and the sentinel names START and END are modelled as entry points rather than as agents.
 *
 * The two ecosystems name a node differently. `addNode("planner", planner)` states the name, and Python also
 * accepts `add_node(planner)`, where the library takes the function's own name. Both are read; nothing else is
 * treated as a name.
 */

const PACKAGES = [
  '@langchain/langgraph',
  'langgraph',
  '@langchain/core',
  'langgraph.graph',
  'langgraph.prebuilt',
];
const ADAPTER_ID = 'adapter:langgraph';
const drafts = createDrafts(ADAPTER_ID);

const NODE_METHODS = new Set(['addNode', 'add_node']);
const EDGE_METHODS = new Set(['addEdge', 'add_edge']);
const CONDITIONAL_METHODS = new Set(['addConditionalEdges', 'add_conditional_edges']);
const SENTINELS = new Set(['START', 'END', '__start__', '__end__']);

const nodeIdentity = (file: string, name: string): ComponentIdentity =>
  sourceIdentity('agent', file, name);

const literalName = (value: unknown): string | undefined => {
  const argument = value as { kind?: string } | undefined;
  if (argument === undefined) return undefined;
  if (argument.kind === 'string') return (argument as { value: string }).value;
  if (argument.kind === 'identifier') {
    const name = (argument as { name: string }).name;
    return SENTINELS.has(name) ? name : undefined;
  }
  if (argument.kind === 'member') {
    const path = (argument as { path: readonly string[] }).path;
    const last = path[path.length - 1];
    return last !== undefined && SENTINELS.has(last) ? last : undefined;
  }
  return undefined;
};

/**
 * The name a node registration declares.
 *
 * Python accepts `add_node(fn)` and documents that the node takes the name of the function or runnable, so an
 * identifier in that position is a node name rather than an unknown. That form is Python's: the JavaScript API
 * names a node explicitly, and reading an identifier as a name there would be a guess, so this only applies to
 * the snake case method in a Python module.
 */
const nodeNameFrom = (
  module: ModuleFacts,
  call: ModuleFacts['calls'][number],
  method: string,
): string | undefined => {
  const declared = literalName(call.args[0]);
  if (declared !== undefined) return declared;
  if (module.language !== 'python' || method !== 'add_node') return undefined;
  const argument = call.args[0];
  if (argument === undefined) return undefined;
  if (argument.kind === 'identifier') {
    return SENTINELS.has(argument.name) ? undefined : argument.name;
  }
  if (argument.kind === 'member') {
    const last = argument.path[argument.path.length - 1];
    return last === undefined || SENTINELS.has(last) ? undefined : last;
  }
  return undefined;
};

/** Python keyword arguments arrive as one object argument appended after the positional ones. */
const keywordEntries = (call: CallFact): readonly ObjectEntryFact[] => {
  for (let index = call.args.length - 1; index >= 0; index -= 1) {
    const argument = call.args[index];
    if (argument !== undefined && argument.kind === 'object') return argument.entries;
  }
  return [];
};

type Counts = { components: number; edges: number };

const graphName = (file: string): string => `${file.split('/').pop() ?? 'graph'}-graph`;

/** The graph object itself, which becomes the group the nodes belong to. */
const discoverGraphConstruction = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
): { readonly components: number; readonly groupIdentity: ComponentIdentity | undefined } => {
  const constructions = module.calls.filter((call) =>
    ['StateGraph', 'MessageGraph', 'Graph'].includes(calleeName(call)),
  );
  for (const call of constructions) {
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent_group',
        file: module.file,
        name: graphName(module.file),
        displayName: dotted(call.calleePath),
        location: call.location,
        symbol: dotted(call.calleePath),
        metadata: { framework: 'langgraph' },
        tags: ['langgraph'],
      }),
    );
  }
  return {
    components: constructions.length,
    groupIdentity:
      constructions.length > 0
        ? sourceIdentity('agent_group', module.file, graphName(module.file))
        : undefined,
  };
};

const discoverNodes = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  groupIdentity: ComponentIdentity | undefined,
  declaredNodes: Set<string>,
): Counts => {
  let components = 0;
  let edges = 0;
  for (const call of module.calls) {
    const method = calleeName(call);
    if (!NODE_METHODS.has(method)) continue;
    const name = nodeNameFrom(module, call, method);
    if (name === undefined) continue;
    declaredNodes.add(name);
    const identity = nodeIdentity(module.file, name);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        file: module.file,
        name,
        location: call.location,
        symbol: `${method}("${name}")`,
        details: { for: 'agent', framework: 'langgraph', role: 'worker' },
        metadata: { framework: 'langgraph', declaredName: name },
        tags: ['langgraph'],
      }),
    );
    components += 1;
    context.bindings.register(module.file, name, identity);
    if (groupIdentity !== undefined) {
      builder.addEdge(
        drafts.edge({
          kind: 'contains',
          from: groupIdentity,
          to: identity,
          location: call.location,
          symbol: `${method}("${name}")`,
        }),
      );
      edges += 1;
    }
  }
  return { components, edges };
};

const addDirectEdge = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  call: ModuleFacts['calls'][number],
  method: string,
  declaredNodes: ReadonlySet<string>,
): number => {
  const from = literalName(call.args[0]);
  const to = literalName(call.args[1]);
  if (from === undefined || to === undefined) return 0;
  if (SENTINELS.has(from) || SENTINELS.has(to)) return 0;
  if (!declaredNodes.has(from) || !declaredNodes.has(to)) return 0;
  builder.addEdge(
    drafts.edge({
      kind: 'hands_off_to',
      from: nodeIdentity(module.file, from),
      to: nodeIdentity(module.file, to),
      location: call.location,
      symbol: `${method}("${from}", "${to}")`,
    }),
  );
  return 1;
};

/** A conditional edge names its destinations in a mapping, and each one is a relation the graph can take. */
const addConditionalEdges = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  call: ModuleFacts['calls'][number],
  method: string,
  declaredNodes: ReadonlySet<string>,
): number => {
  const from = literalName(call.args[0]);
  if (from === undefined || !declaredNodes.has(from)) return 0;
  const mapping = call.args[2] ?? call.args[1];
  if (mapping === undefined || mapping.kind !== 'object') return 0;
  let edges = 0;
  for (const entry of mapping.entries) {
    const target = stringValue(entry.value);
    if (target === undefined || !declaredNodes.has(target)) continue;
    builder.addEdge(
      drafts.edge({
        kind: 'hands_off_to',
        from: nodeIdentity(module.file, from),
        to: nodeIdentity(module.file, target),
        location: entry.location,
        symbol: `${method} branch "${entry.key}"`,
        metadata: { conditional: true, branch: entry.key },
      }),
    );
    edges += 1;
  }
  return edges;
};

/**
 * The prebuilt ReAct agent, which is one call rather than a graph.
 *
 * `create_react_agent("anthropic:claude-3-7-sonnet-latest", tools=[check_weather])` is how the library's own
 * example writes an agent, and it declares three things at once: the agent, the model reference with its
 * provider, and the tools. A function named in that list is a tool by construction, so it is recorded even
 * though nothing else in the repository marks it as one, at its definition rather than at the call.
 *
 * Only the Python spelling is read. The JavaScript helper takes a different shape, and reading it the same way
 * would be a guess rather than a fact.
 */
const discoverReactAgents = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): Counts => {
  let components = 0;
  let edges = 0;
  if (module.language !== 'python') return { components, edges };

  for (const call of module.calls) {
    if (calleeName(call) !== 'create_react_agent') continue;
    const entries = keywordEntries(call);
    const definition = definitionForCall(module, call);
    const name = stringValue(findEntry(entries, 'name')?.value) ?? definition?.name;
    if (name === undefined) continue;

    const identity = sourceIdentity('agent', module.file, name);
    const prompt = stringValue(findEntry(entries, 'prompt')?.value);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent',
        file: module.file,
        name,
        location: call.location,
        symbol: 'create_react_agent',
        ...(prompt === undefined ? {} : { description: prompt.slice(0, 240) }),
        details: {
          for: 'agent',
          framework: 'langgraph',
          role: 'worker',
          ...(prompt === undefined ? {} : { instructionsRef: `inline:${name}` }),
        },
        metadata: { framework: 'langgraph', declaredName: name, prebuilt: 'react' },
        tags: ['langgraph'],
      }),
    );
    components += 1;
    context.bindings.register(module.file, name, identity);
    if (definition !== undefined) context.bindings.register(module.file, definition.name, identity);

    const model = stringValue(call.args[0]) ?? stringValue(findEntry(entries, 'model')?.value);
    if (model !== undefined) {
      const added = addModelReference({
        drafts,
        builder,
        declared: model,
        file: module.file,
        location: call.location,
        framework: 'langgraph',
        invokedBy: identity,
      });
      components += added.components;
      edges += added.edges;
    }

    for (const toolName of identifierItems(findEntry(entries, 'tools')?.value)) {
      const existing = context.bindings.lookup(module.file, toolName);
      let toolIdentity = existing;
      if (existing === undefined) {
        const declaration = module.definitions.find(
          (candidate) => candidate.name === toolName && candidate.kind === 'function',
        );
        toolIdentity = sourceIdentity('tool', module.file, toolName);
        builder.addComponent(
          drafts.sourceComponent({
            kind: 'tool',
            file: module.file,
            name: toolName,
            location: declaration?.location ?? call.location,
            symbol: `tools: ${toolName}`,
            details: { for: 'tool' },
            metadata: { framework: 'langgraph', declaredName: toolName },
            tags: ['langgraph'],
          }),
        );
        components += 1;
        context.bindings.register(module.file, toolName, toolIdentity);
        /*
         * Only where the tool is a function this module defines. The fallback location is the agent
         * construction call, which names the tool and is not what runs when it is invoked.
         */
        if (declaration !== undefined) {
          context.implementations.record({
            identity: toolIdentity,
            file: module.file,
            body: declaration.location,
            symbol: `tools: ${toolName}`,
          });
        }
      }
      if (toolIdentity === undefined) continue;
      builder.addEdge(
        drafts.edge({
          kind: 'calls_tool',
          from: identity,
          to: toolIdentity,
          location: call.location,
          symbol: `tools: ${toolName}`,
        }),
      );
      edges += 1;
    }
  }
  return { components, edges };
};

const discoverModule = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): Counts => {
  const declaredNodes = new Set<string>();
  const construction = discoverGraphConstruction(module, builder);
  const nodes = discoverNodes(module, context, builder, construction.groupIdentity, declaredNodes);

  let edges = nodes.edges;
  for (const call of module.calls) {
    const method = calleeName(call);
    if (EDGE_METHODS.has(method)) {
      edges += addDirectEdge(module, builder, call, method, declaredNodes);
    } else if (CONDITIONAL_METHODS.has(method)) {
      edges += addConditionalEdges(module, builder, call, method, declaredNodes);
    }
  }

  const react = discoverReactAgents(module, context, builder);

  return {
    components: construction.components + nodes.components + react.components,
    edges: edges + react.edges,
  };
};

export const langGraphAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'javascript',
  packages: PACKAGES,
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    let components = 0;
    let edges = 0;
    let filesInspected = 0;
    for (const module of context.modules) {
      if (!importsAny(module, PACKAGES)) continue;
      filesInspected += 1;
      const result = discoverModule(module, context, builder);
      components += result.components;
      edges += result.edges;
    }
    return { componentsFound: components, edgesFound: edges, filesInspected };
  },
};
