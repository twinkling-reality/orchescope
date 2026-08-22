import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';
import type {
  CallFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
  ReturnFact,
} from '@orchescope/source-analysis';
import {
  calleeName,
  dotted,
  findEntry,
  identifierItems,
  numberValue,
  stringValue,
} from '@orchescope/source-analysis';
import type {
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
  TopologyDiscovery,
} from '../adapter.ts';
import { createDrafts, sourceIdentity } from '../drafts.ts';
import { routesDeclaredInNodes } from '../graph-node-route.ts';
import {
  definitionForCall,
  importsAny,
  matchRuntimeSymbol,
  moduleMatches,
  projectUses,
} from '../matching.ts';
import { addModelReference } from '../model-reference.ts';

/**
 * LangGraph, in both ecosystems.
 *
 * A LangGraph topology is declared imperatively: nodes are added by name, then edges are added between
 * those names. The adapter reads the declared names rather than the runtime graph object, which is what
 * makes the discovery work without importing the user's code. Conditional edges are recorded with their
 * router. START and END are retained as entry and terminal boundary facts, not displayed as agents or
 * relations in the application topology.
 *
 * The two ecosystems name a node differently. `addNode("planner", planner)` states the name, and Python also
 * accepts `add_node(planner)`, where the library takes the function's own name. Both are read; nothing else is
 * treated as a name.
 *
 * A node also declares where it goes from inside itself, by returning a `Command` naming another node.
 * `graph-node-route.ts` reads that, and what it needs from here is which function implements which node,
 * because the relation runs between two node names and the call sites are inside the functions.
 */

const PACKAGES = [
  '@langchain/langgraph',
  'langgraph',
  '@langchain/core',
  'langgraph.graph',
  'langgraph.prebuilt',
];
const GRAPH_PACKAGES = ['@langchain/langgraph', 'langgraph', 'langgraph.graph'];
const GRAPH_CONSTRUCTORS = ['StateGraph', 'MessageGraph', 'Graph'];
const ADAPTER_ID = 'adapter:langgraph';
const drafts = createDrafts(ADAPTER_ID);

const NODE_METHODS = new Set(['addNode', 'add_node']);
const EDGE_METHODS = new Set(['addEdge', 'add_edge']);
const CONDITIONAL_METHODS = new Set(['addConditionalEdges', 'add_conditional_edges']);
const SENTINELS = new Set(['__start__', '__end__']);

const nodeIdentity = (file: string, name: string): ComponentIdentity =>
  sourceIdentity('agent', file, name);

const shadowsImportedRoot = (
  module: ModuleFacts,
  name: string,
  enclosing: string | undefined,
): boolean =>
  module.definitions.some(
    (definition) =>
      definition.name === name &&
      (definition.enclosing === undefined || definition.enclosing === enclosing),
  ) ||
  module.assignments.some(
    (assignment) => assignment.target.length === 1 && assignment.target[0] === name,
  );

const literalName = (
  module: ModuleFacts,
  value: unknown,
  enclosing: string | undefined,
): string | undefined => {
  const argument = value as { kind?: string } | undefined;
  if (argument === undefined) return undefined;
  if (argument.kind === 'string') return (argument as { value: string }).value;
  if (argument.kind === 'identifier') {
    const name = (argument as { name: string }).name;
    if (shadowsImportedRoot(module, name, enclosing)) return undefined;
    const imported = module.imports.find(
      (entry) => !entry.isType && entry.local === name && moduleMatches(entry.module, PACKAGES),
    )?.imported;
    return imported === 'START' ? '__start__' : imported === 'END' ? '__end__' : undefined;
  }
  if (argument.kind === 'member') {
    const path = (argument as { path: readonly string[] }).path;
    const root = path[0];
    const last = path[path.length - 1];
    if (root === undefined || shadowsImportedRoot(module, root, enclosing)) return undefined;
    const namespace = module.imports.find(
      (entry) => !entry.isType && entry.local === root && moduleMatches(entry.module, PACKAGES),
    );
    if (
      namespace === undefined ||
      (namespace.imported !== '*' && namespace.imported !== 'default')
    ) {
      return undefined;
    }
    return last === 'START' ? '__start__' : last === 'END' ? '__end__' : undefined;
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
  const declared = literalName(module, call.args[0], call.enclosing);
  if (declared !== undefined) return SENTINELS.has(declared) ? undefined : declared;
  if (module.language !== 'python' || method !== 'add_node') return undefined;
  const argument = call.args[0];
  const second = call.args[1];
  if (argument === undefined || (second !== undefined && second.kind !== 'object'))
    return undefined;
  if (argument.kind === 'identifier') {
    const localFunction = module.definitions.some(
      (definition) =>
        definition.kind === 'function' &&
        definition.enclosing === undefined &&
        definition.name === argument.name,
    );
    return localFunction && !SENTINELS.has(argument.name) ? argument.name : undefined;
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

const TOPOLOGY_SAMPLE_LIMIT = 10;

type TopologyAccumulator = {
  status: 'complete' | 'incomplete';
  inspectedInputs: number;
  explicitRelations: number;
  conditionalConstructs: number;
  conditionalDestinations: number;
  entryBoundaries: number;
  entryTargets: ComponentIdentity[];
  terminalBoundaries: number;
  boundaryFacts: TopologyDiscovery['boundaryFacts'][number][];
  configurationBounds: number;
  configurationBoundFacts: TopologyDiscovery['configurationBoundFacts'][number][];
  unresolvedCount: number;
  unresolved: TopologyDiscovery['unresolved'][number][];
};

const topologyAccumulator = (): TopologyAccumulator => ({
  status: 'complete',
  inspectedInputs: 0,
  explicitRelations: 0,
  conditionalConstructs: 0,
  conditionalDestinations: 0,
  entryBoundaries: 0,
  entryTargets: [],
  terminalBoundaries: 0,
  boundaryFacts: [],
  configurationBounds: 0,
  configurationBoundFacts: [],
  unresolvedCount: 0,
  unresolved: [],
});

const refuseTopology = (
  topology: TopologyAccumulator,
  refusal: TopologyDiscovery['unresolved'][number],
): void => {
  topology.status = 'incomplete';
  topology.unresolvedCount += 1;
  if (topology.unresolved.length < TOPOLOGY_SAMPLE_LIMIT) topology.unresolved.push(refusal);
};

const recordBoundary = (
  topology: TopologyAccumulator,
  kind: 'entry' | 'terminal',
  location: TopologyDiscovery['boundaryFacts'][number]['location'],
): void => {
  if (kind === 'entry') topology.entryBoundaries += 1;
  else topology.terminalBoundaries += 1;
  if (topology.boundaryFacts.length < TOPOLOGY_SAMPLE_LIMIT) {
    topology.boundaryFacts.push({ kind, location });
  }
};

const graphName = (file: string): string => `${file.split('/').pop() ?? 'graph'}-graph`;

type VerifiedGraph = {
  readonly call: CallFact;
  readonly receiver: string;
  readonly enclosing: string | undefined;
  readonly groupIdentity: ComponentIdentity;
};

const graphConstructorShape = (call: CallFact): boolean => {
  const origin = call.origin;
  if (origin === undefined) return GRAPH_CONSTRUCTORS.includes(calleeName(call));
  if (origin.imported === '*' || origin.imported === 'default') {
    return GRAPH_CONSTRUCTORS.includes(calleeName(call));
  }
  return call.calleePath.length === 1;
};

/** The graph object itself, which becomes the group the nodes belong to. */
const discoverGraphConstruction = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  topology: TopologyAccumulator,
): { readonly components: number; readonly graph: VerifiedGraph | undefined } => {
  const constructions: {
    readonly call: CallFact;
    readonly receiver: string;
    readonly enclosing: string | undefined;
  }[] = [];
  for (const call of module.calls) {
    if (!graphConstructorShape(call)) continue;
    const matched = matchRuntimeSymbol(
      context.modules,
      module,
      {
        path: call.calleePath,
        origin: call.origin,
        enclosing: call.enclosing,
      },
      { names: GRAPH_CONSTRUCTORS, packages: GRAPH_PACKAGES },
    );
    if (matched === undefined) {
      if (GRAPH_CONSTRUCTORS.includes(calleeName(call))) {
        refuseTopology(topology, {
          kind: 'adapter_input',
          reason: `${calleeName(call)} did not resolve to a LangGraph runtime provider.`,
          location: call.location,
        });
      }
      continue;
    }
    const definition = definitionForCall(module, call);
    if (definition === undefined || definition.kind !== 'variable') {
      refuseTopology(topology, {
        kind: 'adapter_input',
        reason: `${dotted(call.calleePath)} was not assigned to a locally verifiable graph receiver.`,
        location: call.location,
      });
      continue;
    }
    const definitions = module.definitions.filter(
      (candidate) =>
        candidate.name === definition.name && candidate.enclosing === definition.enclosing,
    );
    if (definitions.length !== 1) {
      refuseTopology(topology, {
        kind: 'adapter_input',
        reason: `${definition.name} has ${definitions.length} definitions in the graph construction scope, so its provider identity is not stable.`,
        location: call.location,
      });
      continue;
    }
    const reassigned = module.assignments.some(
      (assignment) => assignment.target.length === 1 && assignment.target[0] === definition.name,
    );
    if (reassigned) {
      refuseTopology(topology, {
        kind: 'adapter_input',
        reason: `${definition.name} is reassigned after construction, so its provider identity is not stable.`,
        location: call.location,
      });
      continue;
    }
    constructions.push({ call, receiver: definition.name, enclosing: definition.enclosing });
  }

  for (const construction of constructions) {
    const name =
      constructions.length === 1
        ? graphName(module.file)
        : `${graphName(module.file)}:${construction.receiver}`;
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'agent_group',
        file: module.file,
        name,
        displayName: dotted(construction.call.calleePath),
        location: construction.call.location,
        symbol: dotted(construction.call.calleePath),
        metadata: { framework: 'langgraph', receiver: construction.receiver },
        tags: ['langgraph'],
      }),
    );
  }
  if (constructions.length > 1) {
    refuseTopology(topology, {
      kind: 'adapter_input',
      reason:
        'Multiple LangGraph constructions in one module cannot be partitioned without graph-scoped node identities.',
      ...(constructions[0] === undefined ? {} : { location: constructions[0].call.location }),
    });
  }
  const only = constructions.length === 1 ? constructions[0] : undefined;
  return {
    components: constructions.length,
    graph:
      only === undefined
        ? undefined
        : {
            ...only,
            groupIdentity: sourceIdentity('agent_group', module.file, graphName(module.file)),
          },
  };
};

/**
 * The function a node registration names as the node's implementation.
 *
 * `add_node("supervisor", supervisor)` names it in the second argument, and Python's `add_node(supervisor)`
 * makes the function its own node name. Either way this is what lets a call inside that function be read as
 * a statement about the node, which is what the `Command` idiom needs. A compiled subgraph in that position
 * is recorded the same way and finds nothing, because no function of that name encloses anything.
 */
const recordImplementation = (
  call: ModuleFacts['calls'][number],
  name: string,
  implementations: Map<string, string>,
): void => {
  const implementation = call.args[1];
  if (implementation?.kind === 'identifier') implementations.set(implementation.name, name);
  else if (call.args[0]?.kind === 'identifier') implementations.set(name, name);
};

const discoverNodes = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  groupIdentity: ComponentIdentity | undefined,
  declaredNodes: Set<string>,
  implementations: Map<string, string>,
  topology: TopologyAccumulator,
  calls: readonly CallFact[],
): Counts => {
  let components = 0;
  let edges = 0;
  for (const call of calls) {
    const method = calleeName(call);
    if (!NODE_METHODS.has(method)) continue;
    const name = nodeNameFrom(module, call, method);
    if (name === undefined) {
      refuseTopology(topology, {
        kind: 'node_registration',
        reason: `${method} did not state a bounded literal node name.`,
        location: call.location,
      });
      continue;
    }
    declaredNodes.add(name);
    recordImplementation(call, name, implementations);
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
  topology: TopologyAccumulator,
): number => {
  const from = literalName(module, call.args[0], call.enclosing);
  const to = literalName(module, call.args[1], call.enclosing);
  if (from === undefined || to === undefined) {
    refuseTopology(topology, {
      kind: 'explicit_relation',
      reason: `${method} did not state two bounded literal endpoints.`,
      location: call.location,
    });
    return 0;
  }
  if (from === '__start__' && declaredNodes.has(to)) {
    recordBoundary(topology, 'entry', call.location);
    topology.entryTargets.push(nodeIdentity(module.file, to));
    return 0;
  }
  if (to === '__end__' && declaredNodes.has(from)) {
    recordBoundary(topology, 'terminal', call.location);
    return 0;
  }
  if (SENTINELS.has(from) || SENTINELS.has(to)) {
    refuseTopology(topology, {
      kind: from === '__start__' ? 'entry_boundary' : 'terminal_boundary',
      reason: `${method} used a boundary sentinel in an unsupported direction.`,
      location: call.location,
    });
    return 0;
  }
  if (!declaredNodes.has(from) || !declaredNodes.has(to)) {
    refuseTopology(topology, {
      kind: 'explicit_relation',
      reason: `${method} names an endpoint that is not a declared node in this module.`,
      location: call.location,
    });
    return 0;
  }
  builder.addEdge(
    drafts.edge({
      kind: 'hands_off_to',
      from: nodeIdentity(module.file, from),
      to: nodeIdentity(module.file, to),
      location: call.location,
      symbol: `${method}("${from}", "${to}")`,
    }),
  );
  topology.explicitRelations += 1;
  return 1;
};

type ConditionalDestination = {
  readonly to: string;
  readonly location: ModuleFacts['calls'][number]['location'];
  readonly branch?: string;
};

type ConfigurationBound = TopologyDiscovery['configurationBoundFacts'][number] & {
  readonly operator: string;
};

const moduleNameOf = (file: string): string =>
  file
    .replace(/^src\//, '')
    .replace(/\/__init__\.py$/, '')
    .replace(/\.py$/, '')
    .replaceAll('/', '.');

const moduleForImport = (
  context: DiscoveryContext,
  module: ModuleFacts,
  localName: string,
): { readonly module: ModuleFacts; readonly className: string } | undefined => {
  const resolved = context.symbols.resolve(module.file, localName);
  if (resolved !== undefined) {
    const target = context.symbols.moduleOf(resolved.file);
    if (target !== undefined) return { module: target, className: resolved.name };
  }
  const imported = module.imports.find((entry) => entry.local === localName);
  if (imported === undefined || imported.module.startsWith('.')) return undefined;
  const targets = context.modules.filter(
    (candidate) =>
      candidate.language === 'python' && moduleNameOf(candidate.file) === imported.module,
  );
  const target = targets.length === 1 ? targets[0] : undefined;
  return target === undefined ? undefined : { module: target, className: imported.imported };
};

const fieldDefault = (module: ModuleFacts, field: DefinitionFact): number | undefined => {
  const call = module.calls.find(
    (candidate) =>
      candidate.enclosing === field.enclosing &&
      candidate.location.startLine >= field.location.startLine &&
      candidate.location.startLine <= (field.location.endLine ?? field.location.startLine),
  );
  if (call === undefined) return undefined;
  const value =
    numberValue(call.args[0]) ?? numberValue(findEntry(keywordEntries(call), 'default')?.value);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
};

/**
 * A static configuration default joined to the exact branch reference that reads it.
 *
 * The result is deliberately only a default. It is not an observed value and does not turn a cycle into
 * an acyclic graph or establish how many times a caller will traverse it.
 */
const configurationBoundFor = (
  context: DiscoveryContext,
  module: ModuleFacts,
  router: DefinitionFact,
  returned: ReturnFact,
): {
  readonly candidate: boolean;
  readonly bound?: ConfigurationBound;
  readonly reason?: string;
} => {
  const predicate = returned.predicate;
  if (predicate === undefined || predicate.branch !== 'consequence') return { candidate: false };
  for (const reference of predicate.references) {
    const root = reference[0];
    const property = reference[reference.length - 1];
    if (root === undefined || property === undefined || reference.length < 2) continue;
    const binding = module.definitions.find(
      (definition) =>
        definition.kind === 'variable' &&
        definition.name === root &&
        definition.enclosing === router.name &&
        (definition.initializer?.length ?? 0) >= 2,
    );
    const classLocal = binding?.initializer?.[0];
    if (binding === undefined || classLocal === undefined) continue;
    const resolved = moduleForImport(context, module, classLocal);
    if (resolved === undefined) {
      return {
        candidate: true,
        reason: `The configuration class behind ${root}.${property} could not be resolved to one local module.`,
      };
    }
    const field = resolved.module.definitions.find(
      (definition) =>
        definition.kind === 'variable' &&
        definition.enclosing === resolved.className &&
        definition.name === property,
    );
    if (field === undefined) {
      return {
        candidate: true,
        reason: `The configuration field ${resolved.className}.${property} could not be resolved.`,
      };
    }
    const defaultValue = fieldDefault(resolved.module, field);
    if (defaultValue === undefined) {
      return {
        candidate: true,
        reason: `The configuration field ${resolved.className}.${property} has no deterministic integer default.`,
      };
    }
    return {
      candidate: true,
      bound: {
        name: property,
        defaultValue,
        reference: predicate.location,
        declaration: field.location,
        operator: predicate.operator,
      },
    };
  }
  return { candidate: false };
};

const explicitDestinationArgument = (call: CallFact) => {
  const argument = call.args[2];
  if (argument?.kind !== 'object') return argument;
  return (
    findEntry(argument.entries, 'path_map')?.value ??
    findEntry(argument.entries, 'pathMap')?.value ??
    argument
  );
};

const explicitDestinations = (
  module: ModuleFacts,
  call: CallFact,
  topology: TopologyAccumulator,
): readonly ConditionalDestination[] | undefined => {
  const argument = explicitDestinationArgument(call);
  if (argument === undefined) return undefined;
  if (argument.kind === 'object') {
    const destinations: ConditionalDestination[] = [];
    for (const entry of argument.entries) {
      const to = stringValue(entry.value) ?? literalName(module, entry.value, call.enclosing);
      if (to === undefined) {
        refuseTopology(topology, {
          kind: 'conditional_destination',
          reason: `Conditional branch ${entry.key} computes its destination dynamically.`,
          location: entry.location,
        });
      } else destinations.push({ to, location: entry.location, branch: entry.key });
    }
    return destinations;
  }
  if (argument.kind === 'array') {
    const destinations: ConditionalDestination[] = [];
    for (const item of argument.items) {
      const to = stringValue(item) ?? literalName(module, item, call.enclosing);
      if (to === undefined) {
        refuseTopology(topology, {
          kind: 'conditional_destination',
          reason: 'A conditional destination list contains a computed item.',
          location: call.location,
        });
      } else destinations.push({ to, location: call.location });
    }
    return destinations;
  }
  return [];
};

const namedRouterDestinations = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  topology: TopologyAccumulator,
): {
  readonly destinations: readonly ConditionalDestination[];
  readonly bounds: ReadonlyMap<string, ConfigurationBound>;
} => {
  const routerArgument = call.args[1];
  const routerName = routerArgument?.kind === 'identifier' ? routerArgument.name : undefined;
  const router = module.definitions.find(
    (definition) =>
      definition.kind === 'function' &&
      definition.name === routerName &&
      definition.enclosing === undefined,
  );
  if (routerName === undefined || router === undefined) {
    refuseTopology(topology, {
      kind: 'conditional_destination',
      reason: 'The conditional router is not a named local function with inspectable source facts.',
      location: call.location,
    });
    return { destinations: [], bounds: new Map() };
  }

  const annotation = router.returnAnnotation;
  const annotated = new Set(annotation?.destinations.map((destination) => destination.value) ?? []);
  const literalReturns = new Set<string>();
  const destinations: ConditionalDestination[] = [];
  const bounds = new Map<string, ConfigurationBound>();
  for (const destination of annotation?.destinations ?? []) {
    destinations.push({ to: destination.value, location: destination.location });
  }
  for (const returned of router.returns ?? []) {
    const to = stringValue(returned.value);
    if (to === undefined) {
      refuseTopology(topology, {
        kind: 'conditional_destination',
        reason: `${router.name} contains a computed return destination.`,
        location: returned.location,
      });
      continue;
    }
    literalReturns.add(to);
    destinations.push({ to, location: returned.location });
    const resolvedBound = configurationBoundFor(context, module, router, returned);
    if (resolvedBound.bound !== undefined) {
      bounds.set(to, resolvedBound.bound);
    } else if (resolvedBound.candidate) {
      refuseTopology(topology, {
        kind: 'config_backed_bound',
        reason: resolvedBound.reason ?? 'The configuration-backed branch ceiling was unresolved.',
        location: returned.predicate?.location ?? returned.location,
      });
    }
  }
  if (annotation !== undefined && !annotation.complete) {
    refuseTopology(topology, {
      kind: 'conditional_destination',
      reason: `${router.name} has a return annotation that is not a bounded Literal of strings.`,
      location: annotation.location,
    });
  }
  if (annotation?.complete === true && literalReturns.size > 0) {
    const returned = [...literalReturns].sort();
    const declared = [...annotated].sort();
    if (returned.join('\u0000') !== declared.join('\u0000')) {
      refuseTopology(topology, {
        kind: 'conditional_destination',
        reason: `${router.name} has disagreeing Literal annotation and literal return destinations.`,
        location: annotation.location,
      });
    }
  }
  if (destinations.length === 0) {
    refuseTopology(topology, {
      kind: 'conditional_destination',
      reason: `${router.name} states no bounded literal destination.`,
      location: router.location,
    });
  }
  return { destinations, bounds };
};

const addConditionalRelation = (
  module: ModuleFacts,
  builder: SystemGraphBuilder,
  call: CallFact,
  method: string,
  from: string,
  destination: string,
  facts: readonly ConditionalDestination[],
  bound: ConfigurationBound | undefined,
): void => {
  const metadata = {
    conditional: true,
    ...(facts[0]?.branch === undefined ? {} : { branch: facts[0].branch }),
    ...(bound === undefined
      ? {}
      : {
          conditionalBoundName: bound.name,
          conditionalBoundDefault: bound.defaultValue,
          conditionalBoundOperator: bound.operator,
        }),
  };
  const locations = [call.location, ...facts.map((fact) => fact.location)];
  if (bound !== undefined) locations.push(bound.reference, bound.declaration);
  for (const location of locations) {
    builder.addEdge(
      drafts.edge({
        kind: 'hands_off_to',
        from: nodeIdentity(module.file, from),
        to: nodeIdentity(module.file, destination),
        location,
        symbol: `${method}("${from}") branch "${destination}"`,
        metadata,
      }),
    );
  }
};

/** A conditional edge records every bounded destination or a source-located refusal. */
const addConditionalEdges = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  call: ModuleFacts['calls'][number],
  method: string,
  declaredNodes: ReadonlySet<string>,
  topology: TopologyAccumulator,
): number => {
  topology.conditionalConstructs += 1;
  const from = literalName(module, call.args[0], call.enclosing);
  if (from === undefined || !declaredNodes.has(from)) {
    refuseTopology(topology, {
      kind: 'conditional_destination',
      reason: `${method} does not name a declared literal source node.`,
      location: call.location,
    });
    return 0;
  }
  const explicit = explicitDestinations(module, call, topology);
  if (explicit !== undefined && explicit.length === 0) {
    refuseTopology(topology, {
      kind: 'conditional_destination',
      reason: `${method} received a destination map or list containing no bounded literal destination.`,
      location: call.location,
    });
    return 0;
  }
  const resolved =
    explicit === undefined
      ? namedRouterDestinations(context, module, call, topology)
      : { destinations: explicit, bounds: new Map<string, ConfigurationBound>() };
  const byDestination = new Map<string, ConditionalDestination[]>();
  for (const destination of resolved.destinations) {
    const entries = byDestination.get(destination.to) ?? [];
    entries.push(destination);
    byDestination.set(destination.to, entries);
  }
  let edges = 0;
  for (const [target, facts] of [...byDestination.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (target === '__end__') {
      topology.conditionalDestinations += 1;
      recordBoundary(topology, 'terminal', facts[0]?.location ?? call.location);
      continue;
    }
    if (SENTINELS.has(target) || !declaredNodes.has(target)) {
      refuseTopology(topology, {
        kind: 'conditional_destination',
        reason: `${method} names destination ${target}, which is not a declared node in this module.`,
        location: facts[0]?.location ?? call.location,
      });
      continue;
    }
    const bound = resolved.bounds.get(target);
    addConditionalRelation(module, builder, call, method, from, target, facts, bound);
    if (bound !== undefined) {
      topology.configurationBounds += 1;
      if (topology.configurationBoundFacts.length < TOPOLOGY_SAMPLE_LIMIT) {
        const { operator: _operator, ...fact } = bound;
        topology.configurationBoundFacts.push(fact);
      }
    }
    topology.conditionalDestinations += 1;
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
    const matched = matchRuntimeSymbol(
      context.modules,
      module,
      {
        path: call.calleePath,
        origin: call.origin,
        enclosing: call.enclosing,
      },
      { names: ['create_react_agent'], packages: GRAPH_PACKAGES },
    );
    if (matched === undefined) continue;
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
  topology: TopologyAccumulator,
): Counts => {
  const topologyInputs = module.calls.filter((call) => {
    const name = calleeName(call);
    return (
      GRAPH_CONSTRUCTORS.includes(name) ||
      NODE_METHODS.has(name) ||
      EDGE_METHODS.has(name) ||
      CONDITIONAL_METHODS.has(name) ||
      name === 'Command'
    );
  });
  topology.inspectedInputs += topologyInputs.length;
  if (module.parseErrors.length > 0) {
    const frameworkImport = module.imports.find((entry) => moduleMatches(entry.module, PACKAGES));
    refuseTopology(topology, {
      kind: 'adapter_input',
      reason:
        'This LangGraph module contains a syntax error, so its topology population is partial.',
      ...(frameworkImport === undefined ? {} : { location: frameworkImport.location }),
    });
  }
  const entryBoundariesBefore = topology.entryBoundaries;
  const declaredNodes = new Set<string>();
  const implementations = new Map<string, string>();
  const construction = discoverGraphConstruction(module, context, builder, topology);
  const graphMethods = module.calls.filter((call) => {
    const method = calleeName(call);
    return NODE_METHODS.has(method) || EDGE_METHODS.has(method) || CONDITIONAL_METHODS.has(method);
  });
  const verifiedMethods: CallFact[] = [];
  for (const call of graphMethods) {
    const receiver = call.calleePath.slice(0, -1).join('.');
    const chainedFromConstruction =
      construction.graph !== undefined &&
      definitionForCall(module, call)?.name === construction.graph.receiver &&
      matchRuntimeSymbol(
        context.modules,
        module,
        {
          path: call.calleePath,
          origin: call.origin,
          enclosing: call.enclosing,
        },
        { names: GRAPH_CONSTRUCTORS, packages: GRAPH_PACKAGES },
      ) !== undefined;
    if (
      construction.graph !== undefined &&
      call.enclosing === construction.graph.enclosing &&
      (receiver === construction.graph.receiver || chainedFromConstruction)
    ) {
      verifiedMethods.push(call);
      continue;
    }
    refuseTopology(topology, {
      kind: 'adapter_input',
      reason: `${receiver || 'An unbound receiver'}.${calleeName(call)} was not a locally verified LangGraph graph receiver.`,
      location: call.location,
    });
  }
  const nodes = discoverNodes(
    module,
    context,
    builder,
    construction.graph?.groupIdentity,
    declaredNodes,
    implementations,
    topology,
    verifiedMethods,
  );

  let edges = nodes.edges;
  for (const call of verifiedMethods) {
    const method = calleeName(call);
    if (EDGE_METHODS.has(method)) {
      edges += addDirectEdge(module, builder, call, method, declaredNodes, topology);
    } else if (CONDITIONAL_METHODS.has(method)) {
      edges += addConditionalEdges(module, context, builder, call, method, declaredNodes, topology);
    }
  }
  const nodeRoutes = routesDeclaredInNodes(module, implementations, declaredNodes);
  topology.conditionalConstructs +=
    nodeRoutes.routes.length + nodeRoutes.boundaries.length + nodeRoutes.unresolved.length;
  for (const route of nodeRoutes.routes) {
    builder.addEdge(
      drafts.edge({
        kind: 'hands_off_to',
        from: nodeIdentity(module.file, route.from),
        to: nodeIdentity(module.file, route.to),
        location: route.location,
        symbol: route.symbol,
        metadata: { conditional: true },
      }),
    );
    topology.conditionalDestinations += 1;
    edges += 1;
  }
  for (const boundary of nodeRoutes.boundaries) {
    topology.conditionalDestinations += 1;
    recordBoundary(topology, boundary.kind, boundary.location);
  }
  for (const unresolved of nodeRoutes.unresolved) {
    refuseTopology(topology, {
      kind: 'conditional_destination',
      reason: unresolved.reason,
      location: unresolved.location,
    });
  }

  if (topologyInputs.length === 0) {
    const frameworkImport = module.imports.find((entry) => moduleMatches(entry.module, PACKAGES));
    refuseTopology(topology, {
      kind: 'adapter_input',
      reason: 'This module imports LangGraph but contains no supported topology construct.',
      ...(frameworkImport === undefined ? {} : { location: frameworkImport.location }),
    });
  } else if (construction.components > 0 && topology.entryBoundaries === entryBoundariesBefore) {
    const graphCall = construction.graph?.call;
    refuseTopology(topology, {
      kind: 'entry_boundary',
      reason: 'No supported entry boundary was found for this LangGraph construction.',
      ...(graphCall === undefined ? {} : { location: graphCall.location }),
    });
  }

  const react = discoverReactAgents(module, context, builder);

  return {
    components: construction.components + nodes.components + react.components,
    edges: edges + react.edges,
  };
};

export const langGraphAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '3',
  packages: PACKAGES,
  appliesTo: (context) => projectUses(context, PACKAGES),
  discover: (context, builder): AdapterFindings => {
    let components = 0;
    let edges = 0;
    const topology = topologyAccumulator();
    const inspected: string[] = [];
    for (const module of context.modules) {
      if (!importsAny(module, PACKAGES)) continue;
      inspected.push(module.file);
      const result = discoverModule(module, context, builder, topology);
      components += result.components;
      edges += result.edges;
    }
    if (topology.inspectedInputs === 0 && topology.unresolvedCount === 0) {
      refuseTopology(topology, {
        kind: 'adapter_input',
        reason: 'The LangGraph adapter was applicable but inspected no supported topology input.',
      });
    }
    return {
      componentsFound: components,
      edgesFound: edges,
      filesInspected: [...inspected],
      topology,
    };
  },
};
