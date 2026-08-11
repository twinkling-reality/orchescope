/**
 * Node positions for the system map, in every layout the bundle carries.
 *
 * Layout runs in the command line tool and the coordinates are baked into the bundle, so the browser
 * only reads them. That is what keeps the same graph giving the same drawing on every machine, and it is
 * why a picker here switches between sets of coordinates rather than running an algorithm.
 *
 * A component with no stored coordinate is not drawn, and this module invents nothing for it. That is a
 * change from an earlier version which placed it on a ring computed from its identifier. The reason is
 * that an absent coordinate stopped meaning "the layout did not reach this" and started meaning "this
 * component has no relation, so it is not part of any topology": in `openai-agents-python` that is 1091
 * of 1390 components. Scattering them on a ring drew a thousand anonymous circles that no relation
 * touched, which reads as a system and is not one. The workspace counts them and names their kinds
 * instead, which is a fact a reader can act on.
 *
 * Every layout positions the same components, because every layout reads the same relations. That is
 * asserted here rather than assumed: `placedIds` is one set, not one per layout, so the census beside the
 * canvas cannot change when a reader switches layout.
 */

export type MapLayoutKind = 'concentric' | 'top_down' | 'left_to_right';

export interface MapLayoutKeys {
  readonly kind: MapLayoutKind;
  readonly x: string;
  readonly y: string;
}

/**
 * Where each layout's coordinates live. These names are also written in
 * `packages/report/src/layouts.ts`, which is the process that puts them there; `pnpm states` reads both
 * and refuses a bundle whose coordinates this build did not produce, so the two cannot drift silently.
 */
const CONCENTRIC_KEYS: MapLayoutKeys = { kind: 'concentric', x: 'layoutX', y: 'layoutY' };

export const MAP_LAYOUT_KEYS: readonly MapLayoutKeys[] = [
  CONCENTRIC_KEYS,
  { kind: 'top_down', x: 'layoutDownX', y: 'layoutDownY' },
  { kind: 'left_to_right', x: 'layoutRightX', y: 'layoutRightY' },
];

export const LAYOUT_RANK_KEY = 'layoutRank';

/** The layout every bundle has always carried, and the one a reader starts on. */
export const DEFAULT_LAYOUT: MapLayoutKind = 'concentric';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LayoutItem {
  readonly id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LayoutResult {
  /** Coordinates per layout. A layout the bundle does not carry is absent from this map. */
  readonly byKind: ReadonlyMap<MapLayoutKind, ReadonlyMap<string, Point>>;
  /** The layouts this bundle can draw, in the order they are offered. */
  readonly kinds: readonly MapLayoutKind[];
  /** Components on the map. The same set whichever layout is showing, so the census does not move. */
  readonly placedIds: ReadonlySet<string>;
  /** Identifiers with no stored coordinate, which the map does not draw. Sorted, so the report is stable. */
  readonly unplacedIds: readonly string[];
  /** How many relations deep a component sits, where a directional layout worked it out. */
  readonly ranks: ReadonlyMap<string, number>;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readLayoutPoint(
  metadata: Readonly<Record<string, unknown>>,
  keys: MapLayoutKeys = CONCENTRIC_KEYS,
): Point | null {
  const x = readNumber(metadata[keys.x]);
  const y = readNumber(metadata[keys.y]);
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
}

/** Reads the stored coordinates for every layout present and reports which components have none. */
export function resolveLayout(items: readonly LayoutItem[]): LayoutResult {
  const byKind = new Map<MapLayoutKind, Map<string, Point>>();
  const placedIds = new Set<string>();
  const unplaced: string[] = [];
  const ranks = new Map<string, number>();

  for (const item of items) {
    let placed = false;
    for (const keys of MAP_LAYOUT_KEYS) {
      const point = readLayoutPoint(item.metadata, keys);
      if (point === null) continue;
      placed = true;
      const bucket = byKind.get(keys.kind);
      if (bucket === undefined) byKind.set(keys.kind, new Map([[item.id, point]]));
      else bucket.set(item.id, point);
    }
    const rank = readNumber(item.metadata[LAYOUT_RANK_KEY]);
    if (rank !== null) ranks.set(item.id, rank);
    if (placed) placedIds.add(item.id);
    else unplaced.push(item.id);
  }

  unplaced.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    byKind,
    kinds: MAP_LAYOUT_KEYS.map((keys) => keys.kind).filter((kind) => byKind.has(kind)),
    placedIds,
    unplacedIds: unplaced,
    ranks,
  };
}

/** The coordinates to draw with: the layout asked for, or the one every bundle carries. */
export function positionsFor(
  layout: LayoutResult,
  kind: MapLayoutKind,
): ReadonlyMap<string, Point> {
  return layout.byKind.get(kind) ?? layout.byKind.get(DEFAULT_LAYOUT) ?? new Map();
}
