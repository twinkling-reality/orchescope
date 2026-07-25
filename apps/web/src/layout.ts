/**
 * Node positions for the system map.
 *
 * Layout runs in the command line tool and the coordinates are baked into the bundle, so the browser
 * only reads them. When a component has no stored coordinate the fallback is a circle computed from
 * the sorted component identifiers: it is stable across reloads and across machines, which a random
 * layout is not, and a map that moves between two readings of the same report is not evidence.
 */

export const LAYOUT_X_KEY = 'layoutX';
export const LAYOUT_Y_KEY = 'layoutY';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LayoutItem {
  readonly id: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LayoutResult {
  readonly positions: ReadonlyMap<string, Point>;
  /** Identifiers that had no stored coordinate and were placed on the fallback circle. */
  readonly fallbackIds: readonly string[];
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readLayoutPoint(metadata: Readonly<Record<string, unknown>>): Point | null {
  const x = readNumber(metadata[LAYOUT_X_KEY]);
  const y = readNumber(metadata[LAYOUT_Y_KEY]);
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
}

/** Angle zero is to the right and the ring is walked counter clockwise, for `count` slots. */
export function circlePoint(index: number, count: number, radius: number, centre: Point): Point {
  const slots = Math.max(1, count);
  const angle = (2 * Math.PI * index) / slots;
  return {
    x: centre.x + radius * Math.cos(angle),
    y: centre.y + radius * Math.sin(angle),
  };
}

function centreOf(points: readonly Point[]): Point {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  return { x: sumX / points.length, y: sumY / points.length };
}

function radiusAround(centre: Point, points: readonly Point[]): number {
  let furthest = 0;
  for (const point of points) {
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    furthest = Math.max(furthest, Math.hypot(dx, dy));
  }
  return furthest;
}

const FALLBACK_RING_SCALE = 1.25;

/**
 * Uses the stored coordinate where one exists and places the remainder on a deterministic ring
 * outside the coordinates that do exist, so a partially laid out graph is still readable.
 */
export function resolveLayout(items: readonly LayoutItem[]): LayoutResult {
  const positions = new Map<string, Point>();
  const missing: string[] = [];
  const known: Point[] = [];

  for (const item of items) {
    const point = readLayoutPoint(item.metadata);
    if (point === null) {
      missing.push(item.id);
    } else {
      positions.set(item.id, point);
      known.push(point);
    }
  }

  missing.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const centre = centreOf(known);
  const spread = radiusAround(centre, known);
  const radius = spread > 0 ? spread * FALLBACK_RING_SCALE : 1;

  for (const [index, id] of missing.entries()) {
    positions.set(id, circlePoint(index, missing.length, radius, centre));
  }

  return { positions, fallbackIds: missing };
}
