import type { SystemGraph } from '@orchescope/schema';
import { buildAdjacency, compareIds, PITCH } from './layout-relations.ts';

/**
 * Deterministic concentric layout.
 *
 * Layout runs here, in the process that builds the report, and the positions are stored in the bundle. That
 * keeps a layout engine out of the browser and, more importantly, keeps the layout stable: the same graph
 * produces the same coordinates on every machine, so a report opened twice does not rearrange itself and a
 * screenshot from a pull request still matches.
 *
 * ## Why rings rather than ranks
 *
 * This used to be a layered layout from `@dagrejs/dagre`, and it was measured against the pinned corpus rather
 * than against the demonstration. Every agent system in the corpus is hub and spoke: median degree of a
 * connected component is one or two, and the busiest component has a degree of 18 in the demonstration, 24 in
 * `openai-agents-python` and 98 in `langgraphjs`. A layered layout puts every leaf of a hub in a single rank,
 * so the drawing grows linearly in one direction and not at all in the other:
 *
 * ```
 *                       connected   layered           concentric
 * demonstration              26     1152 x  1783        795 x  798
 * openai-agents-python      298      848 x 19050       2997 x 3000
 * langgraphjs               329     1456 x 20066       3199 x 3200
 * ```
 *
 * A ribbon of aspect 0.045 rendered into a canvas of aspect 2.3 is what a reader saw as a column of dots. On a
 * ring the tangential room grows with the radius, so a hub's leaves spread over an area rather than a line.
 *
 * Rings are filled to a capacity derived from a target pitch rather than one ring per hop, because one hop from
 * a degree 98 hub is 98 nodes and a single ring holding them has to be enormous. Filling by capacity keeps the
 * pitch roughly constant and the drawing roughly square at every size in the corpus.
 *
 * The rings are circles rather than ellipses, and that is deliberate rather than unconsidered. An ellipse matched
 * to a wide canvas carries about 18% more circumference for the same height, which is real, and it would be the
 * right answer if the canvas had one shape. It does not: these coordinates are computed once and rendered at
 * whatever size the reader's window is, roughly 1.5 wide on a desktop and 0.9 on a phone. An ellipse tuned for
 * one of those wastes room in the other, and 18% does not move the count of names that fit far enough to be
 * worth a layout that is only right at one width.
 *
 * ## Why only the connected components
 *
 * A component with no relation is not part of any topology and cannot be drawn as part of one. In
 * `openai-agents-python` 1091 of 1390 components have no relation at all, including 368 of its 370 prompts, and
 * laying them out put them all in rank zero and made the drawing 6.5 times taller. They are not positioned
 * here. The workspace counts them and names their kinds instead, which is a fact a reader can use, where an
 * anonymous circle is not.
 */

export type Position = { readonly x: number; readonly y: number };

export type LayoutResult = {
  readonly positions: ReadonlyMap<string, Position>;
  readonly width: number;
  readonly height: number;
  /** True when the graph was too large to lay out and a deterministic fallback was used instead. */
  readonly fallback: boolean;
};

/**
 * Distance between one ring and the next.
 *
 * Wider than the pitch on purpose. The centre node's own name runs outward across the first ring, so a
 * first ring closer than a name's width puts the busiest component's label on top of its neighbour, and
 * the busiest component is the one a reader looks for first.
 */
const RING_GAP = 200;

/** Above this count the ring layout is skipped in favour of a deterministic grid. */
const MAX_RINGED_NODES = 4000;

const GRID_CELL = 216;

/** How many nodes a ring at this radius carries before the next one opens. */
const ringCapacity = (ring: number): number =>
  Math.max(1, Math.floor((2 * Math.PI * ring * RING_GAP) / PITCH));

const deterministicGrid = (ids: readonly string[]): LayoutResult => {
  const positions = new Map<string, Position>();
  const perRow = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  for (const [index, id] of ids.entries()) {
    positions.set(id, {
      x: (index % perRow) * GRID_CELL,
      y: Math.floor(index / perRow) * GRID_CELL,
    });
  }
  return {
    positions,
    width: perRow * GRID_CELL,
    height: Math.ceil(ids.length / perRow) * GRID_CELL,
    fallback: true,
  };
};

/**
 * Breadth first from the busiest component, then the busiest of whatever is left, so a repository with several
 * unconnected subsystems draws each one outward from its own hub rather than interleaving them. Ties break on
 * the identifier, so the order cannot depend on map iteration.
 */
const visitOrder = (adjacency: ReadonlyMap<string, readonly string[]>): readonly string[] => {
  const roots = [...adjacency.keys()].sort((left, right) => {
    const byDegree = (adjacency.get(right)?.length ?? 0) - (adjacency.get(left)?.length ?? 0);
    return byDegree !== 0 ? byDegree : compareIds(left, right);
  });
  const seen = new Set<string>();
  const order: string[] = [];
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    order.push(root);
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      for (const neighbour of adjacency.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        order.push(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return order;
};

export const layoutGraph = (graph: SystemGraph): LayoutResult => {
  if (graph.components.length === 0) {
    return { positions: new Map(), width: 0, height: 0, fallback: false };
  }

  const adjacency = buildAdjacency(graph);
  const order = visitOrder(adjacency);
  if (order.length === 0) {
    // Every component is isolated, so there is no topology to draw and nothing to position.
    return { positions: new Map(), width: 0, height: 0, fallback: false };
  }
  if (order.length > MAX_RINGED_NODES) return deterministicGrid(order);

  const positions = new Map<string, Position>();
  const [centre, ...rest] = order;
  if (centre !== undefined) positions.set(centre, { x: 0, y: 0 });

  let ring = 1;
  let placedInRing = 0;
  let capacity = ringCapacity(ring);
  let outermost = 0;
  for (const id of rest) {
    if (placedInRing === capacity) {
      ring += 1;
      placedInRing = 0;
      capacity = ringCapacity(ring);
    }
    const radius = ring * RING_GAP;
    // The starting angle alternates by ring so neighbouring rings do not line their nodes up radially, which
    // reads as spokes that are not in the data.
    const offset = ring % 2 === 0 ? Math.PI / capacity : 0;
    const angle = offset + (2 * Math.PI * placedInRing) / capacity;
    positions.set(id, {
      x: Math.round(radius * Math.cos(angle)),
      y: Math.round(radius * Math.sin(angle)),
    });
    outermost = radius;
    placedInRing += 1;
  }

  const extent = 2 * outermost;
  return { positions, width: extent, height: extent, fallback: false };
};
