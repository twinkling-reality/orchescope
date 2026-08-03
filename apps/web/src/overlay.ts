/**
 * Overlay scaling for the system map.
 *
 * Overlay values are precomputed in the bundle. This module only turns them into a colour and a size,
 * and it keeps the absence of a value distinct from a value of zero: a component with no measurement
 * is drawn hollow and named as having no data, never as the cheapest or the fastest.
 *
 * The ramp is neutral, from the outline grey to the ink, because nothing on this page carries meaning
 * in hue except severity. Magnitude is carried twice, by tone and by size, so a reader who cannot
 * separate two greys still has the radius, and both ends stay legible in either theme because the two
 * endpoints are the theme's own.
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

/** What a component with no measurement is drawn in. Never a point on the ramp. */
export const NEUTRAL_COLOR = '#8b8f9a';

export interface Ramp {
  readonly from: string;
  readonly to: string;
}

/** The light theme's outline and ink. The canvas passes the resolved pair for the theme in force. */
export const DEFAULT_RAMP: Ramp = { from: '#aeb5c1', to: '#12151c' };

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
  return [Number.isFinite(r) ? r : 0, Number.isFinite(g) ? g : 0, Number.isFinite(b) ? b : 0];
}

function toHex(channel: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(channel)));
  return clamped.toString(16).padStart(2, '0');
}

/** Linear interpolation between the two ends of the ramp. `t` outside the unit interval is clamped. */
export function overlayColor(t: number, ramp: Ramp = DEFAULT_RAMP): string {
  if (!Number.isFinite(t)) {
    return NEUTRAL_COLOR;
  }
  const mix = Math.min(1, Math.max(0, t));
  const from = parseHex(ramp.from);
  const to = parseHex(ramp.to);
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
export function overlayLegend(
  scale: OverlayScale,
  steps = 5,
  ramp: Ramp = DEFAULT_RAMP,
): readonly LegendStop[] {
  const count = Math.max(2, steps);
  const stops: LegendStop[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    stops.push({
      t,
      value: scale.min + (scale.max - scale.min) * t,
      color: overlayColor(t, ramp),
    });
  }
  return stops;
}

export interface OverlayPaint {
  readonly color: string;
  readonly size: number;
  /** Null when this component carries no measurement, which is not a measurement of nothing. */
  readonly value: number | null;
}

export function paintComponent(
  scale: OverlayScale | null,
  componentId: string,
  ramp: Ramp = DEFAULT_RAMP,
): OverlayPaint {
  if (scale === null) {
    return { color: overlayColor(0.45, ramp), size: overlayNodeSize(0.35), value: null };
  }
  const value = scale.values.get(componentId);
  if (value === undefined) {
    return { color: NEUTRAL_COLOR, size: MIN_NODE_SIZE, value: null };
  }
  const t = normaliseValue(value, scale.min, scale.max);
  return { color: overlayColor(t, ramp), size: overlayNodeSize(t), value };
}
