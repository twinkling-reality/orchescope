import type { AcceptanceCriterion, Comparison, Goal, ScenarioResult } from '@orchescope/schema';

/**
 * Evaluation of a goal's acceptance criteria against what a comparison and the validation runs actually
 * measured.
 *
 * The rule that matters: a criterion the evidence cannot decide is reported as undecided, not as satisfied.
 * A goal is only validated when every criterion is satisfied, so an undecided criterion blocks the claim.
 */

export type CriterionOutcome = {
  readonly criterion: AcceptanceCriterion;
  readonly satisfied: boolean;
  readonly decided: boolean;
  readonly detail: string;
};

export type GoalValidation = {
  readonly outcomes: readonly CriterionOutcome[];
  readonly satisfiedCount: number;
  readonly undecidedCount: number;
  readonly validated: boolean;
  readonly summary: string;
};

const metricDelta = (comparison: Comparison, metric: string) =>
  comparison.metricDeltas.find((delta) => delta.metric === metric);

type CriterionInput = {
  readonly comparison: Comparison | undefined;
  readonly scenarioResults: readonly ScenarioResult[];
  readonly findingStillPresent: ReadonlySet<string>;
  readonly rescanned: boolean;
};

const undecided = (criterion: AcceptanceCriterion, detail: string): CriterionOutcome => ({
  criterion,
  satisfied: false,
  decided: false,
  detail,
});

const metricImprovementOutcome = (
  criterion: AcceptanceCriterion,
  check: Extract<AcceptanceCriterion['check'], { kind: 'metric_improvement' }>,
  comparison: Comparison | undefined,
): CriterionOutcome => {
  if (comparison === undefined) return undecided(criterion, 'no comparison was recorded');
  const delta = metricDelta(comparison, check.metric);
  if (delta === undefined || delta.relativeChange === undefined) {
    return undecided(criterion, `the comparison carries no relative change for ${check.metric}`);
  }
  const threshold = check.relativeThreshold;
  if (threshold === undefined) {
    return {
      criterion,
      satisfied: check.comparator === 'lt' ? delta.relativeChange < 0 : delta.relativeChange > 0,
      decided: true,
      detail: `${check.metric} changed by ${(delta.relativeChange * 100).toFixed(1)} percent`,
    };
  }
  const satisfied =
    check.comparator === 'lt' || check.comparator === 'lte'
      ? delta.relativeChange <= -threshold
      : delta.relativeChange >= threshold;
  return {
    criterion,
    satisfied,
    decided: true,
    detail: `${check.metric} changed by ${(delta.relativeChange * 100).toFixed(1)} percent against a required ${(threshold * 100).toFixed(0)} percent (samples ${delta.baselineSamples} and ${delta.candidateSamples})`,
  };
};

/**
 * Direction matters for a "not worse" criterion: a lower success rate is worse, a lower duplicate count is better. The
 * comparison already resolved direction, so it is used rather than guessed at again here.
 */
const metricNotWorseOutcome = (
  criterion: AcceptanceCriterion,
  check: Extract<AcceptanceCriterion['check'], { kind: 'metric_not_worse' }>,
  comparison: Comparison | undefined,
): CriterionOutcome => {
  if (comparison === undefined) return undecided(criterion, 'no comparison was recorded');
  const delta = metricDelta(comparison, check.metric);
  if (delta === undefined || delta.baseline === undefined || delta.candidate === undefined) {
    return undecided(criterion, `the comparison carries no values for ${check.metric}`);
  }
  const worse = delta.candidate > delta.baseline + check.tolerance;
  const better = delta.candidate < delta.baseline - check.tolerance;
  return {
    criterion,
    satisfied: delta.direction === 'regressed' ? false : !(worse && better),
    decided: delta.direction !== 'indeterminate',
    detail: `${check.metric} moved from ${delta.baseline} to ${delta.candidate} and was judged ${delta.direction}${delta.caveat === undefined ? '' : ` (${delta.caveat})`}`,
  };
};

const scenarioPassesOutcome = (
  criterion: AcceptanceCriterion,
  check: Extract<AcceptanceCriterion['check'], { kind: 'scenario_passes' }>,
  results: readonly ScenarioResult[],
): CriterionOutcome => {
  const result = results.find((entry) => entry.scenarioId === check.scenarioId);
  if (result === undefined) {
    return undecided(criterion, `scenario ${check.scenarioId} was not run`);
  }
  return {
    criterion,
    satisfied: result.passed,
    decided: true,
    detail: `scenario ${check.scenarioId} ${result.passed ? 'passed' : 'failed'} over ${result.repetitions.length} repetition(s)`,
  };
};

const findingResolvedOutcome = (
  criterion: AcceptanceCriterion,
  check: Extract<AcceptanceCriterion['check'], { kind: 'finding_resolved' }>,
  input: CriterionInput,
): CriterionOutcome => {
  if (!input.rescanned) return undecided(criterion, 'no rescan was performed');
  const present = input.findingStillPresent.has(check.findingId);
  return {
    criterion,
    satisfied: !present,
    decided: true,
    detail: present
      ? `${check.findingId} still fires after the rescan`
      : `${check.findingId} no longer fires`,
  };
};

/**
 * Judges one criterion.
 *
 * Two of the kinds are deliberately never decided here. A command is the implementer's step and its exit status is not
 * recorded in the store, and a manual review is a person's judgement. Reporting either as satisfied would be a claim
 * Orchescope cannot support.
 */
const evaluateCriterion = (
  criterion: AcceptanceCriterion,
  input: CriterionInput,
): CriterionOutcome => {
  const check = criterion.check;
  switch (check.kind) {
    case 'metric_improvement':
      return metricImprovementOutcome(criterion, check, input.comparison);
    case 'metric_not_worse':
      return metricNotWorseOutcome(criterion, check, input.comparison);
    case 'scenario_passes':
      return scenarioPassesOutcome(criterion, check, input.scenarioResults);
    case 'finding_resolved':
      return findingResolvedOutcome(criterion, check, input);
    case 'command_succeeds':
      return undecided(
        criterion,
        `running ${check.command.join(' ')} is the implementer's step and its result is not recorded here`,
      );
    case 'manual_review':
      return undecided(criterion, 'a human has to record this review');
    default:
      return undecided(criterion, 'unknown criterion kind');
  }
};

export const validateGoal = (goal: Goal, input: CriterionInput): GoalValidation => {
  const outcomes = goal.acceptanceCriteria.map((criterion) => evaluateCriterion(criterion, input));
  const satisfiedCount = outcomes.filter((outcome) => outcome.satisfied).length;
  const undecidedCount = outcomes.filter((outcome) => !outcome.decided).length;
  const validated = outcomes.length > 0 && outcomes.every((outcome) => outcome.satisfied);
  return {
    outcomes,
    satisfiedCount,
    undecidedCount,
    validated,
    summary: validated
      ? `all ${outcomes.length} acceptance criteria are satisfied`
      : `${satisfiedCount} of ${outcomes.length} criteria satisfied, ${undecidedCount} undecided`,
  };
};
