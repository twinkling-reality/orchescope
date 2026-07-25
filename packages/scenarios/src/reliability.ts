import type { Reliability, RepetitionResult } from '@orchescope/schema';

/**
 * Reliability across repetitions.
 *
 * A repetition counts as a success when the process completed, the target did not report a failed task and
 * every evaluator that actually ran passed. A skipped evaluator neither passes nor fails, so it cannot turn
 * an unmeasured expectation into a success or into a failure.
 */

/** k is reported up to five, which is where the estimator stops being informative for small samples. */
const MAX_K = 5;

export const repetitionSucceeded = (repetition: RepetitionResult): boolean =>
  repetition.status === 'completed' &&
  repetition.taskSuccess !== false &&
  repetition.evaluators.every((result) => result.skipped === true || result.passed);

/**
 * pass^k, the probability that k independently sampled runs all succeed, estimated as
 * C(successes, k) / C(total, k). The metric was introduced by tau-bench
 * (https://arxiv.org/abs/2406.12045) and is reported instead of a bare success rate because a system that
 * succeeds four times out of five is not a system that succeeds.
 *
 * Computed as a product of ratios rather than from two binomial coefficients, so nothing overflows and the
 * value stays in [0, 1] for every input.
 */
const passPower = (successes: number, total: number, k: number): number => {
  if (k > successes || k > total) return 0;
  let value = 1;
  for (let index = 0; index < k; index += 1) {
    value *= (successes - index) / (total - index);
  }
  return value;
};

export const computeReliability = (repetitions: readonly RepetitionResult[]): Reliability => {
  const total = repetitions.length;
  const successes = repetitions.filter(repetitionSucceeded).length;
  const passPowerK: { k: number; value: number }[] = [];
  for (let k = 1; k <= Math.min(total, MAX_K); k += 1) {
    passPowerK.push({ k, value: passPower(successes, total, k) });
  }
  return {
    repetitions: total,
    successes,
    ...(total === 0 ? {} : { successRate: successes / total }),
    passPowerK,
  };
};
