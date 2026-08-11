import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { joinRegion } from '../src/terminal/join-rows.ts';
import { reconciliation } from './audit-fixture.ts';

/**
 * The join, which is the thing no other tool computes.
 *
 * The two properties that matter are that the fraction is labelled for the declared set, and that the
 * region is absent rather than empty when no run has been recorded.
 */

const render = (delta: Parameters<typeof joinRegion>[0]): readonly string[] => {
  const layout = layoutFor(80);
  return joinRegion(delta).map((row) => renderRow(row, layout));
};

describe('when no run has been recorded', () => {
  /*
   * Absent, not empty. The measure step already prices the absence, names how many checks it blocks
   * and carries the command that lifts it, so a second copy here is one absence reported as two
   * faults. An empty region may not stand in for a refusal, so this region contributes no lines at all
   * and the refusal lives where a reader is already looking.
   */
  it('contributes no rows, and therefore no blank line either', () => {
    assert.deepEqual(render(undefined), []);
  });
});

describe('the fraction', () => {
  it('is labelled for the declared set, and carries no percentage', () => {
    assert.equal(
      render(reconciliation({}))[0],
      'join            14 of 21 declared components exercised',
    );
  });

  /*
   * A rate printed only when it flatters is worse than no rate. Three of nine hundred and fifty three
   * rounds to zero per cent, and the version that suppressed the rate there printed one everywhere
   * else, so the reader saw a number exactly when it was comfortable.
   */
  it('states the same form when the fraction rounds below one per cent', () => {
    const tiny = render(reconciliation({ exercised: 3, declared: 953 }));
    assert.equal(tiny[0], 'join            3 of 953 declared components exercised');
    assert.equal(
      tiny.some((line) => line.includes('percent')),
      false,
    );
  });

  it('states the same pair the finding text quotes', () => {
    assert.match(render(reconciliation({ exercised: 14, declared: 21 }))[0] ?? '', /14 of 21/);
  });
});

describe('the four deltas', () => {
  it('keeps the noun the product uses for each one everywhere else', () => {
    assert.deepEqual(render(reconciliation({})).slice(1), [
      'join            7 declared components never exercised',
      'join            1 exercised component never declared',
      'join            0 contradicted declarations',
      'join            1 duplicated external effect',
    ]);
  });

  /*
   * A zero here is as much news as a one: it is the difference between a contradiction nobody found
   * and a contradiction nobody looked for, and the reader can tell which only because this region
   * renders at all.
   */
  it('renders a delta of zero rather than leaving it out', () => {
    const none = render(
      reconciliation({ notExercised: 0, notDeclared: 0, contradictions: 0, duplicates: 0 }),
    );
    assert.equal(none.length, 5);
    assert.deepEqual(none.slice(1), [
      'join            0 declared components never exercised',
      'join            0 exercised components never declared',
      'join            0 contradicted declarations',
      'join            0 duplicated external effects',
    ]);
  });

  it('holds every row inside the width whatever the counts grow to', () => {
    const layout = layoutFor(80);
    const huge = joinRegion(
      reconciliation({ exercised: 1, declared: 999_999, notExercised: 999_998 }),
    ).map((row) => renderRow(row, layout));
    for (const line of huge) assert.ok(line.length <= 80, line);
  });
});
