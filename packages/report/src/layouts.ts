/**
 * The layouts a report can carry, and where each one's coordinates are written.
 *
 * Edges that export Mermaid cannot lay a graph out at render time without a second layout engine, and a layout engine
 * there would also cost the determinism the whole map depends on, because the same graph has to give the
 * same drawing on every machine. So every layout offered is computed here and baked into the bundle, and
 * the picker in the browser switches between sets of coordinates rather than running anything.
 *
 * Two rules hold across the set and both are load bearing.
 *
 * Every layout positions exactly the same components, because they all read the same relations. A reader
 * switching layout must not see the census change: "150 of 987 components are on the map" cannot depend
 * on a control the sentence does not mention.
 *
 * The concentric layout keeps the keys it has always had. A bundle written before the others existed is
 * still a bundle this build can draw, and it says so by carrying no `mapLayouts` entry, which is what the
 * picker reads to decide whether to offer anything at all.
 */

import type { SystemGraph } from '@orchescope/schema';
import { type FlowDirection, layoutLayered } from './layered-layout.ts';
import { layoutGraph, type Position } from './layout.ts';

export type MapLayoutKind = 'concentric' | 'top_down' | 'left_to_right';

export interface BakedLayout {
  readonly kind: MapLayoutKind;
  readonly positions: ReadonlyMap<string, Position>;
  /** How many relations deep each component sits. Only a directional layout draws this. */
  readonly ranks: ReadonlyMap<string, number> | null;
}

export interface MapLayoutKeys {
  readonly kind: MapLayoutKind;
  readonly x: string;
  readonly y: string;
}

/** Where each layout's coordinates live in a component's metadata. */
export const MAP_LAYOUT_KEYS: readonly MapLayoutKeys[] = [
  { kind: 'concentric', x: 'layoutX', y: 'layoutY' },
  { kind: 'top_down', x: 'layoutDownX', y: 'layoutDownY' },
  { kind: 'left_to_right', x: 'layoutRightX', y: 'layoutRightY' },
];

/** Where the depth a directional layout draws is written, so the components table can show it too. */
export const LAYOUT_RANK_KEY = 'layoutRank';

/** Which layouts a bundle carries, listed in `graph.metadata` under this key. */
export const MAP_LAYOUTS_KEY = 'mapLayouts';

const DIRECTIONS: Readonly<Record<string, FlowDirection>> = {
  top_down: 'down',
  left_to_right: 'right',
};

export const bakeLayouts = (graph: SystemGraph): readonly BakedLayout[] =>
  MAP_LAYOUT_KEYS.map(({ kind }) => {
    const direction = DIRECTIONS[kind];
    if (direction === undefined) {
      return { kind, positions: layoutGraph(graph).positions, ranks: null };
    }
    const layered = layoutLayered(graph, direction);
    return { kind, positions: layered.positions, ranks: layered.ranks };
  });
