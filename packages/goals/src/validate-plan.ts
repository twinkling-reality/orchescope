import { agree, formatCount } from '@orchescope/domain';
import type {
  AcceptanceCriterion,
  Comparison,
  Goal,
  ScenarioResult,
  Timestamp,
} from '@orchescope/schema';

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
  /** When the goal was created. Evidence older than this describes the code the goal is about to change. */
  readonly goalCreatedAt: Timestamp;
};

export type ValidationInput = Omit<CriterionInput, 'goalCreatedAt'>;

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
 *
 * An `indeterminate` direction is the comparison stating that its samples do not support a claim either way, so the
 * criterion is undecided rather than satisfied. That sentence used to be discarded: the outcome reported `satisfied`
 * beside `decided: false`, and `validateGoal` reads satisfaction alone, so a goal could reach `validated` carrying a
 * criterion nothing had decided. Against a pair of runs that produced no span, every metric is indeterminate at best,
 * which made this the shortest path in the product to a verdict resting on no evidence.
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
  const detail = `${check.metric} moved from ${delta.baseline} to ${delta.candidate} and was judged ${delta.direction}${delta.caveat === undefined ? '' : ` (${delta.caveat})`}`;
  if (delta.direction === 'indeterminate') return undecided(criterion, detail);
  /*
   * Direction supplies the sign and the tolerance supplies the magnitude. Comparing the two values here
   * would need this module to know which way is better for every metric, which the comparison already
   * decided and would be a second answer able to disagree with the first.
   */
  const withinTolerance = Math.abs(delta.candidate - delta.baseline) <= check.tolerance;
  return {
    criterion,
    satisfied: delta.direction !== 'regressed' || withinTolerance,
    decided: true,
    detail,
  };
};

/**
 * Judges a scenario criterion against the newest run of that scenario, and only against one that could have seen
 * the change.
 *
 * A result that predates the goal was measured on the code the goal exists to change, so it can say nothing about
 * whether the change worked. Reporting it as satisfied would validate a goal against its own baseline, which is the
 * one mistake this criterion exists to prevent, so an older result leaves the criterion undecided and says why.
 */
const scenarioPassesOutcome = (
  criterion: AcceptanceCriterion,
  check: Extract<AcceptanceCriterion['check'], { kind: 'scenario_passes' }>,
  input: CriterionInput,
): CriterionOutcome => {
  const forScenario = input.scenarioResults
    .filter((entry) => entry.scenarioId === check.scenarioId)
    .toSorted((left, right) => (left.startedAt < right.startedAt ? 1 : -1));
  if (forScenario.length === 0) {
    return undecided(criterion, `scenario ${check.scenarioId} was not run`);
  }
  const result = forScenario.find((entry) => entry.startedAt >= input.goalCreatedAt);
  if (result === undefined) {
    return undecided(
      criterion,
      `scenario ${check.scenarioId} has only been run before this goal was created, so its result describes the code the goal is about to change`,
    );
  }
  return {
    criterion,
    satisfied: result.passed,
    decided: true,
    detail: `scenario ${check.scenarioId} ${result.passed ? 'passed' : 'failed'} over ${formatCount(result.repetitions.length, 'repetition')}`,
  };
};

/**
 * Judges whether the finding the goal was cut from still fires.
 *
 * The detail names neither identifier. The criterion statement names the rule and is printed beside this
 * detail by every surface, while the check keeps the exact semantic handle used for the set lookup.
 */
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
      ? 'the finding this goal was created from still fires after the rescan'
      : 'the finding this goal was created from is no longer reported',
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
      return scenarioPassesOutcome(criterion, check, input);
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

/**
 * What is left, in the words of why it is left.
 *
 * "1 of 2 criteria satisfied, 1 undecided" says the same thing about a criterion that failed, a
 * criterion nothing could judge, and a criterion waiting for a person to look. Only the first is a
 * reason to think the change did not work, and reading the other two as failure is what makes an
 * operator who did everything the goal asked believe they did not.
 */
const awaitsAPerson = (outcome: CriterionOutcome): boolean =>
  outcome.criterion.check.kind === 'manual_review';

const outstanding = (outcomes: readonly CriterionOutcome[]): string => {
  const failed = outcomes.filter((outcome) => outcome.decided && !outcome.satisfied).length;
  const waiting = outcomes.filter((outcome) => !outcome.decided && awaitsAPerson(outcome)).length;
  const unjudged = outcomes.filter((outcome) => !outcome.decided && !awaitsAPerson(outcome)).length;
  const parts = [
    failed === 0 ? undefined : `${failed} failed`,
    waiting === 0 ? undefined : `${waiting} waiting for a person to record a review`,
    unjudged === 0 ? undefined : `${unjudged} that the evidence here cannot judge`,
  ].filter((part) => part !== undefined);
  return parts.join(', ');
};

export const validateGoal = (goal: Goal, input: ValidationInput): GoalValidation => {
  const outcomes = goal.acceptanceCriteria.map((criterion) =>
    evaluateCriterion(criterion, { ...input, goalCreatedAt: goal.createdAt }),
  );
  const satisfiedCount = outcomes.filter((outcome) => outcome.satisfied).length;
  const undecidedCount = outcomes.filter((outcome) => !outcome.decided).length;
  const validated = outcomes.length > 0 && outcomes.every((outcome) => outcome.satisfied);
  return {
    outcomes,
    satisfiedCount,
    undecidedCount,
    validated,
    summary: validated
      ? `${formatCount(outcomes.length, 'acceptance criterion', 'acceptance criteria')} ${agree(outcomes.length, 'is', 'are')} satisfied`
      : `${satisfiedCount} of ${outcomes.length} criteria satisfied, ${outstanding(outcomes)}`,
  };
};
