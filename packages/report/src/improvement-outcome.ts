/**
 * Did the last change help.
 *
 * This is the question the product exists to answer, and until now nothing could ask it without
 * already holding an identifier. The verdict lived on the fifth loop step, the goal judgements lived in
 * a bundle field no surface read, and an agent that wanted both had to have kept a goal id from an
 * earlier call. An answer a caller has to already know part of is not an answer.
 *
 * Everything here is selection. The verdict was decided by `packages/comparison` and the criteria were
 * judged by `packages/goals`; this module chooses which comparison a reader means, states whether it
 * was willing to call anything, and names what stopped a goal from validating. It computes no verdict
 * of its own, and it is the one place all three surfaces read, so the terminal, `--json` and MCP cannot
 * report different answers to the same question.
 */

import type { ComparisonVerdict, ReportBundle } from '@orchescope/schema';
import { isDecided, latestComparison } from './loop-progress.ts';

/**
 * How many blocking criteria a goal names before it stops naming them.
 *
 * An agent needs to know why a goal did not validate, which is the unsatisfied criteria and nothing
 * else. Three is where a list stops being the reason and starts being the report, and the whole list is
 * on `goal validate` for a caller that wants it.
 */
const NAMED_BLOCKERS = 3;

export interface GoalStanding {
  readonly goalId: string;
  readonly validated: boolean;
  readonly satisfiedCount: number;
  readonly undecidedCount: number;
  readonly summary: string;
  /** The comparison that judged it, when one did. */
  readonly comparisonId: string | null;
  /** Why it did not validate: the detail of each criterion that is not satisfied, bounded. */
  readonly blockedBy: readonly string[];
}

export interface ImprovementOutcome {
  readonly comparisonId: string | null;
  readonly verdict: ComparisonVerdict | null;
  readonly verdictReason: string | null;
  /**
   * True only when the comparison was willing to call it.
   *
   * `unchanged` and `insufficient_evidence` are refusals, not results. A caller that treats any
   * non-null verdict as an answer is the failure this flag exists to prevent.
   */
  readonly decided: boolean;
  /** Every goal the last audit judged, not validated first. */
  readonly goals: readonly GoalStanding[];
  /** One line stating the answer, for a log line or a text response. */
  readonly summary: string;
}

const standingFor = (
  summary: NonNullable<ReportBundle['goalValidations']>[number],
): GoalStanding => ({
  goalId: summary.goalId,
  validated: summary.validated,
  satisfiedCount: summary.satisfiedCount,
  undecidedCount: summary.undecidedCount,
  summary: summary.summary,
  comparisonId: summary.comparisonId ?? null,
  blockedBy: summary.outcomes
    .filter((outcome) => !outcome.satisfied)
    .slice(0, NAMED_BLOCKERS)
    .map((outcome) => outcome.detail),
});

/** Not validated before validated, so the first entry is the one a caller has to act on. */
const worstFirst = (left: GoalStanding, right: GoalStanding): number =>
  left.validated === right.validated ? 0 : left.validated ? 1 : -1;

const summarise = (
  verdict: ComparisonVerdict | null,
  verdictReason: string | null,
  goals: readonly GoalStanding[],
): string => {
  const head =
    verdict === null
      ? 'nothing has been compared, so no change has been measured'
      : `${verdict.replaceAll('_', ' ')}: ${verdictReason}`;
  if (goals.length === 0) return head;
  const validated = goals.filter((goal) => goal.validated).length;
  return `${head}; ${validated} of ${goals.length} goals validated`;
};

export const improvementOutcome = (bundle: ReportBundle): ImprovementOutcome => {
  const comparison = latestComparison(bundle);
  const goals = [...(bundle.goalValidations ?? [])].map(standingFor).sort(worstFirst);
  const verdict = comparison?.verdict ?? null;
  const verdictReason = comparison?.verdictReason ?? null;
  return {
    comparisonId: comparison?.id ?? null,
    verdict,
    verdictReason,
    decided: comparison !== undefined && isDecided(comparison),
    goals,
    summary: summarise(verdict, verdictReason, goals),
  };
};
