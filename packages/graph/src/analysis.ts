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
 * Entry points of the declared system. A component is an entry point when it is declared as one, or
 * when it is an agent that no other agent hands off to and no group invokes.
 */
export const entryPoints = (index: IndexedGraph): readonly Component[] => {
  const declared = index.componentsOfKind('entrypoint');
  if (declared.length > 0) return declared;
  return index.componentsOfKind('agent').filter((agent) => {
    const inbound = index.incoming(agent.id);
    return !inbound.some(
      (edge) => edge.kind === 'hands_off_to' || (edge.kind === 'contains' && edge.from !== edge.to),
    );
  });
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
