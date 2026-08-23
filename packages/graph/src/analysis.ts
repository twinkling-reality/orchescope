import { identityKey, isInferredEntryPoint, partOfDeclaredTopology } from '@orchescope/domain';
import type { Component, ComponentId, Edge, EdgeKind, TopologyCoverage } from '@orchescope/schema';
import type { IndexedGraph } from './indexed-graph.ts';

/**
 * Structural analysis over the system graph.
 *
 * These functions answer the questions findings are built from: which components nothing points at,
 * which parts of a declared system can never be reached, where the coordination fan out sits, and
 * whether the declared control flow contains a cycle.
 */

/** Edge kinds that represent control flow rather than containment or metadata. */
const CONTROL_FLOW_KINDS: ReadonlySet<EdgeKind> = new Set([
  'invokes_model',
  'calls_tool',
  'hands_off_to',
  'transitions_to',
  'queries_retrieval',
  'reads_memory',
  'writes_memory',
  'publishes_to_queue',
  'consumes_from_queue',
  'calls_service',
  'queries_database',
  'performs_side_effect',
]);

export const isControlFlowKind = (kind: EdgeKind): boolean => CONTROL_FLOW_KINDS.has(kind);

/**
 * A relation this analysis follows: declared, and control flow rather than containment or metadata.
 *
 * Every question in this module is about the shape the repository declares, so a relation only a run
 * produced is not one of them. Following one made the answer depend on whether the project had been
 * traced, which is how a tracing library's own span came to be the root that reached an application's
 * whole agent graph.
 */
const isDeclaredControlFlow = (edge: Edge): boolean =>
  partOfDeclaredTopology(edge) && isControlFlowKind(edge.kind);

export type DegreeStats = {
  readonly componentId: ComponentId;
  readonly controlFlowOutDegree: number;
};

export const degrees = (index: IndexedGraph): readonly DegreeStats[] =>
  index.graph.components.map((component) => ({
    componentId: component.id,
    controlFlowOutDegree: index.outgoing(component.id).filter(isDeclaredControlFlow).length,
  }));

/**
 * A candidate nothing points at, which is the ordinary way into a system.
 *
 * A frame discovery invented is one whether or not something calls it, which is the exception. It was never a
 * root because nothing pointed at it: it is a function, and a function that one caller in this repository
 * happens to reach is still a way into the module that exports it. Testing it by inbound relations would mean
 * that joining a tool to the handler it runs, which is new information and strictly more of it, demoted the
 * frames holding that repository's writes and reported more of the system as unreachable than before the join
 * existed. A graph does not become less connected by gaining a relation.
 */
const nothingPointsAt = (index: IndexedGraph, candidate: Component): boolean =>
  isInferredEntryPoint(candidate) ||
  !index
    .incoming(candidate.id)
    .some(
      (edge) =>
        edge.from !== candidate.id &&
        partOfDeclaredTopology(edge) &&
        (isControlFlowKind(edge.kind) || edge.kind === 'contains'),
    );

/**
 * Entry points of the declared system.
 *
 * A component is an entry point when nothing points at it: no control flow relation and no containment. Declared
 * entry points, groups and agents are all candidates, because a repository may have an explicit entry point, an
 * orchestrator nobody calls, or both.
 *
 * **A cycle has no member with an inbound relation to spare, so a fully cyclic set of agents yields no root at
 * all.** The answer to that used to be a fallback over the whole graph: with no root anywhere, every candidate
 * became one. It fired on whether the repository had a root somewhere rather than on whether this part of it
 * did, so the pinned customer service demonstration, whose six agents hand off to one another and back,
 * reported seventeen of its twenty two participating components unreachable because three Flask routes no
 * adapter joins to the agent graph were roots. Deleting those three routes would have reported nothing
 * unreachable. An answer about one agent that turns on an unrelated HTTP handler is not an answer.
 *
 * What replaces it is promotion: a candidate no root reaches is itself a way in, because nothing reachable
 * reaches it, so it becomes a root and the traversal runs again. One at a time and in candidate order, because
 * promoting a set together would call the second member of a chain an entry point when the first one reaches
 * it. The loop is bounded by the candidate count, which it removes one from on every pass.
 *
 * This does mean an agent is never reported unreachable, and that is the honest reading rather than a
 * weakening: an agent nothing points at was already a root, and an agent inside a cycle nothing points into is
 * the only way into that cycle. What the unreachable half still reports is a component of a kind that cannot
 * be a root, which is the true finding on that demonstration: `baggage_tool` is defined in its tools module
 * and named in no agent's tool list.
 */
export const entryPoints = (index: IndexedGraph): readonly Component[] => {
  const candidates = [
    ...index.componentsOfKind('entrypoint'),
    ...index.componentsOfKind('workflow'),
    ...index.componentsOfKind('agent_group'),
    ...index.componentsOfKind('agent'),
  ];
  if (candidates.length === 0) return [];
  const roots = candidates.filter((candidate) => nothingPointsAt(index, candidate));
  for (let pass = 0; pass < candidates.length; pass += 1) {
    const reached = reachableFrom(
      index,
      roots.map((root) => root.id),
      partOfDeclaredTopology,
    );
    const unreached = candidates.find((candidate) => !reached.has(candidate.id));
    if (unreached === undefined) break;
    roots.push(unreached);
  }
  return roots;
};

/**
 * Everything reachable from a set of roots, following the relations `follow` accepts.
 *
 * The predicate is the caller's, because two questions traverse this graph and they want different
 * populations. A question about the declared shape follows declared relations only. A question about
 * what model driven control can reach follows everything, because a relation a run produced is evidence
 * that control did reach, and dropping it would make a safety rule quieter than the evidence.
 */
export const reachableFrom = (
  index: IndexedGraph,
  roots: readonly ComponentId[],
  follow: (edge: Edge) => boolean = () => true,
): ReadonlySet<ComponentId> => {
  const seen = new Set<ComponentId>();
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const edge of index.outgoing(current)) {
      if (!seen.has(edge.to) && follow(edge)) stack.push(edge.to);
    }
  }
  return seen;
};

/**
 * The classified operations a component performs, read through the frames discovery invented.
 *
 * An effect is attributed to the function that performs it, and when that function produced no
 * component of its own discovery mints an entry point to hold it. Asking `edge.to` for its effect class
 * therefore asks the frame, which nobody ever classified, and gets `undefined`: not "this is safe" but
 * "nobody looked". A rule reading that as an answer stops one hop short of the write.
 *
 * A frame is transparent here and a declared component is not. Seeing through a frame is not reaching
 * further into the system, it is finishing the sentence discovery started: `namedPost` is the name of a
 * line of code, and the POST it performs is the operation. A tool or an agent is a boundary its author
 * declared, so traversal stops there and the caller is left to refuse rather than to reach past it.
 *
 * The first classified component along each path wins, because that is the operation the relation
 * describes. Frames are revisited at most once, since a function that retries by calling itself is a
 * cycle in this projection and is one of the shapes this exists to read.
 */
export const operationsPerformedBy = (
  index: IndexedGraph,
  componentId: ComponentId,
): readonly Component[] => {
  const operations: Component[] = [];
  const seen = new Set<ComponentId>();
  const stack: ComponentId[] = [componentId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const component = index.component(current);
    if (component === undefined) continue;
    if (component.sideEffect !== undefined) {
      operations.push(component);
      continue;
    }
    if (!isInferredEntryPoint(component)) continue;
    for (const edge of index.outgoing(current)) {
      if (isControlFlowKind(edge.kind)) stack.push(edge.to);
    }
  }
  return operations;
};

/**
 * The declared components that reach this operation.
 *
 * The mirror of `operationsPerformedBy` and it obeys the same rule about what is transparent: a frame
 * discovery invented to hold an effect is walked through, and a component the repository declared is an
 * answer. A rule asking who can reach a write wants the tool or the agent that decides to, not the name
 * of the function the write happens to sit inside.
 *
 * A rule that asks this is usually asking whether every route to an operation is guarded, so an empty
 * answer means nothing declared reaches it rather than that everything does. The caller decides what to
 * make of that; this reports what the graph says.
 */
export const declaredCallersOf = (
  index: IndexedGraph,
  componentId: ComponentId,
): readonly Component[] => {
  const callers: Component[] = [];
  const seen = new Set<ComponentId>();
  const stack: ComponentId[] = [componentId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const edge of index.incoming(current)) {
      if (!isControlFlowKind(edge.kind)) continue;
      const caller = index.component(edge.from);
      if (caller === undefined) continue;
      if (isInferredEntryPoint(caller)) stack.push(caller.id);
      else callers.push(caller);
    }
  }
  return callers;
};

/**
 * Components that no declared entry point can reach. A configured tool nobody can call is a real
 * finding, so this returns the components rather than a count.
 */
export const unreachableComponents = (
  index: IndexedGraph,
  accountedEntryTargets?: readonly ComponentId[],
): readonly Component[] => {
  const roots = accountedEntryTargets ?? entryPoints(index).map((component) => component.id);
  if (roots.length === 0) return [];
  const reachable = reachableFrom(index, roots, partOfDeclaredTopology);
  return index.graph.components.filter((component) => !reachable.has(component.id));
};

/** Cycles in the control flow projection, each reported as the component sequence that closes it. */
export const controlFlowCycles = (index: IndexedGraph): readonly (readonly ComponentId[])[] => {
  const cycles: ComponentId[][] = [];
  const state = new Map<ComponentId, 'visiting' | 'done'>();
  const path: ComponentId[] = [];

  const visit = (id: ComponentId): void => {
    const current = state.get(id);
    if (current === 'done') return;
    if (current === 'visiting') {
      const start = path.indexOf(id);
      if (start >= 0) cycles.push([...path.slice(start), id]);
      return;
    }
    state.set(id, 'visiting');
    path.push(id);
    for (const edge of index.outgoing(id)) {
      if (isDeclaredControlFlow(edge)) visit(edge.to);
    }
    path.pop();
    state.set(id, 'done');
  };

  for (const component of index.graph.components) visit(component.id);
  return cycles;
};

/** The concrete declared relations whose adjacency establishes one reported cycle. */
export const controlFlowCycleEdges = (
  index: IndexedGraph,
  cycle: readonly ComponentId[],
): readonly Edge[] => {
  const edges: Edge[] = [];
  for (let position = 0; position + 1 < cycle.length; position += 1) {
    const from = cycle[position];
    const to = cycle[position + 1];
    if (from === undefined || to === undefined) continue;
    const edge = index
      .outgoing(from)
      .find((candidate) => candidate.to === to && isDeclaredControlFlow(candidate));
    if (edge !== undefined) edges.push(edge);
  }
  return edges;
};

export type TopologyRequirements = {
  readonly status: 'complete' | 'incomplete' | 'unknown';
  readonly inspectedInputs: number;
  readonly acyclicityComplete: boolean;
  readonly reachabilityComplete: boolean;
  readonly narrownessComplete: boolean;
  readonly entryComponentIds: readonly ComponentId[];
};

/** Whether every topology refusal is explicitly bounded to prompt-use rather than control flow. */
export const controlFlowTopologyComplete = (topology: TopologyCoverage): boolean => {
  const sampledPromptRefusals = topology.unresolved.filter(
    (entry) => entry.scope === 'prompt_use',
  ).length;
  const sampledControlRefusals = topology.unresolved.length - sampledPromptRefusals;
  const hasScopedCounts =
    topology.controlFlowUnresolvedCount !== undefined ||
    topology.promptUseUnresolvedCount !== undefined;
  if (hasScopedCounts) {
    return (
      topology.controlFlowUnresolvedCount !== undefined &&
      topology.promptUseUnresolvedCount !== undefined &&
      topology.controlFlowUnresolvedCount + topology.promptUseUnresolvedCount ===
        topology.unresolvedCount &&
      sampledControlRefusals <= topology.controlFlowUnresolvedCount &&
      sampledPromptRefusals <= topology.promptUseUnresolvedCount &&
      topology.controlFlowUnresolvedCount === 0
    );
  }
  if (topology.status === 'complete') return topology.unresolvedCount === 0;
  return (
    topology.unresolvedCount > 0 &&
    topology.unresolved.length === topology.unresolvedCount &&
    topology.unresolved.every((entry) => entry.scope === 'prompt_use')
  );
};

/**
 * Whether the evidence population can support closed-world topology properties.
 *
 * Imported graphs are untrusted documents, so the derived answer checks the counts and every producer
 * rather than trusting a lone `status: complete` scalar. A missing optional field is the version 1
 * compatibility case and means unknown.
 */
export const topologyRequirements = (index: IndexedGraph): TopologyRequirements => {
  const topology = index.graph.coverage.topology;
  if (topology === undefined) {
    return {
      status: 'unknown',
      inspectedInputs: 0,
      acyclicityComplete: false,
      reachabilityComplete: false,
      narrownessComplete: false,
      entryComponentIds: [],
    };
  }
  const scanPopulationComplete =
    !index.graph.coverage.truncated &&
    (index.graph.coverage.filesSkipped ?? index.graph.coverage.skipped.length) === 0 &&
    (index.graph.coverage.filesInSupportedLanguages === undefined ||
      index.graph.coverage.filesParsed >= index.graph.coverage.filesInSupportedLanguages) &&
    index.graph.coverage.unsupported.every(
      (area) => area.kind === 'topology_incomplete' && area.scope === 'prompt_use',
    );
  const controlProducers = topology.producers.filter(
    (producer) => producer.scope === undefined || producer.scope === 'control_flow',
  );
  const inspectedInputs = controlProducers.reduce(
    (total, producer) => total + producer.inspectedInputs,
    0,
  );
  const complete =
    scanPopulationComplete &&
    controlFlowTopologyComplete(topology) &&
    inspectedInputs > 0 &&
    controlProducers.length > 0 &&
    controlProducers.every(
      (producer) => producer.status === 'complete' && producer.inspectedInputs > 0,
    );
  const targets = new Set(topology.entryTargets.map(identityKey));
  const entryComponentIds = index.graph.components
    .filter((component) => targets.has(identityKey(component.identity)))
    .map((component) => component.id);
  const entryTargetsComplete =
    topology.entryBoundaries > 0 &&
    topology.entryTargets.length > 0 &&
    entryComponentIds.length === topology.entryTargets.length;
  return {
    status: controlProducers.length === 0 ? 'unknown' : complete ? 'complete' : 'incomplete',
    inspectedInputs,
    acyclicityComplete: complete,
    reachabilityComplete: complete && entryTargetsComplete,
    narrownessComplete: complete,
    entryComponentIds,
  };
};

/** Components declared but never observed, restricted to kinds that can appear in a trace. */
const OBSERVABLE_KINDS = new Set([
  'agent',
  'workflow',
  'workflow_step',
  'model',
  'tool',
  'mcp_server',
  'memory',
  'retrieval',
  'queue',
  'database',
  'external_service',
  'approval_boundary',
  'side_effect',
  'evaluator',
]);

export const isObservableKind = (kind: string): boolean => OBSERVABLE_KINDS.has(kind);
