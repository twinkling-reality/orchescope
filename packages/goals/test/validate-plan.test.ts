import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  AcceptanceCriterion,
  Comparison,
  ComparisonSide,
  Goal,
  ScenarioResult,
} from '@orchescope/schema';
import { validateGoal } from '../src/validate-plan.ts';

/**
 * Goal validation tests.
 *
 * This is the end of the loop the product exists for: a finding became a goal, a change was made, and something has
 * to decide whether it worked. The rule under test throughout is that evidence which cannot decide a criterion
 * leaves it undecided. A criterion reported as satisfied on evidence that predates the change would validate a goal
 * against its own baseline, which is worse than reporting nothing.
 */

const criterion = (id: string, check: AcceptanceCriterion['check']): AcceptanceCriterion => ({
  id,
  statement: `criterion ${id}`,
  check,
});

/** validateGoal reads the criteria, the creation time and the reviews; the rest is not consulted. */
const goalWith = (
  criteria: readonly AcceptanceCriterion[],
  createdAt: string,
  reviews: readonly { at: string; note: string }[] = [],
): Goal =>
  ({
    acceptanceCriteria: criteria,
    createdAt,
    reviews,
  }) as Goal;

/**
 * The evaluator results are part of what the judge reads: a scenario whose evaluators decided nothing
 * cannot decide the criterion either, so a repetition here carries the list even when it is empty.
 */
const scenarioResult = (
  scenarioId: string,
  startedAt: string,
  passed: boolean,
  evaluators: readonly { kind: string; passed: boolean; skipped?: true }[] = [],
): ScenarioResult =>
  ({
    scenarioId,
    startedAt,
    passed,
    repetitions: [{ evaluators }, { evaluators }, { evaluators }],
  }) as unknown as ScenarioResult;

const input = (overrides: {
  readonly scenarioResults?: readonly ScenarioResult[];
  readonly comparison?: Comparison;
  readonly findingStillPresent?: ReadonlySet<string>;
  readonly rescanned?: boolean;
}) => ({
  comparison: overrides.comparison,
  scenarioResults: overrides.scenarioResults ?? [],
  findingStillPresent: overrides.findingStillPresent ?? new Set<string>(),
  rescanned: overrides.rescanned ?? true,
});

const GOAL_CREATED = '2026-07-25T12:00:00.000Z';
const BEFORE = '2026-07-25T11:00:00.000Z';
const AFTER = '2026-07-25T13:00:00.000Z';
const LATER = '2026-07-25T14:00:00.000Z';

const scenarioGoal = goalWith(
  [criterion('AC-01', { kind: 'scenario_passes', scenarioId: 'support-desk' })],
  GOAL_CREATED,
);

describe('validateGoal, scenario criteria', () => {
  it('decides a criterion from a run of the scenario made after the goal existed', () => {
    const validation = validateGoal(
      scenarioGoal,
      input({ scenarioResults: [scenarioResult('support-desk', AFTER, true)] }),
    );
    assert.equal(validation.outcomes[0]?.decided, true);
    assert.equal(validation.outcomes[0]?.satisfied, true);
    assert.equal(validation.validated, true);
    assert.match(validation.outcomes[0]?.detail ?? '', /passed over 3 repetition/);
  });

  it('reports a failing scenario as decided and not satisfied', () => {
    const validation = validateGoal(
      scenarioGoal,
      input({ scenarioResults: [scenarioResult('support-desk', AFTER, false)] }),
    );
    assert.equal(validation.outcomes[0]?.decided, true);
    assert.equal(validation.outcomes[0]?.satisfied, false);
    assert.equal(validation.validated, false);
  });

  /*
   * A run that answered nothing is not a run that failed. Reporting it as a failure tells an operator
   * their change broke something, when what happened is that the scenario asked a question the run could
   * not answer, which is the reading error this module exists to prevent.
   */
  it('leaves the criterion undecided when the run decided nothing', () => {
    const validation = validateGoal(
      scenarioGoal,
      input({
        scenarioResults: [
          scenarioResult('support-desk', AFTER, false, [
            { kind: 'model_judge', passed: false, skipped: true },
          ]),
        ],
      }),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.equal(validation.outcomes[0]?.satisfied, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /decided nothing: model_judge/);
    assert.match(validation.summary, /cannot judge/);
  });

  it('leaves the criterion undecided when the scenario was never run', () => {
    const validation = validateGoal(scenarioGoal, input({}));
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /was not run/);
  });

  it('refuses to judge a change against a run that predates the goal', () => {
    const validation = validateGoal(
      scenarioGoal,
      input({ scenarioResults: [scenarioResult('support-desk', BEFORE, true)] }),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.equal(validation.outcomes[0]?.satisfied, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /before this goal was created/);
  });

  it('judges the newest eligible run when several are stored', () => {
    const validation = validateGoal(
      scenarioGoal,
      input({
        scenarioResults: [
          scenarioResult('support-desk', AFTER, false),
          scenarioResult('support-desk', LATER, true),
          scenarioResult('support-desk', BEFORE, false),
        ],
      }),
    );
    assert.equal(validation.outcomes[0]?.satisfied, true);
  });

  it('ignores a result belonging to a different scenario', () => {
    const validation = validateGoal(
      scenarioGoal,
      input({ scenarioResults: [scenarioResult('other-scenario', AFTER, true)] }),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /was not run/);
  });
});

describe('validateGoal, criteria nothing here can decide', () => {
  it('never claims a command it did not run succeeded', () => {
    const validation = validateGoal(
      goalWith(
        [criterion('AC-01', { kind: 'command_succeeds', command: ['pnpm', 'test'] })],
        GOAL_CREATED,
      ),
      input({}),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.equal(validation.validated, false);
  });

  it('never claims a review happened that nobody recorded', () => {
    const validation = validateGoal(
      goalWith(
        [criterion('AC-01', { kind: 'manual_review', instruction: 'read it' })],
        GOAL_CREATED,
      ),
      input({}),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /no review has been recorded/);
  });

  /*
   * The one term nothing in a run decides. Until an act recorded it, a goal cut from a finding that
   * needs a review could never reach `validated` whatever anyone did, which made the criterion a
   * permanent block dressed as a requirement.
   */
  it('decides the review criterion from what was recorded, and says what it read', () => {
    const validation = validateGoal(
      goalWith(
        [criterion('AC-01', { kind: 'manual_review', instruction: 'read it' })],
        GOAL_CREATED,
        [{ at: AFTER, note: 'checked the idempotency key reaches the retry' }],
      ),
      input({}),
    );
    assert.equal(validation.outcomes[0]?.decided, true);
    assert.equal(validation.outcomes[0]?.satisfied, true);
    assert.equal(validation.validated, true);
    // What it read, not that a person did it: nothing here authenticates anybody.
    assert.match(validation.outcomes[0]?.detail ?? '', /a review was recorded at/);
    assert.match(validation.outcomes[0]?.detail ?? '', /idempotency key reaches the retry/);
  });

  /* The same staleness guard the scenario criterion carries: a review of the old code decides nothing. */
  it('refuses a review recorded before the goal existed', () => {
    const validation = validateGoal(
      goalWith(
        [criterion('AC-01', { kind: 'manual_review', instruction: 'read it' })],
        GOAL_CREATED,
        [{ at: BEFORE, note: 'looked at it last week' }],
      ),
      input({}),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /predates this goal/);
  });

  it('leaves a finding criterion undecided until a rescan has happened', () => {
    const validation = validateGoal(
      goalWith(
        [criterion('AC-01', { kind: 'finding_resolved', findingId: 'OSC-REL-0003' })],
        GOAL_CREATED,
      ),
      input({ rescanned: false }),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /no rescan/);
  });
});

/**
 * A metric criterion judged against a comparison that measured nothing.
 *
 * `duplicateSideEffects moved from 0 to 0 and was judged unchanged` was reported as SATISFIED on a pair
 * of runs neither of which produced a span. Both zeros were the absence of a measurement, and the
 * criterion banked a result it never earned. The successRate criterion beside it, whose value was
 * genuinely missing rather than fabricated, reported undecided, which is the behaviour this borrows.
 */
describe('validateGoal, metric criteria against evidence that cannot decide', () => {
  /*
   * The two sides are supplied because a real comparison always carries them, and what they say about the
   * work each side did is now part of what a metric criterion is allowed to be decided from. A fixture
   * that omitted them was asserting against a document the product cannot produce.
   */
  const side = (
    label: string,
    conditions: Partial<Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'>> = {
      scenarioId: 'support-desk',
    },
  ): ComparisonSide => ({
    kind: 'run',
    reference: `run_000000000000000${label === 'baseline' ? '1' : '2'}`,
    label,
    runIds: [`run_000000000000000${label === 'baseline' ? '1' : '2'}`],
    ...conditions,
  });

  const comparisonWith = (
    deltas: readonly Comparison['metricDeltas'][number][],
    sides?: {
      readonly baseline: Partial<Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'>>;
      readonly candidate: Partial<Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'>>;
    },
  ): Comparison =>
    ({
      metricDeltas: deltas,
      baseline: side('baseline', sides?.baseline),
      candidate: side('candidate', sides?.candidate),
    }) as Comparison;

  const notWorseGoal = goalWith(
    [
      criterion('AC-01', {
        kind: 'metric_not_worse',
        metric: 'duplicateSideEffects',
        tolerance: 0,
      }),
    ],
    GOAL_CREATED,
  );

  it('leaves the criterion undecided when the comparison carries no values for the metric', () => {
    const validation = validateGoal(notWorseGoal, input({ comparison: comparisonWith([]) }));
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.equal(validation.outcomes[0]?.satisfied, false);
    assert.equal(validation.validated, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /carries no values/);
  });

  /*
   * An indeterminate direction is the comparison saying out loud that the samples do not support a
   * claim. Counting that as satisfied inverted the meaning of the strongest sentence the comparison
   * has, and let a goal reach `validated` with an undecided criterion inside it.
   */
  it('does not count an indeterminate direction as satisfied', () => {
    const validation = validateGoal(
      notWorseGoal,
      input({
        comparison: comparisonWith([
          {
            metric: 'duplicateSideEffects',
            unit: 'count',
            baseline: 0,
            candidate: 0,
            baselineSamples: 1,
            candidateSamples: 1,
            direction: 'indeterminate',
            caveat: 'one side has no samples',
          },
        ]),
      }),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.equal(validation.outcomes[0]?.satisfied, false);
    assert.equal(validation.validated, false);
  });

  it('still satisfies the criterion when the metric was measured and held', () => {
    const validation = validateGoal(
      notWorseGoal,
      input({
        comparison: comparisonWith([
          {
            metric: 'duplicateSideEffects',
            unit: 'count',
            baseline: 2,
            candidate: 0,
            baselineSamples: 5,
            candidateSamples: 5,
            direction: 'improved',
          },
        ]),
      }),
    );
    assert.equal(validation.outcomes[0]?.decided, true);
    assert.equal(validation.outcomes[0]?.satisfied, true);
    assert.equal(validation.validated, true);
  });

  it('reports a regression as decided and not satisfied', () => {
    const validation = validateGoal(
      notWorseGoal,
      input({
        comparison: comparisonWith([
          {
            metric: 'duplicateSideEffects',
            unit: 'count',
            baseline: 0,
            candidate: 2,
            baselineSamples: 5,
            candidateSamples: 5,
            direction: 'regressed',
          },
        ]),
      }),
    );
    assert.equal(validation.outcomes[0]?.decided, true);
    assert.equal(validation.outcomes[0]?.satisfied, false);
  });
});

/**
 * A metric criterion judged against a comparison of two different things.
 *
 * This is the layer that protects the verdict, because it is the only one an operator typing commands by
 * hand cannot route around. Selection will not prescribe such a pair and the comparison records the
 * difference when one is made anyway, but neither of those stops a stored comparison from being read back
 * and believed. Measured on the demonstration system before this existed: a plan followed verbatim
 * compared one scenario against another running under injected faults, and the success rate criterion
 * banked `1 -> 0 regressed` against an operator who had changed nothing.
 */
/**
 * What weakened a number has to reach whoever reads the verdict.
 *
 * Measured on a real repository through the real command line: an unchanged system reported
 * `durationMs.p95 changed by -15.3 percent against a required 15 percent` and the criterion was banked,
 * while the mean of the very same three runs was judged indeterminate at 1.2 times the combined standard
 * error. The delta said why the tail claim was weaker and the goal document was where that sentence was
 * dropped, so the one surface a coding agent reads presented an order statistic of three runs as a
 * measured fifteen percent win.
 */
describe('validateGoal, what a metric criterion says its answer rests on', () => {
  const withCaveat = (caveat?: string): Comparison =>
    ({
      metricDeltas: [
        {
          metric: 'durationMs.p95',
          unit: 'ms',
          baseline: 2176,
          candidate: 1842,
          relativeChange: -0.1535,
          baselineSamples: 3,
          candidateSamples: 3,
          direction: 'improved',
          ...(caveat === undefined ? {} : { caveat }),
        },
      ],
      baseline: {
        kind: 'run',
        reference: 'run_0000000000000001',
        label: 'baseline',
        runIds: ['run_0000000000000001'],
        scenarioId: 'flight-status',
      },
      candidate: {
        kind: 'run',
        reference: 'run_0000000000000002',
        label: 'candidate',
        runIds: ['run_0000000000000002'],
        scenarioId: 'flight-status',
      },
    }) as Comparison;

  const improvementGoal = goalWith(
    [
      criterion('AC-01', {
        kind: 'metric_improvement',
        metric: 'durationMs.p95',
        comparator: 'lt',
        relativeThreshold: 0.15,
      }),
    ],
    GOAL_CREATED,
  );

  it('carries the caveat that weakened the number into the criterion it decided', () => {
    const validation = validateGoal(
      improvementGoal,
      input({
        comparison: withCaveat(
          'compared as order statistics of the runs on each side, without a spread test',
        ),
      }),
    );
    assert.equal(validation.outcomes[0]?.decided, true);
    assert.equal(validation.outcomes[0]?.satisfied, true);
    assert.match(validation.outcomes[0]?.detail ?? '', /without a spread test/);
  });

  /* The claim is still decided: gating a tail on a test of means is what this module already refuses. */
  it('adds nothing when the comparison carried no caveat, and still reports the samples', () => {
    const validation = validateGoal(improvementGoal, input({ comparison: withCaveat() }));
    assert.equal(validation.outcomes[0]?.decided, true);
    assert.doesNotMatch(validation.outcomes[0]?.detail ?? '', /spread test/);
    assert.match(validation.outcomes[0]?.detail ?? '', /samples 3 and 3/);
  });
});

describe('validateGoal, metric criteria across conditions that differ', () => {
  const conditioned = (
    baseline: Partial<Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'>>,
    candidate: Partial<Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'>>,
  ): Comparison =>
    ({
      metricDeltas: [
        {
          metric: 'successRate',
          unit: 'fraction',
          baseline: 1,
          candidate: 0,
          baselineSamples: 3,
          candidateSamples: 3,
          direction: 'regressed',
        },
      ],
      baseline: {
        kind: 'run',
        reference: 'run_0000000000000001',
        label: 'baseline',
        runIds: ['run_0000000000000001'],
        ...baseline,
      },
      candidate: {
        kind: 'run',
        reference: 'run_0000000000000002',
        label: 'candidate',
        runIds: ['run_0000000000000002'],
        ...candidate,
      },
    }) as Comparison;

  const successGoal = goalWith(
    [criterion('AC-01', { kind: 'metric_not_worse', metric: 'successRate', tolerance: 0 })],
    GOAL_CREATED,
  );

  it('leaves the criterion undecided when the two sides ran different scenarios', () => {
    const validation = validateGoal(
      successGoal,
      input({
        comparison: conditioned(
          { scenarioId: 'support-desk' },
          { scenarioId: 'support-desk-faults' },
        ),
      }),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.equal(validation.outcomes[0]?.satisfied, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /did not measure the same work twice/);
  });

  it('leaves it undecided when only one side ran under an injected fault plan', () => {
    const validation = validateGoal(
      successGoal,
      input({
        comparison: conditioned(
          { scenarioId: 'support-desk' },
          { scenarioId: 'support-desk', faultPlanId: 'fp_injected' },
        ),
      }),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
    assert.match(validation.outcomes[0]?.detail ?? '', /injected fault plan/);
  });

  /* The refusal is about the conditions and not about the answer: like against like still decides. */
  it('decides the criterion when the two sides ran the same work', () => {
    const validation = validateGoal(
      successGoal,
      input({
        comparison: conditioned(
          { scenarioId: 'support-desk', faultPlanId: 'fp_same' },
          { scenarioId: 'support-desk', faultPlanId: 'fp_same' },
        ),
      }),
    );
    assert.equal(validation.outcomes[0]?.decided, true);
    assert.equal(validation.outcomes[0]?.satisfied, false);
  });
});

describe('validateGoal, the whole goal', () => {
  /*
   * The module's own contract, which the arithmetic did not keep: `satisfied` was computed independently
   * of `decided`, so a goal could carry an undecided criterion and still report itself validated.
   */
  it('cannot be validated while a criterion is undecided', () => {
    const validation = validateGoal(
      goalWith(
        [
          criterion('AC-01', { kind: 'finding_resolved', findingId: 'OSC-REL-0003' }),
          criterion('AC-02', {
            kind: 'metric_not_worse',
            metric: 'duplicateSideEffects',
            tolerance: 0,
          }),
        ],
        GOAL_CREATED,
      ),
      input({
        comparison: {
          metricDeltas: [
            {
              metric: 'duplicateSideEffects',
              unit: 'count',
              baseline: 0,
              candidate: 0,
              baselineSamples: 1,
              candidateSamples: 1,
              direction: 'indeterminate',
              caveat: 'one side has no samples',
            },
          ],
          // Both sides ran the same scenario, so what leaves the criterion undecided is the direction.
          baseline: {
            kind: 'run',
            reference: 'run_0000000000000001',
            label: 'baseline',
            runIds: ['run_0000000000000001'],
            scenarioId: 'support-desk',
          },
          candidate: {
            kind: 'run',
            reference: 'run_0000000000000002',
            label: 'candidate',
            runIds: ['run_0000000000000002'],
            scenarioId: 'support-desk',
          },
        } as Comparison,
      }),
    );
    assert.equal(validation.satisfiedCount, 1);
    assert.equal(validation.undecidedCount, 1);
    assert.equal(validation.validated, false);
  });

  it('is validated only when every criterion is satisfied', () => {
    const goal = goalWith(
      [
        criterion('AC-01', { kind: 'scenario_passes', scenarioId: 'support-desk' }),
        criterion('AC-02', { kind: 'finding_resolved', findingId: 'OSC-REL-0003' }),
      ],
      GOAL_CREATED,
    );
    const stillFiring = validateGoal(
      goal,
      input({
        scenarioResults: [scenarioResult('support-desk', AFTER, true)],
        findingStillPresent: new Set(['OSC-REL-0003']),
      }),
    );
    assert.equal(stillFiring.validated, false);
    assert.equal(stillFiring.satisfiedCount, 1);

    const resolved = validateGoal(
      goal,
      input({ scenarioResults: [scenarioResult('support-desk', AFTER, true)] }),
    );
    assert.equal(resolved.validated, true);
    assert.equal(resolved.undecidedCount, 0);
    assert.match(resolved.summary, /2 acceptance criteria are satisfied/);
  });
});

/**
 * What is left, in the words of why it is left.
 *
 * "1 of 2 criteria satisfied, 1 undecided" said the same thing about a criterion that failed, one
 * nothing could judge, and one waiting for a person to look. Only the first is a reason to think the
 * change did not work, and reading the other two as failure is what makes an operator who did
 * everything the goal asked believe they did not.
 */
describe('what a validation says is outstanding', () => {
  it('separates a person from a failure', () => {
    const goal = goalWith(
      [
        criterion('AC-01', { kind: 'finding_resolved', findingId: 'OSC-REL-0003' }),
        criterion('AC-02', { kind: 'manual_review', instruction: 'look at it' }),
      ],
      GOAL_CREATED,
    );
    const validation = validateGoal(goal, input({}));
    assert.equal(validation.validated, false);
    assert.match(validation.summary, /1 waiting for a person to record a review/);
    assert.doesNotMatch(validation.summary, /failed/);
  });

  it('says a criterion failed when one did', () => {
    const goal = goalWith(
      [criterion('AC-01', { kind: 'finding_resolved', findingId: 'OSC-REL-0003' })],
      GOAL_CREATED,
    );
    const validation = validateGoal(
      goal,
      input({ findingStillPresent: new Set(['OSC-REL-0003']) }),
    );
    assert.match(validation.summary, /1 failed/);
    assert.doesNotMatch(validation.summary, /waiting for a person/);
  });

  it('says so when the evidence here cannot judge one', () => {
    const goal = goalWith(
      [criterion('AC-01', { kind: 'metric_not_worse', metric: 'successRate', tolerance: 0 })],
      GOAL_CREATED,
    );
    assert.match(validateGoal(goal, input({})).summary, /1 that the evidence here cannot judge/);
  });
});
