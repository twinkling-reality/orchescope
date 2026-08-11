/**
 * What a chaos run's outcomes add up to, and what they do not.
 *
 * Every field here is a count over a boolean the run already recorded. Nothing is derived, weighted or
 * scored: this module answers "how many" so the screen can lead with what failed instead of leading
 * with how many faults were injected, which is a fact about the experiment rather than about the
 * system.
 *
 * The distinction the screen depends on is between a task that did not complete and a task that
 * completed after degrading. Both are outcomes under a fault and only one of them is a failure.
 */

import type { ChaosOutcome } from '@orchescope/schema';

export interface ResilienceSummary {
  readonly total: number;
  /** Faults after which the task did not complete. */
  readonly incomplete: number;
  /** Faults the task completed through, having degraded rather than collapsed. */
  readonly degraded: number;
  /** Faults the task completed through with no degradation recorded. */
  readonly absorbed: number;
  /** Outcomes that repeated an external effect. The most consequential thing a fault can reveal. */
  readonly withDuplicateSideEffects: number;
  readonly withProhibitedSideEffects: number;
  readonly withPolicyViolations: number;
  /** Fault kinds whose outcomes include at least one incomplete task, in the order they appear. */
  readonly failingFaultKinds: readonly string[];
}

export function summariseOutcomes(outcomes: readonly ChaosOutcome[]): ResilienceSummary {
  const failing: string[] = [];
  for (const outcome of outcomes) {
    if (!outcome.taskCompleted && !failing.includes(outcome.faultKind)) {
      failing.push(outcome.faultKind);
    }
  }
  const count = (predicate: (outcome: ChaosOutcome) => boolean): number =>
    outcomes.filter(predicate).length;
  return {
    total: outcomes.length,
    incomplete: count((outcome) => !outcome.taskCompleted),
    degraded: count((outcome) => outcome.taskCompleted && outcome.degradedGracefully),
    absorbed: count((outcome) => outcome.taskCompleted && !outcome.degradedGracefully),
    withDuplicateSideEffects: count((outcome) => outcome.duplicateSideEffects > 0),
    withProhibitedSideEffects: count((outcome) => outcome.prohibitedSideEffects > 0),
    withPolicyViolations: count((outcome) => outcome.policyViolations > 0),
    failingFaultKinds: failing,
  };
}
