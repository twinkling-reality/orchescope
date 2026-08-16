import { mean } from '@orchescope/domain';
import { computeReliability } from '@orchescope/scenarios';
import type {
  ChaosOutcome,
  FaultSpec,
  RepetitionResult,
  RunMetrics,
  ScenarioResult,
} from '@orchescope/schema';

/**
 * Turning one fault run into an attributable outcome.
 *
 * Fault application is cooperative: the target decides whether it applied the fault and says so on its spans.
 * A fault the target never reported applying produces no outcome at all, because "the task still succeeded"
 * means nothing when the fault may never have happened. That case is reported as not applied, with the reason.
 *
 * Applications are matched on the fault kind and not on the target string. A plan may target `*` or a
 * component name, while the target reports the component the fault actually landed on, so comparing the two
 * strings would drop real applications.
 */

export const NOT_APPLIED_REASON = 'the target reported no application of this fault';

/**
 * Task completion under a fault is a question about the task, not about the scenario's expectations.
 *
 * A chaos scenario often asserts something about behaviour under failure, so folding evaluator results into this
 * predicate would report "the task did not finish" for a run where the system absorbed the fault correctly and one
 * assertion about the failure path did not hold. Evaluator outcomes are reported separately, where they belong.
 */
const succeeded = (repetition: RepetitionResult): boolean =>
  repetition.status === 'completed' && repetition.taskSuccess !== false;

/** The stricter definition, used for the reliability figure the outcome also carries. */
const satisfiedEverything = (repetition: RepetitionResult): boolean =>
  computeReliability([repetition]).successes === 1;

const applicationsIn = (repetition: RepetitionResult, fault: FaultSpec): number =>
  repetition.faultsApplied
    .filter((entry) => entry.kind === fault.kind)
    .reduce((total, entry) => total + entry.appliedCount, 0);

const sumOf = (result: ScenarioResult, pick: (metrics: RunMetrics) => number): number =>
  result.repetitions.reduce((total, entry) => total + pick(entry.metrics), 0);

const meanOf = (result: ScenarioResult, pick: (metrics: RunMetrics) => number): number =>
  mean(result.repetitions.map((entry) => pick(entry.metrics))) ?? 0;

const tokensOf = (metrics: RunMetrics): number => metrics.inputTokens + metrics.outputTokens;

/**
 * Amplification is a ratio of per repetition means, so a fault run with a different repetition count than the
 * baseline still produces a comparable number. A zero baseline yields no ratio: dividing by nothing measured
 * would report an infinite amplification, which is not a measurement.
 */
const amplification = (baselineMean: number, faultMean: number): number | undefined =>
  baselineMean === 0 ? undefined : faultMean / baselineMean;

export const chaosOutcome = (input: {
  readonly fault: FaultSpec;
  readonly baseline: ScenarioResult;
  readonly result: ScenarioResult;
}): ChaosOutcome | undefined => {
  const { fault, result } = input;
  const appliedCount = result.repetitions.reduce(
    (total, repetition) => total + applicationsIn(repetition, fault),
    0,
  );
  if (appliedCount === 0) return undefined;

  const runId = result.repetitions[0]?.runId ?? result.aggregate.runIds[0] ?? result.id;
  const taskCompleted = result.repetitions.some(succeeded);
  const recoveredRepetition = result.repetitions.find(
    (repetition) => succeeded(repetition) && applicationsIn(repetition, fault) > 0,
  );
  const recoveryTimeMs =
    recoveredRepetition !== undefined && recoveredRepetition.metrics.retries > 0
      ? recoveredRepetition.metrics.durationMs
      : undefined;
  const costAmplification = amplification(
    meanOf(input.baseline, tokensOf),
    meanOf(result, tokensOf),
  );
  const retryAmplification = amplification(
    meanOf(input.baseline, (metrics) => metrics.retries),
    meanOf(result, (metrics) => metrics.retries),
  );

  return {
    faultKind: fault.kind,
    target: fault.target,
    appliedCount,
    runId,
    taskCompleted,
    recovered: recoveredRepetition !== undefined,
    ...(recoveryTimeMs === undefined ? {} : { recoveryTimeMs }),
    ...(costAmplification === undefined ? {} : { costAmplification }),
    ...(retryAmplification === undefined ? {} : { retryAmplification }),
    duplicateSideEffects: sumOf(result, (metrics) => metrics.duplicateSideEffects),
    prohibitedSideEffects: sumOf(result, (metrics) => metrics.prohibitedSideEffects),
    userInterventions: sumOf(result, (metrics) => metrics.userInterventions),
    loopIterations: sumOf(result, (metrics) => metrics.loopIterations),
    // Degrading gracefully means the task completed under the fault and every assertion the scenario makes about
    // that path still held. It is deliberately stricter than `taskCompleted`.
    degradedGracefully:
      taskCompleted && appliedCount > 0 && result.repetitions.some(satisfiedEverything),
    policyViolations: sumOf(result, (metrics) => metrics.policyViolations),
    evaluators: [...result.aggregate.evaluators],
  };
};
