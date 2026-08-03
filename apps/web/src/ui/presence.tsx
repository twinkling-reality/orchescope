/**
 * Whether a run reached a component, drawn with the same marks the delta bar uses.
 *
 * This is the one idea of the whole workspace applied to a single component: a filled square was
 * measured in a run, a hollow one was only ever declared. The fourth state is the one that is easiest
 * to report wrongly. A report with no runs in it cannot say that a component was never exercised, only
 * that there was nothing to exercise it, and a hollow square there would be an inference presented as
 * an observation. It gets a dashed mark and says so.
 */

import type { Component } from '@orchescope/schema';
import type { GraphIndex } from '../graph-index.ts';

export type Presence = 'exercised' | 'undeclared' | 'declared_only' | 'no_runs';

const LABELS: Readonly<Record<Presence, string>> = {
  exercised: 'Exercised',
  undeclared: 'Ran, never declared',
  declared_only: 'Never exercised',
  no_runs: 'No run to compare',
};

const TITLES: Readonly<Record<Presence, string>> = {
  exercised: 'Declared in this repository and reached by at least one ingested run.',
  undeclared: 'Observed in a run and not declared anywhere this scan could read.',
  declared_only: 'Declared in this repository and not reached by any ingested run.',
  no_runs:
    'This report carries no run, so whether this component executes is unknown rather than false.',
};

const FILL: Readonly<Record<Presence, 'met' | 'unmet' | 'unknown'>> = {
  exercised: 'met',
  undeclared: 'met',
  declared_only: 'unmet',
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
  return component.presence.runtime ? 'exercised' : 'declared_only';
}

export function PresenceMark(props: { readonly presence: Presence }) {
  const { presence } = props;
  return (
    <span class={`presence is-${FILL[presence]}`} title={TITLES[presence]}>
      <i aria-hidden="true" />
      {LABELS[presence]}
    </span>
  );
}
