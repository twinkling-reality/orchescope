/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Finding } from '@orchescope/schema';
import { buildFindingMix, buildFindingMixes } from '../src/presentation/finding-mix.ts';
import { finding } from './fixture.ts';

const risks = [
  finding({ id: 'OSC-A', severity: 'medium' }),
  finding({ id: 'OSC-B', severity: 'high' }),
  finding({ id: 'OSC-C', severity: 'medium' }),
  finding({ id: 'OSC-D', severity: 'low' }),
];

describe('buildFindingMix', () => {
  it('counts one side of the split and breaks it down worst first', () => {
    const mix = buildFindingMix(risks, 'risk');
    assert.equal(mix.total, 4);
    assert.deepEqual(
      mix.slices.map((slice) => [slice.label, slice.count]),
      [
        ['High', 1],
        ['Medium', 2],
        ['Low', 1],
      ],
    );
    assert.equal(mix.slices[0]?.share, 0.25);
  });

  it('leaves out a severity nothing falls into rather than drawing it at zero width', () => {
    const mix = buildFindingMix(risks, 'risk');
    assert.equal(
      mix.slices.some((slice) => slice.count === 0),
      false,
    );
    // The slices have to add up to the number above them, or the picture disagrees with the count.
    assert.equal(
      mix.slices.reduce((sum, slice) => sum + slice.count, 0),
      mix.total,
    );
  });

  it('counts a severity this build does not rank rather than dropping it', () => {
    // A bundle written by a build that ranks a severity this one does not. The schema is a closed set
    // here, so the case is constructed rather than declared.
    const unranked = {
      ...finding({ id: 'OSC-E' }),
      severity: 'catastrophic',
    } as unknown as Finding;
    const mix = buildFindingMix([...risks, unranked], 'risk');
    assert.equal(mix.total, 5);
    assert.equal(
      mix.slices.reduce((sum, slice) => sum + slice.count, 0),
      5,
    );
    assert.equal(mix.slices.at(-1)?.label, 'catastrophic');
  });

  it('names the one to look at first, worst and readiest first', () => {
    assert.equal(buildFindingMix(risks, 'risk').worst?.id, 'OSC-B');
  });

  it('builds an empty side without inventing anything', () => {
    // The control that switches sides has to know whether the other side holds anything before a
    // reader presses it, so both sides are always built, including the empty one.
    const mix = buildFindingMix(risks, 'strength');
    assert.equal(mix.total, 0);
    assert.deepEqual(mix.slices, []);
    assert.equal(mix.worst, null);
    assert.equal(mix.ready, 0);
  });
});

describe('buildFindingMixes', () => {
  it('splits one list into the good news and the bad', () => {
    const mixes = buildFindingMixes([
      ...risks,
      finding({ id: 'OSC-S', severity: 'info', polarity: 'strength' }),
    ]);
    assert.equal(mixes.risk.total, 4);
    assert.equal(mixes.strength.total, 1);
    assert.equal(mixes.strength.worst?.id, 'OSC-S');
  });

  it('reports both sides empty on a report that found nothing at all', () => {
    const mixes = buildFindingMixes([]);
    assert.equal(mixes.risk.total, 0);
    assert.equal(mixes.strength.total, 0);
  });
});
