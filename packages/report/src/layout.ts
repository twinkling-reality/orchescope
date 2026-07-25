import dagre from '@dagrejs/dagre';
import type { SystemGraph } from '@orchescope/schema';

/**
 * Deterministic layered layout.
 *
 * Layout runs here, in the process that builds the report, and the positions are stored in the bundle. That
 * keeps a layout engine out of the browser and, more importantly, keeps the layout stable: the same graph
 * produces the same coordinates on every machine, so a report opened twice does not rearrange itself and a
 * screenshot from a pull request still matches.
 *
 * `@dagrejs/dagre` was chosen over `elkjs` on two grounds recorded in the research: it is MIT rather than
 * EPL-2.0 or GPL, and it produced identical coordinates across repeated runs in the measurement.
 */

export type Position = { readonly x: number; readonly y: number };

export type LayoutResult = {
  readonly positions: ReadonlyMap<string, Position>;
  readonly width: number;
  readonly height: number;
  /** True when the graph was too large to lay out and a deterministic fallback was used instead. */
  readonly fallback: boolean;
};

const NODE_WIDTH = 176;
const NODE_HEIGHT = 48;

/** Above this node count the layered layout is skipped in favour of a deterministic grid. */
const MAX_LAYERED_NODES = 4000;

/** Edge kinds that shape the reading order of the diagram. Containment does not. */
const LAYOUT_EDGE_KINDS = new Set([
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
  'provides_tool',
  'served_by_provider',
  'falls_back_to',
  'guarded_by',
  'performs_side_effect',
  'uses_prompt',
]);

const deterministicGrid = (graph: SystemGraph): LayoutResult => {
  const positions = new Map<string, Position>();
  const perRow = Math.max(1, Math.ceil(Math.sqrt(graph.components.length)));
  const ordered = [...graph.components].sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const [index, component] of ordered.entries()) {
    positions.set(component.id, {
      x: (index % perRow) * (NODE_WIDTH + 40),
      y: Math.floor(index / perRow) * (NODE_HEIGHT + 40),
    });
  }
  return {
    positions,
    width: perRow * (NODE_WIDTH + 40),
    height: Math.ceil(ordered.length / perRow) * (NODE_HEIGHT + 40),
    fallback: true,
  };
};

export const layoutGraph = (graph: SystemGraph): LayoutResult => {
  if (graph.components.length === 0) {
    return { positions: new Map(), width: 0, height: 0, fallback: false };
  }
  if (graph.components.length > MAX_LAYERED_NODES) return deterministicGrid(graph);

  const layout = new dagre.graphlib.Graph({ directed: true, multigraph: false, compound: false });
  layout.setGraph({ rankdir: 'LR', nodesep: 56, ranksep: 128, marginx: 32, marginy: 32 });
  layout.setDefaultEdgeLabel(() => ({}));

  // Nodes and edges are added in identifier order so the layout cannot depend on map iteration order.
  const components = [...graph.components].sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const component of components) {
    layout.setNode(component.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const edges = [...graph.edges]
    .filter((edge) => LAYOUT_EDGE_KINDS.has(edge.kind) && edge.from !== edge.to)
    .sort((left, right) => (left.id < right.id ? -1 : 1));
  for (const edge of edges) {
    if (!layout.hasNode(edge.from) || !layout.hasNode(edge.to)) continue;
    if (layout.hasEdge(edge.from, edge.to)) continue;
    layout.setEdge(edge.from, edge.to);
  }

  dagre.layout(layout);

  const positions = new Map<string, Position>();
  for (const id of layout.nodes()) {
    const node = layout.node(id) as { x?: number; y?: number } | undefined;
    if (node?.x === undefined || node.y === undefined) continue;
    positions.set(id, { x: Math.round(node.x), y: Math.round(node.y) });
  }
  const size = layout.graph() as { width?: number; height?: number };
  return {
    positions,
    width: Math.round(size.width ?? 0),
    height: Math.round(size.height ?? 0),
    fallback: false,
  };
};
