import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AcceptanceCriterion, Comparison, Goal, ScenarioResult } from '@orchescope/schema';
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

/** validateGoal reads the criteria and the creation time; the rest of the document is not consulted. */
const goalWith = (criteria: readonly AcceptanceCriterion[], createdAt: string): Goal =>
  ({
    acceptanceCriteria: criteria,
    createdAt,
  }) as Goal;

const scenarioResult = (scenarioId: string, startedAt: string, passed: boolean): ScenarioResult =>
  ({
    scenarioId,
    startedAt,
    passed,
    repetitions: [{}, {}, {}],
  }) as ScenarioResult;

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

  it('never claims a human reviewed something', () => {
    const validation = validateGoal(
      goalWith(
        [criterion('AC-01', { kind: 'manual_review', instruction: 'read it' })],
        GOAL_CREATED,
      ),
      input({}),
    );
    assert.equal(validation.outcomes[0]?.decided, false);
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
  const comparisonWith = (deltas: readonly Comparison['metricDeltas'][number][]): Comparison =>
    ({ metricDeltas: deltas }) as Comparison;

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
    assert.match(resolved.summary, /all 2 acceptance criteria are satisfied/);
  });
});
