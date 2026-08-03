import type { SystemGraph } from '@orchescope/schema';
import { buildDirected, compareIds, type DirectedRelations, PITCH } from './layout-relations.ts';
import type { Position } from './layout.ts';

/**
 * Deterministic directional layout: every component sits ahead of everything it calls.
 *
 * A ring shows what hangs off what and says nothing about which way anything flows. This says the
 * second thing and gives up the first, which is why it is a choice a reader makes rather than a
 * replacement.
 *
 * ## Why the ranks wrap, and why that is not the layout phase 20 removed
 *
 * The layered layout this repository removed put every member of a rank on one line. Every agent system
 * in the pinned corpus is hub and spoke, so one hop from a degree 98 hub is a line of 98 nodes, and the
 * drawing grew in one direction and not the other:
 *
 * ```
 *                     drawn   one rank per line   wrapped        ring
 * demonstration-system   25      3250 x   600      910 x 1040     795 x  798
 * crewai                150     16120 x   400     1690 x 1788    2198 x 2000
 * openai-agents-python  298     18590 x   400     2340 x 2438    2997 x 3000
 * pydantic-ai           678     67600 x   400     3510 x 3608    4599 x 4599
 * ```
 *
 * A ribbon of aspect 169 rendered into a canvas of aspect 1.4 is a column of dots, and it is what a
 * reader saw. Wrapping an oversized rank into a block instead of a line removes it completely: every
 * corpus graph lands within five percent of square, and rank r is still entirely ahead of rank r+1, so
 * the flow still reads. The wrap width is chosen to square the whole drawing for the same reason the
 * rings are circles and not ellipses: the coordinates are computed once and rendered at whatever shape
 * the reader's window is.
 *
 * ## Why alternate lines are offset
 *
 * A name is drawn horizontally, so two nodes that share a y collide however far apart they are, and a
 * plain lattice puts every neighbour in a row at the same y. Offsetting each line by a quarter of the
 * pitch gives every horizontal neighbour a different y, which is a property a ring has for free. It is
 * the difference between naming everything and naming almost nothing: measured over connected slices of
 * every corpus repository at 25 sizes, a wrapped lattice with no offset names 29% of a drawing of 25
 * nodes and the same lattice offset names 100%.
 *
 * Four phases rather than two. Two puts the nearest same line neighbour two pitches away, which is not
 * enough for a name at the scale a drawing of forty nodes is fitted at; six pushes the offset itself
 * under a line of type. Four names every drawing in the corpus up to 120 nodes, where two manages 25 and
 * six collapses past 50.
 */

/** Where the flow points. Down puts each rank in a band, right puts each rank in a column. */
export type FlowDirection = 'down' | 'right';

export interface LayeredLayout {
  readonly positions: ReadonlyMap<string, Position>;
  readonly width: number;
  readonly height: number;
  /**
   * How many relations deep each positioned component sits, which is the coordinate this layout draws.
   * The canvas is hidden from assistive technology, so the table carries the same number as a column.
   */
  readonly ranks: ReadonlyMap<string, number>;
}

/**
 * Distance between the last line of one rank and the first line of the next.
 *
 * Twice the gap inside a rank, so a rank boundary is the widest gap in the drawing and reads as one. A
 * wrapped rank is several lines deep, so a gap the size of the gap inside it leaves a reader unable to
 * tell a boundary from a wrap, which is the one thing this layout exists to show. Three times is worse
 * rather than clearer: it grows the drawing enough to cost a fifth of the names it could otherwise
 * place, measured over connected slices of every corpus repository.
 */
const RANK_GAP = 2 * PITCH;

/** How many lines the offset cycles over before repeating. See the note above for why it is four. */
const PHASES = 4;

const degree = (relations: ReadonlyMap<string, readonly string[]>, id: string): number =>
  relations.get(id)?.length ?? 0;

/** Where the search has reached a component: on the stack, or finished with. */
const OPEN = 1;
const CLOSED = 2;

/**
 * Depth first from the least depended on component, dropping every edge that closes a cycle.
 *
 * A cycle has no first member, so something has to be chosen and the choice has to be the same on every
 * machine. The search starts at whatever has the fewest components pointing at it, breaking ties on the
 * busiest and then on the identifier, so no map iteration order can reach the result.
 */
const breakCycles = (relations: DirectedRelations): ReadonlySet<string> => {
  const state = new Map<string, number>();
  const dropped = new Set<string>();
  const roots = [...relations.nodes].sort((left, right) => {
    const byIncoming = degree(relations.incoming, left) - degree(relations.incoming, right);
    if (byIncoming !== 0) return byIncoming;
    const byOutgoing = degree(relations.out, right) - degree(relations.out, left);
    return byOutgoing !== 0 ? byOutgoing : compareIds(left, right);
  });
  for (const root of roots) {
    if (state.has(root)) continue;
    state.set(root, OPEN);
    const stack: { node: string; next: number }[] = [{ node: root, next: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined) break;
      const children = relations.out.get(top.node) ?? [];
      const child = children[top.next];
      if (child === undefined) {
        state.set(top.node, CLOSED);
        stack.pop();
        continue;
      }
      top.next += 1;
      const seen = state.get(child);
      if (seen === OPEN) {
        dropped.add(`${top.node} ${child}`);
        continue;
      }
      if (seen === CLOSED) continue;
      state.set(child, OPEN);
      stack.push({ node: child, next: 0 });
    }
  }
  return dropped;
};

/**
 * Longest path layering over what is left, in waves so that no two machines can order a wave differently.
 * A component sits one rank past the deepest thing that reaches it, which is what puts every relation on
 * the page pointing the same way.
 */
const assignRanks = (
  relations: DirectedRelations,
  dropped: ReadonlySet<string>,
): ReadonlyMap<string, number> => {
  const live = (from: string, to: string): boolean => !dropped.has(`${from} ${to}`);
  const remaining = new Map<string, number>();
  for (const id of relations.nodes) {
    remaining.set(id, (relations.incoming.get(id) ?? []).filter((from) => live(from, id)).length);
  }
  const rank = new Map<string, number>();
  let wave = relations.nodes.filter((id) => remaining.get(id) === 0).sort(compareIds);
  const reached = new Set(wave);
  for (const id of wave) rank.set(id, 0);
  while (wave.length > 0) {
    wave = advance(relations, live, wave, rank, remaining, reached);
  }
  rankTheUnreached(relations, rank);
  return rank;
};

/** One wave of the layering: everything the components just ranked point at. */
const advance = (
  relations: DirectedRelations,
  live: (from: string, to: string) => boolean,
  wave: readonly string[],
  rank: Map<string, number>,
  remaining: Map<string, number>,
  reached: Set<string>,
): string[] => {
  const next: string[] = [];
  for (const id of wave) {
    for (const child of relations.out.get(id) ?? []) {
      if (!live(id, child)) continue;
      rank.set(child, Math.max(rank.get(child) ?? 0, (rank.get(id) ?? 0) + 1));
      remaining.set(child, (remaining.get(child) ?? 0) - 1);
      if (remaining.get(child) === 0 && !reached.has(child)) {
        reached.add(child);
        next.push(child);
      }
    }
  }
  return next.sort(compareIds);
};

/**
 * Whatever the waves never reached is inside a cycle the search could not open. It sits one rank past
 * its shallowest parent, which is the only answer that keeps it ahead of nothing it depends on.
 */
const rankTheUnreached = (relations: DirectedRelations, rank: Map<string, number>): void => {
  for (const id of relations.nodes) {
    if (rank.has(id)) continue;
    const parents = (relations.incoming.get(id) ?? [])
      .map((from) => rank.get(from))
      .filter((value): value is number => value !== undefined);
    rank.set(id, parents.length === 0 ? 0 : Math.min(...parents) + 1);
  }
};

/** One rank, reordered onto the average position of what it is joined to on either side of itself. */
const straighten = (
  relations: DirectedRelations,
  rank: ReadonlyMap<string, number>,
  place: Map<string, number>,
  bucket: string[],
  depth: number,
): void => {
  const anchor = new Map<string, number>();
  for (const id of bucket) {
    const places = [...(relations.incoming.get(id) ?? []), ...(relations.out.get(id) ?? [])]
      .filter((other) => (rank.get(other) ?? 0) !== depth)
      .map((other) => place.get(other))
      .filter((value): value is number => value !== undefined);
    anchor.set(
      id,
      places.length === 0
        ? (place.get(id) ?? 0)
        : places.reduce((sum, value) => sum + value, 0) / places.length,
    );
  }
  bucket.sort(
    (left, right) => (anchor.get(left) ?? 0) - (anchor.get(right) ?? 0) || compareIds(left, right),
  );
  for (const [index, id] of bucket.entries()) place.set(id, index);
};

/**
 * Order inside a rank by the average position of what a component is joined to in the ranks either side,
 * twice, which is the standard way to pull a relation straight. Ties break on the identifier.
 */
const orderRanks = (
  relations: DirectedRelations,
  rank: ReadonlyMap<string, number>,
): readonly (readonly string[])[] => {
  const byRank = new Map<number, string[]>();
  for (const id of [...relations.nodes].sort(compareIds)) {
    const depth = rank.get(id) ?? 0;
    const bucket = byRank.get(depth);
    if (bucket === undefined) byRank.set(depth, [id]);
    else bucket.push(id);
  }
  const depths = [...byRank.keys()].sort((left, right) => left - right);
  const place = new Map<string, number>();
  for (const depth of depths) {
    for (const [index, id] of (byRank.get(depth) ?? []).entries()) place.set(id, index);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    for (const depth of depths) {
      straighten(relations, rank, place, byRank.get(depth) ?? [], depth);
    }
  }
  return depths.map((depth) => byRank.get(depth) ?? []);
};

/** The extent a given wrap width would produce, computed before anything is placed. */
const extentAt = (sizes: readonly number[], across: number): { across: number; along: number } => {
  let along = 0;
  let widest = 0;
  for (const [index, size] of sizes.entries()) {
    const columns = Math.min(size, across);
    const lines = Math.ceil(size / columns);
    widest = Math.max(widest, columns);
    along += (lines - 1) * PITCH;
    if (index < sizes.length - 1) along += RANK_GAP;
  }
  return { across: (widest - 1) * PITCH, along };
};

/** The wrap width that leaves the whole drawing closest to square. */
const wrapWidth = (sizes: readonly number[]): number => {
  const widest = Math.max(...sizes);
  let chosen = 1;
  let best = Number.POSITIVE_INFINITY;
  for (let candidate = 1; candidate <= widest; candidate += 1) {
    const extent = extentAt(sizes, candidate);
    const long = Math.max(extent.across, extent.along, 1);
    const short = Math.max(Math.min(extent.across, extent.along), 1);
    if (long / short < best) {
      best = long / short;
      chosen = candidate;
    }
  }
  return chosen;
};

export const layoutLayered = (graph: SystemGraph, direction: FlowDirection): LayeredLayout => {
  const relations = buildDirected(graph);
  if (relations.nodes.length === 0) {
    return { positions: new Map(), width: 0, height: 0, ranks: new Map() };
  }
  const rank = assignRanks(relations, breakCycles(relations));
  const lines = orderRanks(relations, rank);
  const across = wrapWidth(lines.map((bucket) => bucket.length));

  const positions = new Map<string, Position>();
  let along = 0;
  for (const [index, bucket] of lines.entries()) {
    const columns = Math.min(bucket.length, across);
    bucket.forEach((id, place) => {
      const column = place % columns;
      const line = Math.floor(place / columns);
      const acrossUnits =
        (column - (columns - 1) / 2) * PITCH +
        (direction === 'right' ? (line % PHASES) * (PITCH / PHASES) : 0);
      const alongUnits =
        along + line * PITCH + (direction === 'down' ? (column % PHASES) * (PITCH / PHASES) : 0);
      // Sigma's y axis points up, so a rank further along renders higher. A flow that points down has
      // to negate it or the drawing reads bottom up, which is the opposite of what the control says.
      positions.set(
        id,
        direction === 'right'
          ? { x: Math.round(alongUnits), y: Math.round(acrossUnits) }
          : { x: Math.round(acrossUnits), y: -Math.round(alongUnits) },
      );
    });
    along += (Math.ceil(bucket.length / columns) - 1) * PITCH;
    if (index < lines.length - 1) along += RANK_GAP;
  }

  const xs = [...positions.values()].map((point) => point.x);
  const ys = [...positions.values()].map((point) => point.y);
  const ranks = new Map<string, number>();
  for (const id of relations.nodes) ranks.set(id, rank.get(id) ?? 0);
  return {
    positions,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    ranks,
  };
};
