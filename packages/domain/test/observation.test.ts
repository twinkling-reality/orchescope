import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunRecord } from '@orchescope/schema';
import { basisIsSupportable, runIsSilent, runMeasuredNothing } from '../src/observation.ts';

/**
 * The distinction the rest of the product is built on: a run happening is not a measurement.
 *
 * Every consumer of runs used to answer "was anything measured" by counting run records, and an
 * uninstrumented target makes those two answers disagree. These are the three sentences that hold them
 * apart, kept here because three layers depend on them meaning the same thing.
 */

const runWith = (metrics: Partial<RunRecord['metrics']>): RunRecord =>
  ({ id: 'run_0000000000000001', metrics }) as RunRecord;

describe('runIsSilent', () => {
  it('is true of a bundle with no span in it', () => {
    assert.equal(runIsSilent(0), true);
  });

  it('is false as soon as one span arrived', () => {
    assert.equal(runIsSilent(1), false);
  });
});

describe('basisIsSupportable', () => {
  it('refuses an observed claim when nothing was observed', () => {
    assert.equal(basisIsSupportable('observed', 0), false);
  });

  it('allows an observed claim once something was', () => {
    assert.equal(basisIsSupportable('observed', 1), true);
  });

  /*
   * Only `observed` asserts that a machine watched it happen. The weaker bases already say where they
   * came from, and a static audit with no runs on record is the ordinary case rather than a defect.
   */
  it('leaves every weaker basis alone', () => {
    for (const basis of ['discovered', 'inferred', 'estimated', 'simulated'] as const) {
      assert.equal(basisIsSupportable(basis, 0), true, `${basis} needs no observation`);
    }
  });
});

describe('runMeasuredNothing', () => {
  it('is true when no span arrived and the target reported no outcome', () => {
    assert.equal(runMeasuredNothing({ run: runWith({}), spanCount: 0 }), true);
  });

  it('is false once a span arrived', () => {
    assert.equal(runMeasuredNothing({ run: runWith({}), spanCount: 1 }), false);
  });

  /*
   * The target result document exists so a system with no tracing at all can still be evaluated. A run
   * measured only that way is still a measurement, and dropping it would lose real evidence.
   */
  it('is false when the target reported its own outcome without any span', () => {
    assert.equal(runMeasuredNothing({ run: runWith({ taskSuccess: false }), spanCount: 0 }), false);
  });
});
