/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countPresences,
  filterByPresence,
  type Presence,
  presenceOf,
  SELECTABLE_PRESENCES,
} from '../src/presentation/component-presence.ts';
import { buildGraphIndex } from '../src/presentation/graph-index.ts';
import { bundle, component } from './fixture.ts';
import { reportWithRun } from './overview-fixture.ts';

const exercised = component({
  id: 'agent:active',
  presence: { static: true, runtime: true, manifest: false },
});
const declaredOnly = component({ id: 'agent:idle' });
const undeclared = component({
  id: 'tool:outside',
  kind: 'tool',
  presence: { static: false, runtime: true, manifest: false },
});

function indexWithRun() {
  return buildGraphIndex(
    reportWithRun({
      graph: {
        ...bundle().graph,
        components: [exercised, declaredOnly, undeclared],
      },
      reconciliation: {
        ...reportWithRun().reconciliation!,
        exercisedNotDeclared: { components: ['tool:outside'], edges: [] },
      },
    }),
  );
}

describe('presenceOf', () => {
  it('separates the three measured states once a run exists', () => {
    const index = indexWithRun();
    assert.equal(presenceOf(index, exercised), 'exercised');
    assert.equal(presenceOf(index, declaredOnly), 'declared_only');
    assert.equal(presenceOf(index, undeclared), 'undeclared');
  });

  it('says no run to compare rather than never exercised when nothing has run', () => {
    const index = buildGraphIndex(
      bundle({ graph: { ...bundle().graph, components: [declaredOnly] } }),
    );
    assert.equal(presenceOf(index, declaredOnly), 'no_runs');
  });

  it('says a trace never records this kind rather than never seen running', () => {
    // A prompt has no span, so a run can never say whether it was used. Reporting it as never seen
    // running is an inference presented as an observation, and it is what made the map's own filter
    // report eighteen never exercised on a report whose Overview reported seven.
    const prompt = component({ id: 'prompt:system', kind: 'prompt' });
    const index = buildGraphIndex(
      reportWithRun({
        graph: { ...bundle().graph, components: [exercised, declaredOnly, prompt] },
      }),
    );
    assert.equal(presenceOf(index, prompt), 'untraced');
  });

  it('gives the weaker answer when this report never made the comparison at all', () => {
    // Without a join there is nothing that separates a kind no trace records from something a run
    // simply did not reach, so the honest answer is the one that claims less.
    const prompt = component({ id: 'prompt:system', kind: 'prompt' });
    const { reconciliation: _omitted, ...withoutJoin } = reportWithRun();
    const index = buildGraphIndex({
      ...withoutJoin,
      graph: { ...withoutJoin.graph, components: [prompt] },
    });
    assert.equal(presenceOf(index, prompt), 'declared_only');
  });
});

describe('filterByPresence', () => {
  it('treats an empty selection as no filter rather than as a filter matching nothing', () => {
    const index = indexWithRun();
    const components = [exercised, declaredOnly, undeclared];
    assert.deepEqual(
      filterByPresence(components, index, []).map((entry) => entry.id),
      ['agent:active', 'agent:idle', 'tool:outside'],
    );
  });

  it('narrows to one selected set', () => {
    const index = indexWithRun();
    assert.deepEqual(
      filterByPresence([exercised, declaredOnly, undeclared], index, ['declared_only']).map(
        (entry) => entry.id,
      ),
      ['agent:idle'],
    );
  });

  it('narrows to the union of several selected sets', () => {
    const index = indexWithRun();
    assert.deepEqual(
      filterByPresence([exercised, declaredOnly, undeclared], index, [
        'exercised',
        'undeclared',
      ]).map((entry) => entry.id),
      ['agent:active', 'tool:outside'],
    );
  });

  it('matches nothing on a report with no run, because every component is in the fourth state', () => {
    const index = buildGraphIndex(
      bundle({ graph: { ...bundle().graph, components: [declaredOnly] } }),
    );
    assert.deepEqual(filterByPresence([declaredOnly], index, ['declared_only']), []);
  });
});

describe('countPresences', () => {
  it('counts every selectable presence, including the ones nothing is in', () => {
    const index = indexWithRun();
    const counts = countPresences([exercised, declaredOnly], index);
    assert.deepEqual(
      SELECTABLE_PRESENCES.map((presence: Presence) => counts.get(presence)),
      [1, 1, 0, 0],
    );
  });

  it('counts nothing into a selectable presence when no run exists', () => {
    const index = buildGraphIndex(
      bundle({ graph: { ...bundle().graph, components: [declaredOnly] } }),
    );
    const counts = countPresences([declaredOnly], index);
    assert.deepEqual(
      SELECTABLE_PRESENCES.map((presence: Presence) => counts.get(presence)),
      [0, 0, 0, 0],
    );
  });
});
