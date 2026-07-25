import { identityKey } from '@orchescope/domain';
import type {
  Component,
  ComponentId,
  ComponentKind,
  Edge,
  EdgeId,
  EdgeKind,
  SystemGraph,
} from '@orchescope/schema';

/**
 * A read model over a system graph.
 *
 * Every consumer that asks structural questions goes through this index instead of scanning arrays,
 * so the cost of a question is predictable and the answers cannot drift between callers.
 */
export type IndexedGraph = {
  readonly graph: SystemGraph;
  readonly component: (id: ComponentId) => Component | undefined;
  readonly edge: (id: EdgeId) => Edge | undefined;
  readonly componentsOfKind: (kind: ComponentKind) => readonly Component[];
  readonly outgoing: (id: ComponentId) => readonly Edge[];
  readonly incoming: (id: ComponentId) => readonly Edge[];
  readonly edgesOfKind: (kind: EdgeKind) => readonly Edge[];
  readonly byIdentity: (identity: Component['identity']) => Component | undefined;
  readonly componentCount: number;
  readonly edgeCount: number;
};

export const indexGraph = (graph: SystemGraph): IndexedGraph => {
  const components = new Map<string, Component>();
  const identities = new Map<string, Component>();
  const byKind = new Map<ComponentKind, Component[]>();
  const edges = new Map<string, Edge>();
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  const edgeKinds = new Map<EdgeKind, Edge[]>();

  for (const component of graph.components) {
    components.set(component.id, component);
    identities.set(identityKey(component.identity), component);
    const bucket = byKind.get(component.kind);
    if (bucket === undefined) byKind.set(component.kind, [component]);
    else bucket.push(component);
  }
  for (const edge of graph.edges) {
    edges.set(edge.id, edge);
    const out = outgoing.get(edge.from);
    if (out === undefined) outgoing.set(edge.from, [edge]);
    else out.push(edge);
    const into = incoming.get(edge.to);
    if (into === undefined) incoming.set(edge.to, [edge]);
    else into.push(edge);
    const kindBucket = edgeKinds.get(edge.kind);
    if (kindBucket === undefined) edgeKinds.set(edge.kind, [edge]);
    else kindBucket.push(edge);
  }

  const empty: readonly Edge[] = [];
  const emptyComponents: readonly Component[] = [];

  return {
    graph,
    component: (id) => components.get(id),
    edge: (id) => edges.get(id),
    componentsOfKind: (kind) => byKind.get(kind) ?? emptyComponents,
    outgoing: (id) => outgoing.get(id) ?? empty,
    incoming: (id) => incoming.get(id) ?? empty,
    edgesOfKind: (kind) => edgeKinds.get(kind) ?? empty,
    byIdentity: (identity) => identities.get(identityKey(identity)),
    componentCount: graph.components.length,
    edgeCount: graph.edges.length,
  };
};
