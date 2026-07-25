/**
 * Overlay scaling for the system map.
 *
 * Overlay values are precomputed in the bundle. This module only turns them into a colour and a size,
 * and it keeps the absence of a value distinct from a value of zero: a component with no measurement
 * is drawn in the neutral colour and named as having no data, never as the cheapest or the fastest.
 */

import type { Overlay } from '@orchescope/schema';

export interface OverlayScale {
  readonly kind: string;
  readonly label: string;
  readonly unit: string | null;
  readonly basis: string;
  readonly caveat: string | null;
  readonly min: number;
  readonly max: number;
  readonly values: ReadonlyMap<string, number>;
}

export const NEUTRAL_COLOR = '#8b8f9a';

/** Sequential ramp. Both ends stay visible on a light and on a dark canvas. */
const RAMP: readonly string[] = ['#9ecbff', '#5aa2f0', '#3f6fd8', '#5148c4', '#6b2fa8'];

export const MIN_NODE_SIZE = 3;
export const MAX_NODE_SIZE = 14;

export function buildOverlayScale(overlay: Overlay): OverlayScale {
  const values = new Map<string, number>();
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const entry of overlay.values) {
    if (!Number.isFinite(entry.value)) {
      continue;
    }
    values.set(entry.componentId, entry.value);
    min = Math.min(min, entry.value);
    max = Math.max(max, entry.value);
  }
  const empty = values.size === 0;
  return {
    kind: overlay.kind,
    label: overlay.label,
    unit: overlay.unit ?? null,
    basis: overlay.basis,
    caveat: overlay.caveat ?? null,
    min: empty ? 0 : min,
    max: empty ? 0 : max,
    values,
  };
}

/**
 * Maps a value onto the unit interval. A range with no spread returns the midpoint, so a set of
 * identical measurements is drawn uniformly rather than all at one extreme.
 */
export function normaliseValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0.5;
  }
  if (max <= min) {
    return 0.5;
  }
  const clamped = Math.min(Math.max(value, min), max);
  return (clamped - min) / (max - min);
}

function parseHex(hex: string): readonly [number, number, number] {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function toHex(channel: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(channel)));
  return clamped.toString(16).padStart(2, '0');
}

/** Piecewise linear interpolation across the ramp. `t` outside the unit interval is clamped. */
export function overlayColor(t: number): string {
  if (!Number.isFinite(t)) {
    return NEUTRAL_COLOR;
  }
  const clamped = Math.min(1, Math.max(0, t));
  const lastIndex = RAMP.length - 1;
  const scaled = clamped * lastIndex;
  const lower = Math.min(lastIndex, Math.floor(scaled));
  const upper = Math.min(lastIndex, lower + 1);
  const fromHex = RAMP[lower];
  const toHexStop = RAMP[upper];
  if (fromHex === undefined || toHexStop === undefined) {
    return NEUTRAL_COLOR;
  }
  const mix = scaled - lower;
  const from = parseHex(fromHex);
  const to = parseHex(toHexStop);
  return `#${toHex(from[0] + (to[0] - from[0]) * mix)}${toHex(
    from[1] + (to[1] - from[1]) * mix,
  )}${toHex(from[2] + (to[2] - from[2]) * mix)}`;
}

export function overlayNodeSize(
  t: number,
  minSize = MIN_NODE_SIZE,
  maxSize = MAX_NODE_SIZE,
): number {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return minSize + (maxSize - minSize) * clamped;
}

export interface LegendStop {
  readonly t: number;
  readonly value: number;
  readonly color: string;
}

/** Evenly spaced stops for the legend, always including both ends of the measured range. */
export function overlayLegend(scale: OverlayScale, steps = 5): readonly LegendStop[] {
  const count = Math.max(2, steps);
  const stops: LegendStop[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    stops.push({ t, value: scale.min + (scale.max - scale.min) * t, color: overlayColor(t) });
  }
  return stops;
}

export interface OverlayPaint {
  readonly color: string;
  readonly size: number;
  readonly value: number | null;
}

export function paintComponent(scale: OverlayScale | null, componentId: string): OverlayPaint {
  if (scale === null) {
    return { color: overlayColor(0.45), size: overlayNodeSize(0.35), value: null };
  }
  const value = scale.values.get(componentId);
  if (value === undefined) {
    return { color: NEUTRAL_COLOR, size: MIN_NODE_SIZE, value: null };
  }
  const t = normaliseValue(value, scale.min, scale.max);
  return { color: overlayColor(t), size: overlayNodeSize(t), value };
}
