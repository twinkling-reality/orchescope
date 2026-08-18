import { isInferredEntryPoint } from '@orchescope/domain';
import type { Component, ComponentId, EdgeKind } from '@orchescope/schema';
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

export type DegreeStats = {
  readonly componentId: ComponentId;
  readonly outDegree: number;
  readonly inDegree: number;
  readonly controlFlowOutDegree: number;
};

export const degrees = (index: IndexedGraph): readonly DegreeStats[] =>
  index.graph.components.map((component) => {
    const out = index.outgoing(component.id);
    return {
      componentId: component.id,
      outDegree: out.length,
      inDegree: index.incoming(component.id).length,
      controlFlowOutDegree: out.filter((edge) => isControlFlowKind(edge.kind)).length,
    };
  });

/**
 * Entry points of the declared system.
 *
 * A component is an entry point when nothing points at it: no control flow relation and no containment. Declared
 * entry points, groups and agents are all candidates, because a repository may have an explicit entry point, an
 * orchestrator nobody calls, or both. When every candidate has an inbound relation, which happens in a fully cyclic
 * topology, all candidates are treated as roots rather than reporting the whole system unreachable.
 *
 * A frame discovery invented is a root whether or not something calls it, which is the one exception. It was
 * never a root because nothing pointed at it: it is a function, and a function that one caller in this
 * repository happens to reach is still a way into the module that exports it. Testing it by inbound relations
 * would mean that joining a tool to the handler it runs, which is new information and strictly more of it,
 * demoted the frames holding that repository's writes and reported more of the system as unreachable than
 * before the join existed. A graph does not become less connected by gaining a relation.
 */
export const entryPoints = (index: IndexedGraph): readonly Component[] => {
  const candidates = [
    ...index.componentsOfKind('entrypoint'),
    ...index.componentsOfKind('agent_group'),
    ...index.componentsOfKind('agent'),
  ];
  if (candidates.length === 0) return [];
  const roots = candidates.filter(
    (candidate) =>
      isInferredEntryPoint(candidate) ||
      !index
        .incoming(candidate.id)
        .some(
          (edge) =>
            edge.from !== candidate.id &&
            (isControlFlowKind(edge.kind) || edge.kind === 'contains'),
        ),
  );
  return roots.length > 0 ? roots : candidates;
};

export const reachableFrom = (
  index: IndexedGraph,
  roots: readonly ComponentId[],
): ReadonlySet<ComponentId> => {
  const seen = new Set<ComponentId>();
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const edge of index.outgoing(current)) {
      if (!seen.has(edge.to)) stack.push(edge.to);
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
export const unreachableComponents = (index: IndexedGraph): readonly Component[] => {
  const roots = entryPoints(index).map((component) => component.id);
  if (roots.length === 0) return [];
  const reachable = reachableFrom(index, roots);
  return index.graph.components.filter(
    (component) => component.kind !== 'project' && !reachable.has(component.id),
  );
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
      if (isControlFlowKind(edge.kind)) visit(edge.to);
    }
    path.pop();
    state.set(id, 'done');
  };

  for (const component of index.graph.components) visit(component.id);
  return cycles;
};

/** Components declared but never observed, restricted to kinds that can appear in a trace. */
const OBSERVABLE_KINDS = new Set([
  'agent',
  'model',
  'tool',
  'mcp_server',
  'memory',
  'retrieval',
  'queue',
  'worker',
  'database',
  'external_service',
  'approval_boundary',
  'side_effect',
  'guardrail',
  'evaluator',
]);

export const isObservableKind = (kind: string): boolean => OBSERVABLE_KINDS.has(kind);
