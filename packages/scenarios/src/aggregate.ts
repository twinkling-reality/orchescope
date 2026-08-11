import { formatCount, mean, summarize } from '@orchescope/domain';
import type {
  EvaluatorResult,
  RepetitionResult,
  RunMetrics,
  ScenarioVariant,
  VariantResult,
} from '@orchescope/schema';
import { repetitionSucceeded } from './reliability.ts';

/**
 * Aggregation across the repetitions of one variant.
 *
 * Raw values are never discarded: every distribution keeps the values it was computed from, and quantiles
 * below their sample size threshold are withheld by `summarize` rather than computed from too few points.
 *
 * Counters are summed, because the total work a variant did is a real quantity. Time to first output is a
 * latency rather than a total, so the aggregate reports its mean while the distribution keeps every value.
 */

const REPETITIONS_FOR_A_RELIABILITY_CLAIM = 5;

const definedNumbers = (values: readonly (number | undefined)[]): readonly number[] =>
  values.filter((value): value is number => value !== undefined);

const sumOf = (values: readonly (number | undefined)[]): number | undefined => {
  const known = definedNumbers(values);
  return known.length === 0 ? undefined : known.reduce((total, value) => total + value, 0);
};

const sum = (all: readonly RunMetrics[], pick: (metrics: RunMetrics) => number): number =>
  all.reduce((total, metrics) => total + pick(metrics), 0);

/**
 * True only when every repetition that reported an outcome reported success. Repetitions that reported
 * nothing leave the field absent rather than counting as a failure.
 */
const combinedTaskSuccess = (all: readonly RunMetrics[]): boolean | undefined => {
  const reported = all
    .map((metrics) => metrics.taskSuccess)
    .filter((value): value is boolean => value !== undefined);
  return reported.length === 0 ? undefined : reported.every((value) => value);
};

export const sumMetrics = (all: readonly RunMetrics[]): RunMetrics => {
  const timeToFirstOutputMs = mean(
    definedNumbers(all.map((metrics) => metrics.timeToFirstOutputMs)),
  );
  const queueWaitMs = sumOf(all.map((metrics) => metrics.queueWaitMs));
  const costUsd = sumOf(all.map((metrics) => metrics.costUsd));
  const taskSuccess = combinedTaskSuccess(all);
  return {
    durationMs: sum(all, (metrics) => metrics.durationMs),
    ...(timeToFirstOutputMs === undefined ? {} : { timeToFirstOutputMs }),
    ...(taskSuccess === undefined ? {} : { taskSuccess }),
    modelCalls: sum(all, (metrics) => metrics.modelCalls),
    toolCalls: sum(all, (metrics) => metrics.toolCalls),
    agentSteps: sum(all, (metrics) => metrics.agentSteps),
    handoffs: sum(all, (metrics) => metrics.handoffs),
    retrievalCalls: sum(all, (metrics) => metrics.retrievalCalls),
    memoryOperations: sum(all, (metrics) => metrics.memoryOperations),
    ...(queueWaitMs === undefined ? {} : { queueWaitMs }),
    inputTokens: sum(all, (metrics) => metrics.inputTokens),
    outputTokens: sum(all, (metrics) => metrics.outputTokens),
    ...(costUsd === undefined ? {} : { costUsd }),
    errors: sum(all, (metrics) => metrics.errors),
    retries: sum(all, (metrics) => metrics.retries),
    recoveredErrors: sum(all, (metrics) => metrics.recoveredErrors),
    duplicateSideEffects: sum(all, (metrics) => metrics.duplicateSideEffects),
    prohibitedSideEffects: sum(all, (metrics) => metrics.prohibitedSideEffects),
    sideEffects: sum(all, (metrics) => metrics.sideEffects),
    userInterventions: sum(all, (metrics) => metrics.userInterventions),
    policyViolations: sum(all, (metrics) => metrics.policyViolations),
    maxObservedConcurrency: Math.max(0, ...all.map((metrics) => metrics.maxObservedConcurrency)),
    loopIterations: sum(all, (metrics) => metrics.loopIterations),
  };
};

/**
 * Merges the per repetition verdicts of one evaluator. Repetitions run the same evaluator list in the same
 * order, so position identifies the evaluator. An evaluator that was skipped in every repetition stays
 * skipped, and one that ran anywhere passes only when every repetition that ran it passed.
 */
export const mergeEvaluators = (
  repetitions: readonly RepetitionResult[],
): readonly EvaluatorResult[] => {
  const reference = repetitions[0];
  if (reference === undefined) return [];
  return reference.evaluators.map((first, index) => {
    const results = repetitions
      .map((repetition) => repetition.evaluators[index])
      .filter((result): result is EvaluatorResult => result !== undefined);
    const ran = results.filter((result) => result.skipped !== true);
    const passed = ran.filter((result) => result.passed).length;
    if (ran.length === 0) {
      return {
        kind: first.kind,
        passed: false,
        detail: `skipped in all ${results.length} repetitions`,
        skipped: true,
        skipReason: first.skipReason ?? 'skipped in every repetition',
      };
    }
    return {
      kind: first.kind,
      passed: passed === ran.length,
      detail: `passed in ${passed} of ${formatCount(ran.length, 'repetition')} that ran this evaluator`,
    };
  });
};

export const aggregateVariant = (input: {
  readonly variant: ScenarioVariant | undefined;
  readonly repetitions: readonly RepetitionResult[];
}): VariantResult => {
  const metrics = input.repetitions.map((repetition) => repetition.metrics);
  const total = input.repetitions.length;
  const successes = input.repetitions.filter(repetitionSucceeded).length;
  const completedRuns = input.repetitions.filter(
    (repetition) => repetition.status === 'completed',
  ).length;
  const costs = definedNumbers(metrics.map((entry) => entry.costUsd));
  const firstOutput = definedNumbers(metrics.map((entry) => entry.timeToFirstOutputMs));
  return {
    variantId: input.variant?.id ?? 'default',
    variant: input.variant ?? {},
    runIds: input.repetitions.map((repetition) => repetition.runId),
    repetitions: total,
    completedRuns,
    failedRuns: total - completedRuns,
    ...(total === 0 ? {} : { successRate: successes / total }),
    durationMs: summarize(metrics.map((entry) => entry.durationMs)),
    ...(firstOutput.length === 0 ? {} : { timeToFirstOutputMs: summarize(firstOutput) }),
    totalTokens: summarize(metrics.map((entry) => entry.inputTokens + entry.outputTokens)),
    ...(costs.length === 0 ? {} : { costUsd: summarize(costs) }),
    modelCalls: summarize(metrics.map((entry) => entry.modelCalls)),
    toolCalls: summarize(metrics.map((entry) => entry.toolCalls)),
    retries: summarize(metrics.map((entry) => entry.retries)),
    aggregateMetrics: sumMetrics(metrics),
    evaluators: [...mergeEvaluators(input.repetitions)],
  };
};

const skipNotes = (evaluators: readonly EvaluatorResult[]): readonly string[] => {
  const reasons = new Set<string>();
  for (const evaluator of evaluators) {
    if (evaluator.skipped === true) {
      reasons.add(`${evaluator.kind} (${evaluator.skipReason ?? 'no reason recorded'})`);
    }
  }
  return [...reasons];
};

/**
 * Caveats the numbers do not carry on their own. These are written into the result so that a reader cannot
 * take a small sample or an unmeasured cost for a measured fact.
 */
export const scenarioLimitations = (input: {
  readonly repetitions: readonly RepetitionResult[];
  readonly aggregate: VariantResult;
  readonly requestedRepetitions: number;
  readonly proxyFaultCount: number;
}): readonly string[] => {
  const limitations: string[] = [];
  const total = input.repetitions.length;
  if (total < REPETITIONS_FOR_A_RELIABILITY_CLAIM) {
    limitations.push(
      `${total} repetition(s) were run, which is below the ${REPETITIONS_FOR_A_RELIABILITY_CLAIM} needed before a reliability estimate is worth quoting`,
    );
  }
  if (total < input.requestedRepetitions) {
    limitations.push(
      `${total} of the ${input.requestedRepetitions} requested repetitions ran, so the aggregate covers a shorter run than was asked for`,
    );
  }
  const withheld = input.aggregate.durationMs.withheld.map((entry) => entry.quantile);
  if (withheld.length > 0) {
    limitations.push(
      `duration quantiles ${withheld.join(', ')} are withheld because the sample is smaller than they require`,
    );
  }
  if (input.aggregate.costUsd === undefined) {
    limitations.push(
      'cost was not reported by the target, so cost is absent from the aggregate and any cost budget was not enforced',
    );
  }
  const skipped = skipNotes(input.aggregate.evaluators);
  if (skipped.length > 0) {
    limitations.push(`evaluators were skipped and decided nothing: ${skipped.join('; ')}`);
  }
  if (input.proxyFaultCount > 0) {
    limitations.push(
      `${input.proxyFaultCount} fault(s) request proxy delivery, which this runner does not provide; they were handed to the target for cooperative application instead`,
    );
  }
  return limitations;
};
