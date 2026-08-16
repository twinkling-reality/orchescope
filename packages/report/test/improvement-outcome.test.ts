import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReportBundle } from '@orchescope/schema';
import { improvementOutcome } from '../src/improvement-outcome.ts';

/**
 * "Did the last change help", answered from a bundle and nothing else.
 *
 * The contract this holds is that a refusal is never reported as a result. `unchanged` and
 * `insufficient_evidence` carry a verdict string, so a caller that branched on the string alone would
 * treat both as answers; `decided` is the field that keeps them apart, and it is the one every surface
 * reads.
 */

const bundle = (over: {
  readonly comparisons?: readonly unknown[];
  readonly goalValidations?: readonly unknown[];
}): ReportBundle =>
  ({
    comparisons: over.comparisons ?? [],
    ...(over.goalValidations === undefined ? {} : { goalValidations: over.goalValidations }),
  }) as unknown as ReportBundle;

const comparison = (verdict: string, verdictReason = 'because') => ({
  id: 'cmp_1',
  verdict,
  verdictReason,
});

const validation = (over: {
  readonly goalId: string;
  readonly validated: boolean;
  readonly outcomes?: readonly { readonly satisfied: boolean; readonly detail: string }[];
}) => ({
  goalId: over.goalId,
  validated: over.validated,
  satisfiedCount: 3,
  undecidedCount: 0,
  summary: '3 of 5 criteria satisfied, 0 undecided',
  comparisonId: 'cmp_1',
  outcomes: over.outcomes ?? [],
});

describe('a verdict the comparison was willing to call', () => {
  it('reports an improvement as decided', () => {
    const outcome = improvementOutcome(
      bundle({ comparisons: [comparison('improved', 'it held')] }),
    );
    assert.equal(outcome.decided, true);
    assert.equal(outcome.verdict, 'improved');
    assert.equal(outcome.comparisonId, 'cmp_1');
    assert.equal(outcome.summary, 'improved: it held');
  });

  it('reports a regression as decided, so it is never mistaken for silence', () => {
    const outcome = improvementOutcome(bundle({ comparisons: [comparison('regressed')] }));
    assert.equal(outcome.decided, true);
    assert.equal(outcome.verdict, 'regressed');
  });
});

describe('a verdict the comparison refused', () => {
  it('keeps unchanged and insufficient evidence out of the decided set', () => {
    for (const verdict of ['unchanged', 'mixed', 'insufficient_evidence']) {
      const outcome = improvementOutcome(bundle({ comparisons: [comparison(verdict)] }));
      assert.equal(outcome.decided, false, verdict);
      assert.equal(outcome.verdict, verdict);
    }
  });

  it('says plainly when nothing has ever been compared', () => {
    const outcome = improvementOutcome(bundle({}));
    assert.deepEqual(
      { decided: outcome.decided, verdict: outcome.verdict, id: outcome.comparisonId },
      { decided: false, verdict: null, id: null },
    );
    assert.equal(outcome.summary, 'nothing has been compared, so no change has been measured');
  });
});

describe('the goals that comparison judged', () => {
  it('puts the goal a caller has to act on first, and names what blocked it', () => {
    const outcome = improvementOutcome(
      bundle({
        comparisons: [comparison('improved')],
        goalValidations: [
          validation({ goalId: 'OSC-GOAL-0002', validated: true }),
          validation({
            goalId: 'OSC-GOAL-0001',
            validated: false,
            outcomes: [
              { satisfied: true, detail: 'this one held' },
              { satisfied: false, detail: 'the finding still fires after the rescan' },
            ],
          }),
        ],
      }),
    );
    assert.deepEqual(
      outcome.goals.map((goal) => goal.goalId),
      ['OSC-GOAL-0001', 'OSC-GOAL-0002'],
    );
    assert.deepEqual(outcome.goals[0]?.blockedBy, ['the finding still fires after the rescan']);
    assert.deepEqual(outcome.goals[1]?.blockedBy, []);
    assert.equal(outcome.summary, 'improved: because; 1 of 2 goals validated');
  });

  it('bounds the blocking reasons rather than returning a report', () => {
    const outcome = improvementOutcome(
      bundle({
        comparisons: [comparison('regressed')],
        goalValidations: [
          validation({
            goalId: 'OSC-GOAL-0001',
            validated: false,
            outcomes: Array.from({ length: 9 }, (_value, index) => ({
              satisfied: false,
              detail: `blocker ${index}`,
            })),
          }),
        ],
      }),
    );
    assert.equal(outcome.goals[0]?.blockedBy.length, 3);
  });
});
