/**
 * The relations that shape a drawing of the system, and the adjacency each layout reads them through.
 *
 * This is shared rather than duplicated because it decides something a reader can see: which components
 * the map draws at all. Every layout has to position exactly the same set, or switching layout would
 * change the census beside the canvas, and "150 of 987 components are on the map" would mean something
 * different depending on a control the sentence does not mention.
 *
 * Containment is excluded. It does not shape the reading order of a diagram: a module containing an
 * agent says where the source lives, not what calls what. The consequence is stated where the census is,
 * because a component joined to the system only by containment is undrawn while the table shows it with
 * relations.
 */

import type { SystemGraph } from '@orchescope/schema';

/** Edge kinds that shape the reading order of the diagram. Containment does not. */
export const LAYOUT_EDGE_KINDS = new Set([
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
  'provides_tool',
  'served_by_provider',
  'falls_back_to',
  'guarded_by',
  'performs_side_effect',
  'uses_prompt',
]);

export const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortBuckets = (
  buckets: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, readonly string[]> => {
  const ordered = new Map<string, readonly string[]>();
  for (const [id, members] of buckets) {
    ordered.set(id, [...members].sort(compareIds));
  }
  return ordered;
};

const add = (buckets: Map<string, Set<string>>, key: string, value: string): void => {
  const bucket = buckets.get(key);
  if (bucket === undefined) buckets.set(key, new Set([value]));
  else bucket.add(value);
};

/** An edge that shapes the drawing: a known kind, two known endpoints, and not a self relation. */
const shaping = (graph: SystemGraph): readonly (readonly [string, string])[] => {
  const known = new Set(graph.components.map((component) => component.id));
  const pairs: (readonly [string, string])[] = [];
  for (const edge of graph.edges) {
    if (!LAYOUT_EDGE_KINDS.has(edge.kind)) continue;
    if (edge.from === edge.to) continue;
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    pairs.push([edge.from, edge.to]);
  }
  return pairs;
};

/**
 * Adjacency with the arrows discarded, which is what a ring reads: a leaf hanging off a hub belongs
 * beside it whichever way the arrow points.
 */
export const buildAdjacency = (graph: SystemGraph): ReadonlyMap<string, readonly string[]> => {
  const adjacency = new Map<string, Set<string>>();
  for (const [from, to] of shaping(graph)) {
    add(adjacency, from, to);
    add(adjacency, to, from);
  }
  return sortBuckets(adjacency);
};

export interface DirectedRelations {
  readonly out: ReadonlyMap<string, readonly string[]>;
  readonly incoming: ReadonlyMap<string, readonly string[]>;
  /** Every component a shaping relation touches, sorted, which is the set every layout positions. */
  readonly nodes: readonly string[];
}

/** Adjacency with the arrows kept, which is what a directional layout reads. */
export const buildDirected = (graph: SystemGraph): DirectedRelations => {
  const out = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const [from, to] of shaping(graph)) {
    add(out, from, to);
    add(incoming, to, from);
  }
  const nodes = new Set([...out.keys(), ...incoming.keys()]);
  return {
    out: sortBuckets(out),
    incoming: sortBuckets(incoming),
    nodes: [...nodes].sort(compareIds),
  };
};

/**
 * Target distance between two neighbours, in layout units. Shared by every layout so that the room a
 * name has does not depend on which one is showing.
 *
 * A name is drawn to the right of the node it belongs to and is about 90 units wide at the sizes this
 * workspace uses, so a pitch under that guarantees that neighbours overwrite each other.
 */
export const PITCH = 130;
