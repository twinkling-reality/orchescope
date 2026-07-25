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

const evaluateCriterion = (
  criterion: AcceptanceCriterion,
  input: {
    readonly comparison: Comparison | undefined;
    readonly scenarioResults: readonly ScenarioResult[];
    readonly findingStillPresent: ReadonlySet<string>;
    readonly rescanned: boolean;
  },
): CriterionOutcome => {
  const check = criterion.check;
  switch (check.kind) {
    case 'metric_improvement': {
      if (input.comparison === undefined) {
        return { criterion, satisfied: false, decided: false, detail: 'no comparison was recorded' };
      }
      const delta = metricDelta(input.comparison, check.metric);
      if (delta === undefined || delta.relativeChange === undefined) {
        return {
          criterion,
          satisfied: false,
          decided: false,
          detail: `the comparison carries no relative change for ${check.metric}`,
        };
      }
      const threshold = check.relativeThreshold;
      if (threshold === undefined) {
        const satisfied = check.comparator === 'lt' ? delta.relativeChange < 0 : delta.relativeChange > 0;
        return {
          criterion,
          satisfied,
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
    }
    case 'metric_not_worse': {
      if (input.comparison === undefined) {
        return { criterion, satisfied: false, decided: false, detail: 'no comparison was recorded' };
      }
      const delta = metricDelta(input.comparison, check.metric);
      if (delta === undefined || delta.baseline === undefined || delta.candidate === undefined) {
        return {
          criterion,
          satisfied: false,
          decided: false,
          detail: `the comparison carries no values for ${check.metric}`,
        };
      }
      const worse = delta.candidate > delta.baseline + check.tolerance;
      const better = delta.candidate < delta.baseline - check.tolerance;
      // For a "not worse" criterion, direction matters: a lower success rate is worse, a lower duplicate
      // count is better. The comparison already resolved direction, so it is used rather than guessed.
      const satisfied = delta.direction === 'regressed' ? false : !(worse && better);
      return {
        criterion,
        satisfied,
        decided: delta.direction !== 'indeterminate',
        detail: `${check.metric} moved from ${delta.baseline} to ${delta.candidate} and was judged ${delta.direction}${delta.caveat === undefined ? '' : ` (${delta.caveat})`}`,
      };
    }
    case 'scenario_passes': {
      const result = input.scenarioResults.find((entry) => entry.scenarioId === check.scenarioId);
      if (result === undefined) {
        return {
          criterion,
          satisfied: false,
          decided: false,
          detail: `scenario ${check.scenarioId} was not run`,
        };
      }
      return {
        criterion,
        satisfied: result.passed,
        decided: true,
        detail: `scenario ${check.scenarioId} ${result.passed ? 'passed' : 'failed'} over ${result.repetitions.length} repetition(s)`,
      };
    }
    case 'finding_resolved': {
      if (!input.rescanned) {
        return { criterion, satisfied: false, decided: false, detail: 'no rescan was performed' };
      }
      const present = input.findingStillPresent.has(check.findingId);
      return {
        criterion,
        satisfied: !present,
        decided: true,
        detail: present
          ? `${check.findingId} still fires after the rescan`
          : `${check.findingId} no longer fires`,
      };
    }
    case 'command_succeeds':
      return {
        criterion,
        satisfied: false,
        decided: false,
        detail: `running ${check.command.join(' ')} is the implementer's step and its result is not recorded here`,
      };
    case 'manual_review':
      return {
        criterion,
        satisfied: false,
        decided: false,
        detail: 'a human has to record this review',
      };
    default:
      return { criterion, satisfied: false, decided: false, detail: 'unknown criterion kind' };
  }
};

export const validateGoal = (
  goal: Goal,
  input: {
    readonly comparison: Comparison | undefined;
    readonly scenarioResults: readonly ScenarioResult[];
    readonly findingStillPresent: ReadonlySet<string>;
    readonly rescanned: boolean;
  },
): GoalValidation => {
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
