/**
 * Whether a run was ever seen touching a part of the system, and the selection built from that answer.
 *
 * This is the one idea of the whole workspace applied to a single part: a filled square was measured in
 * a run, a hollow one was only ever written down. Two of the five states are the ones that are easy to
 * report wrongly, and both of them get a dashed mark rather than a hollow one, because a hollow square
 * says "a run looked and did not find this" and neither of them can say that.
 *
 * `no_runs` is the first. A report with no run in it cannot say a part was never reached, only that
 * nothing has looked. Thirteen of the sixteen cached reports are in that state.
 *
 * `untraced` is the second, and it used to be reported as `Never exercised`, which was false. A trace
 * records agents, models, tools, stores, queues and the effects they cause. It does not record a prompt,
 * a provider, an entry point or the project itself, so no run can ever say whether one of those was
 * used. The reconciliation already excludes them from its denominator; before this they were still
 * counted as never reached in the map's own filter, which is why the map reported eighteen never
 * exercised on a report whose Overview reported seven.
 *
 * Four states are a selection, because the Overview counts them and a count a reader cannot open is a
 * number they have to take on trust. `no_runs` is not selectable: in a report with no run every part is
 * in it, so filtering on it narrows nothing.
 */

import type { Component } from '@orchescope/schema';
import type { GraphIndex } from './graph-index.ts';

export type Presence = 'exercised' | 'undeclared' | 'declared_only' | 'untraced' | 'no_runs';

/** The presences a reader can select, in the order the Overview counts them. */
export const SELECTABLE_PRESENCES: readonly Presence[] = [
  'exercised',
  'declared_only',
  'undeclared',
  'untraced',
];

export const PRESENCE_LABELS: Readonly<Record<Presence, string>> = {
  exercised: 'Seen running',
  undeclared: 'Ran, not declared',
  declared_only: 'Never seen running',
  untraced: 'Nothing a run records',
  no_runs: 'No run to compare',
};

export const PRESENCE_TITLES: Readonly<Record<Presence, string>> = {
  exercised: 'Written down in this repository, and at least one run was seen reaching it.',
  undeclared: 'A run reached it, and nothing this scan could read declares it.',
  declared_only: 'Written down in this repository, and no run has been seen reaching it.',
  untraced:
    'A run records agents, models, tools, stores and the effects they cause. This is not one of those, so no run can say whether it was used.',
  no_runs: 'This report carries no run, so whether this runs is unknown rather than false.',
};

export const PRESENCE_FILL: Readonly<Record<Presence, 'met' | 'unmet' | 'unknown'>> = {
  exercised: 'met',
  undeclared: 'met',
  declared_only: 'unmet',
  untraced: 'unknown',
  no_runs: 'unknown',
};

export function presenceOf(index: GraphIndex, component: Component): Presence {
  if (!index.hasRuntimeEvidence) {
    return 'no_runs';
  }
  if (index.runtimeOnly.has(component.id)) {
    return 'undeclared';
  }
  if (index.neverExercised.has(component.id)) {
    return 'declared_only';
  }
  if (component.presence.runtime) {
    return 'exercised';
  }
  // Not reached by a run, and the join did not put it in the set of things a run could have reached.
  // With a join computed that is a positive fact about the kind; without one the report never made the
  // distinction, so the honest answer is still the weaker `declared_only`.
  return index.joinComputed ? 'untraced' : 'declared_only';
}

/**
 * Narrows a component list to the selected presences. An empty selection is not a filter that matches
 * nothing, it is the absence of a filter, which is the same rule every other token filter here follows.
 */
export function filterByPresence(
  components: readonly Component[],
  index: GraphIndex,
  selected: readonly Presence[],
): readonly Component[] {
  if (selected.length === 0) {
    return components;
  }
  return components.filter((component) => selected.includes(presenceOf(index, component)));
}

/** How many components each selectable presence holds, in the order the meter counts them. */
export function countPresences(
  components: readonly Component[],
  index: GraphIndex,
): ReadonlyMap<Presence, number> {
  const counts = new Map<Presence, number>(
    SELECTABLE_PRESENCES.map((presence) => [presence, 0] as const),
  );
  for (const component of components) {
    const presence = presenceOf(index, component);
    const current = counts.get(presence);
    if (current !== undefined) {
      counts.set(presence, current + 1);
    }
  }
  return counts;
}
