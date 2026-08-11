/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fractionOf } from '../src/presentation/fraction.ts';

describe('fractionOf', () => {
  it('states the share and what is left of it', () => {
    const fraction = fractionOf(14, 21);
    assert.equal(fraction.done, 14);
    assert.equal(fraction.total, 21);
    assert.equal(fraction.remaining, 7);
    assert.equal(fraction.percent, '67%');
  });

  it('refuses a share when the total is zero rather than reporting nought per cent', () => {
    // `orchescope-discovery` finds nothing at all. Nought of nought is a question with no answer, and a
    // bar drawn at empty there would say a thing was measured and found wanting.
    const fraction = fractionOf(0, 0);
    assert.equal(fraction.share, null);
    assert.equal(fraction.percent, null);
    assert.equal(fraction.total, 0);
  });

  it('reaches a whole hundred only when nothing is left', () => {
    assert.equal(fractionOf(23, 23).percent, '100%');
    assert.equal(fractionOf(23, 23).remaining, 0);
    assert.equal(fractionOf(0, 23).percent, '0%');
    assert.equal(fractionOf(0, 23).remaining, 23);
  });

  it('rounds the share and never the counts', () => {
    const fraction = fractionOf(1, 3);
    assert.equal(fraction.percent, '33%');
    assert.equal(fraction.done, 1);
    assert.equal(fraction.total, 3);
  });

  it('caps a count larger than its own total without hiding it', () => {
    // The share is capped so the bar cannot overflow its track, and the counts are left alone so the
    // disagreement is visible rather than quietly corrected.
    const fraction = fractionOf(9, 4);
    assert.equal(fraction.share, 1);
    assert.equal(fraction.remaining, 0);
  });

  it('refuses a negative or non finite count rather than drawing it', () => {
    assert.equal(fractionOf(-3, 10).done, 0);
    assert.equal(fractionOf(Number.NaN, 10).done, 0);
    assert.equal(fractionOf(5, Number.POSITIVE_INFINITY).share, null);
  });
});
