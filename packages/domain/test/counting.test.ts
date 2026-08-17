import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agree, formatCount } from '../src/counting.ts';

/**
 * Counting a thing and then continuing the sentence about it.
 *
 * A parenthesised `s` is what a program prints when it has decided the reader will do the grammar, and a
 * count that agrees with its noun and then disagrees with its verb is the same decision made halfway.
 * Both were reaching readers in the report a rule writes to explain what it decided not to say.
 */

describe('formatCount', () => {
  it('uses the singular for one and the plural for anything else', () => {
    assert.equal(formatCount(1, 'run'), '1 run');
    assert.equal(formatCount(0, 'run'), '0 runs');
    assert.equal(formatCount(2, 'run'), '2 runs');
  });

  it('takes an irregular plural rather than deriving one', () => {
    assert.equal(formatCount(2, 'retry', 'retries'), '2 retries');
    assert.equal(formatCount(1, 'retry', 'retries'), '1 retry');
  });
});

describe('agree', () => {
  it('picks the verb that goes with the count', () => {
    assert.equal(agree(1, 'was', 'were'), 'was');
    assert.equal(agree(2, 'was', 'were'), 'were');
    assert.equal(agree(0, 'was', 'were'), 'were');
  });

  it('reads correctly in the sentence it was written for', () => {
    for (const [count, expected] of [
      [1, '1 consequential operation was left unreported'],
      [3, '3 consequential operations were left unreported'],
    ] as const) {
      assert.equal(
        `${formatCount(count, 'consequential operation')} ${agree(count, 'was', 'were')} left unreported`,
        expected,
      );
    }
  });
});
