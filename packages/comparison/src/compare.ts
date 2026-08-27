import {
  differenceIsMeaningful,
  findingsShareIdentity,
  formatCount,
  comparisonId as makeComparisonId,
  mean,
  metricDecidedByPresence,
  MINIMUM_SAMPLES_PER_SIDE,
  quantile,
  relativeChange,
  type RunObservation,
  runMeasuredNothing,
} from '@orchescope/domain';
import { diffGraphs } from '@orchescope/graph';
import type {
  Comparison,
  ComparisonSide,
  ComparisonVerdict,
  Finding,
  Goal,
  MetricDelta,
  RunRecord,
  ScenarioResult,
  SystemGraph,
  Timestamp,
} from '@orchescope/schema';

/**
 * Baseline against candidate comparison.
 *
 * Three rules make the verdict trustworthy:
 *
 *  1. Direction is per metric. Lower latency is better, higher success is better, and the table knows which is
 *     which rather than assuming smaller is always an improvement.
 *  2. A latency win with a success loss is `mixed`, never `improved`. This is the single most common way a
 *     benchmark lies.
 *  3. Sample size travels with every number, and a difference the samples do not support is reported as
 *     indeterminate with the reason.
 */

/** Metrics where a smaller value is the improvement. */
const LOWER_IS_BETTER = new Set([
  'durationMs',
  'durationMs.p50',
  'durationMs.p90',
  'durationMs.p95',
  'durationMs.p99',
  'timeToFirstOutputMs',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'costUsd',
  'modelCalls',
  'toolCalls',
  'agentSteps',
  'errors',
  'retries',
  'duplicateSideEffects',
  'prohibitedSideEffects',
  'userInterventions',
  'policyViolations',
  'queueWaitMs',
]);

/** Metrics where a larger value is the improvement. */
const HIGHER_IS_BETTER = new Set(['successRate', 'recoveredErrors', 'passPowerK']);

export type MetricSample = {
  readonly metric: string;
  readonly unit: string;
  readonly values: readonly number[];
};

const directionFor = (
  metric: string,
  baseline: number,
  candidate: number,
  meaningful: { readonly meaningful: boolean; readonly reason: string },
): { readonly direction: MetricDelta['direction']; readonly caveat: string | undefined } => {
  if (baseline === candidate) return { direction: 'unchanged', caveat: undefined };
  if (metricDecidedByPresence(metric) && (baseline === 0 || candidate === 0)) {
    return candidate === 0
      ? {
          direction: 'improved',
          caveat: 'decided by presence rather than by distribution: the event no longer occurs',
        }
      : {
          direction: 'regressed',
          caveat: 'decided by presence rather than by distribution: the event now occurs',
        };
  }
  if (!meaningful.meaningful) {
    return { direction: 'indeterminate', caveat: meaningful.reason };
  }
  const lower = LOWER_IS_BETTER.has(metric);
  const higher = HIGHER_IS_BETTER.has(metric);
  if (!lower && !higher) {
    return {
      direction: 'indeterminate',
      caveat: `no improvement direction is defined for ${metric}`,
    };
  }
  const improved = lower ? candidate < baseline : candidate > baseline;
  return { direction: improved ? 'improved' : 'regressed', caveat: undefined };
};

export const compareMetric = (
  baseline: MetricSample,
  candidate: MetricSample,
  minimumSamplesPerSide = MINIMUM_SAMPLES_PER_SIDE,
): MetricDelta => {
  const { summarise } = metricReduction(baseline.metric);
  const baselineMean = summarise(baseline.values);
  const candidateMean = summarise(candidate.values);
  if (baselineMean === undefined || candidateMean === undefined) {
    return {
      metric: baseline.metric,
      unit: baseline.unit,
      baselineSamples: baseline.values.length,
      candidateSamples: candidate.values.length,
      direction: 'indeterminate',
      caveat: 'one side has no samples',
    };
  }
  /*
   * What licenses a direction depends on what the number is.
   *
   * For a mean, it is `differenceIsMeaningful`: two means can differ by less than the noise around them,
   * and calling that an improvement is the shape of confident wrongness this module exists to refuse.
   *
   * For a quantile it is not. That test compares means and spreads, and a tail that moved while the mean
   * held still is exactly the case a p95 criterion is written for: ten runs at 100ms with one at 900
   * have the same mean as ten runs at 180, and the mean test reports nothing happened. So a quantile is
   * gated on having enough samples for the order statistic to be one, and the claim it supports is
   * stated on the delta rather than implied: these are order statistics, compared without a spread test.
   */
  const quantileMetric = metricReduction(baseline.metric).base !== baseline.metric;
  const enoughSamples =
    baseline.values.length >= minimumSamplesPerSide &&
    candidate.values.length >= minimumSamplesPerSide;
  const meaningful = quantileMetric
    ? {
        meaningful: enoughSamples,
        reason: enoughSamples
          ? ''
          : `needs at least ${minimumSamplesPerSide} samples per side, has ${baseline.values.length} and ${candidate.values.length}`,
      }
    : differenceIsMeaningful(baseline.values, candidate.values, minimumSamplesPerSide);
  const decided = directionFor(baseline.metric, baselineMean, candidateMean, meaningful);
  const caveat =
    quantileMetric && decided.caveat === undefined && decided.direction !== 'unchanged'
      ? 'compared as order statistics of the runs on each side, without a spread test'
      : decided.caveat;
  const relative = relativeChange(baselineMean, candidateMean);
  return {
    metric: baseline.metric,
    unit: baseline.unit,
    baseline: baselineMean,
    candidate: candidateMean,
    absoluteChange: candidateMean - baselineMean,
    ...(relative === undefined ? {} : { relativeChange: relative }),
    baselineSamples: baseline.values.length,
    candidateSamples: candidate.values.length,
    direction: decided.direction,
    ...(caveat === undefined ? {} : { caveat }),
  };
};

const METRIC_UNITS: Readonly<Record<string, string>> = {
  durationMs: 'ms',
  timeToFirstOutputMs: 'ms',
  inputTokens: 'tokens',
  outputTokens: 'tokens',
  totalTokens: 'tokens',
  modelCalls: 'count',
  toolCalls: 'count',
  agentSteps: 'count',
  errors: 'count',
  retries: 'count',
  duplicateSideEffects: 'count',
  prohibitedSideEffects: 'count',
  userInterventions: 'count',
  policyViolations: 'count',
  successRate: 'fraction',
  queueWaitMs: 'ms',
};

/**
 * A metric name may carry the reduction that summarises its per-run samples.
 *
 * `durationMs` is the mean of the durations the runs reported and `durationMs.p95` is the 95th
 * percentile of the same numbers: the base names what is read from each run, the suffix names how the
 * set is summarised. Both were already in the direction table, which knew `durationMs.p50` and
 * `durationMs.p95` while nothing produced either, so three acceptance criteria named metrics no
 * comparison computed and were undecidable for every goal that carried them.
 *
 * A quantile of a small sample is an order statistic of that sample and nothing more: at three runs a
 * p95 is the slowest of the three. The sample count travels on every delta for exactly this reason, and
 * whether the two sets differ at all is still decided from the raw values rather than from the summary.
 */
const QUANTILES: Readonly<Record<string, number>> = {
  p50: 0.5,
  p90: 0.9,
  p95: 0.95,
  p99: 0.99,
};

type MetricReduction = {
  readonly base: string;
  readonly summarise: (values: readonly number[]) => number | undefined;
};

export const metricReduction = (metric: string): MetricReduction => {
  const dot = metric.lastIndexOf('.');
  const fraction = dot < 0 ? undefined : QUANTILES[metric.slice(dot + 1)];
  if (dot < 0 || fraction === undefined) return { base: metric, summarise: mean };
  return {
    base: metric.slice(0, dot),
    summarise: (values) =>
      quantile(
        [...values].sort((left, right) => left - right),
        fraction,
      ),
  };
};

const numericMetric = (run: RunRecord, metric: string): number | undefined => {
  const metrics = run.metrics as unknown as Record<string, unknown>;
  const value = metrics[metric];
  if (typeof value === 'number') return value;
  if (metric === 'totalTokens') return run.metrics.inputTokens + run.metrics.outputTokens;
  if (metric === 'successRate')
    return run.metrics.taskSuccess === undefined ? undefined : run.metrics.taskSuccess ? 1 : 0;
  return undefined;
};

/**
 * Samples come from runs that measured something, and a run is not a measurement.
 *
 * A traced target that loads no OpenTelemetry SDK and writes no result document exports nothing, and the
 * run stored for it carries a zero for every counter. Reading those as samples produced the shape this
 * guard exists to stop: `duplicateSideEffects` compared as zero against zero, judged unchanged, and
 * banked by an acceptance criterion as satisfied, on two runs in which nothing whatever was observed.
 * `successRate` was the only metric that behaved, and only because its absent value was absent rather
 * than fabricated. Dropping the run gives every other metric the same honesty.
 */
export const samplesFromRuns = (
  runs: readonly RunObservation[],
  metrics: readonly string[],
): readonly MetricSample[] => {
  const measured = runs.filter((observation) => !runMeasuredNothing(observation));
  return metrics.map((metric) => {
    const { base } = metricReduction(metric);
    return {
      metric,
      unit: METRIC_UNITS[base] ?? 'value',
      values: measured
        .map((observation) => numericMetric(observation.run, base))
        .filter((value): value is number => value !== undefined),
    };
  });
};

export const DEFAULT_COMPARED_METRICS: readonly string[] = [
  'durationMs',
  'successRate',
  'totalTokens',
  'modelCalls',
  'toolCalls',
  'retries',
  'errors',
  'duplicateSideEffects',
  'userInterventions',
];

/**
 * The metrics a comparison has to carry for the goal it is evidence for.
 *
 * A goal's criteria name the metrics they are judged on, and three of the rules that can be cut into a
 * goal name `durationMs.p95`, `durationMs.p50` and `inputTokens`, none of which the default set
 * computes. So every such criterion read "the comparison carries no relative change for durationMs.p95"
 * and was undecidable for the life of the goal, whatever anyone ran.
 *
 * Added for a comparison attached to a goal rather than to the default set, because the verdict counts
 * metrics: `durationMs`, `durationMs.p50` and `durationMs.p95` move together, and putting all three in
 * front of every comparison would let one change in latency read as three improvements.
 */
export const metricsForGoal = (goal: Goal): readonly string[] => {
  const named = goal.acceptanceCriteria
    .map((criterion) => criterion.check)
    .filter((check) => check.kind === 'metric_improvement' || check.kind === 'metric_not_worse')
    .map((check) => check.metric);
  return [...new Set([...DEFAULT_COMPARED_METRICS, ...named])];
};

const verdictFrom = (
  deltas: readonly MetricDelta[],
): { verdict: ComparisonVerdict; reason: string } => {
  const success = deltas.find((delta) => delta.metric === 'successRate');
  const regressions = deltas.filter((delta) => delta.direction === 'regressed');
  const improvements = deltas.filter((delta) => delta.direction === 'improved');
  const indeterminate = deltas.filter((delta) => delta.direction === 'indeterminate');

  if (success?.direction === 'regressed') {
    return {
      verdict: 'regressed',
      reason: 'task success declined, so no latency or cost improvement makes this an improvement',
    };
  }
  /*
   * No delta at all is not the same as deltas that could not be called. It means neither side supplied a
   * value for anything, which happens when the runs observed nothing, and "no metric moved enough to
   * call" would report that void as a finding of stability.
   */
  if (deltas.length === 0) {
    return {
      verdict: 'insufficient_evidence',
      reason: 'neither side carries a value for any metric, so nothing was compared',
    };
  }
  if (improvements.length === 0 && regressions.length === 0) {
    return indeterminate.length === deltas.length
      ? {
          verdict: 'insufficient_evidence',
          reason: `no metric produced a supportable direction: ${indeterminate[0]?.caveat ?? 'sample sizes were too small'}`,
        }
      : { verdict: 'unchanged', reason: 'no metric moved enough to call' };
  }
  if (regressions.length > 0 && improvements.length > 0) {
    return {
      verdict: 'mixed',
      reason: `${formatCount(improvements.length, 'metric')} improved and ${formatCount(regressions.length, 'metric')} regressed`,
    };
  }
  if (regressions.length > 0) {
    return {
      verdict: 'regressed',
      reason: `${regressions.map((delta) => delta.metric).join(', ')} regressed`,
    };
  }
  return {
    verdict: 'improved',
    reason: `${improvements.map((delta) => delta.metric).join(', ')} improved with no regression`,
  };
};

/**
 * What the two sides did differently before anything was measured.
 *
 * A comparison of two executions of different work is arithmetic on numbers that answer different
 * questions, and it reads exactly like a result: one scenario against another under an injected fault plan
 * reports the faults as a regression and the smaller task as a token improvement, in a document that says
 * nothing about either. This is refused at selection where a goal prescribes the comparison, and reported
 * here, because `orchescope compare` is a general tool and comparing two different things on purpose is a
 * thing a person may legitimately want. What they must not get is silence about it.
 *
 * A side that reports no condition is not evidence that its runs agreed, so nothing is claimed about it.
 */
const conditionsDiffering = (
  baseline: ComparisonSide,
  candidate: ComparisonSide,
): readonly string[] => {
  const differences: string[] = [];
  const differs = (key: 'scenarioId' | 'variantId' | 'faultPlanId'): boolean =>
    baseline[key] !== undefined && candidate[key] !== undefined && baseline[key] !== candidate[key];
  const named = (value: string | undefined): string => value ?? 'none';
  if (differs('scenarioId')) {
    differences.push(
      `the two sides ran different scenarios, ${named(baseline.scenarioId)} against ${named(candidate.scenarioId)}, so every difference below is at least partly the difference between those scenarios`,
    );
  }
  if (differs('variantId')) {
    differences.push(
      `the two sides ran different variants, ${named(baseline.variantId)} against ${named(candidate.variantId)}`,
    );
  }
  if (differs('faultPlanId')) {
    differences.push(
      `the two sides ran under different fault plans, ${named(baseline.faultPlanId)} against ${named(candidate.faultPlanId)}, so injected failures are part of what is being reported`,
    );
  }
  /*
   * One side under faults and the other under none is the same hazard with one identifier missing, and
   * the equality test above cannot see it because an absent fault plan is absent rather than a value.
   */
  if (
    !differs('faultPlanId') &&
    (baseline.faultPlanId === undefined) !== (candidate.faultPlanId === undefined)
  ) {
    const faulted = baseline.faultPlanId === undefined ? 'candidate' : 'baseline';
    differences.push(
      `only the ${faulted} side ran under an injected fault plan, so injected failures are part of what is being reported`,
    );
  }
  return differences;
};

export type CompareInput = {
  readonly baseline: ComparisonSide;
  readonly candidate: ComparisonSide;
  /** Runs on each side, each paired with how much it observed. A run that observed nothing supplies no sample. */
  readonly baselineRuns: readonly RunObservation[];
  readonly candidateRuns: readonly RunObservation[];
  readonly metrics?: readonly string[];
  readonly baselineGraph?: SystemGraph;
  readonly candidateGraph?: SystemGraph;
  readonly baselineFindings?: readonly Finding[];
  readonly candidateFindings?: readonly Finding[];
  readonly goalId?: string;
  readonly now: Timestamp;
  readonly acceptanceResults?: Comparison['acceptanceResults'];
  readonly scenarioResults?: readonly ScenarioResult[];
};

export const compare = (input: CompareInput): Comparison => {
  const metrics = input.metrics ?? DEFAULT_COMPARED_METRICS;
  const baselineSamples = samplesFromRuns(input.baselineRuns, metrics);
  const candidateSamples = samplesFromRuns(input.candidateRuns, metrics);
  const metricDeltas = baselineSamples
    .map((sample, index) => {
      const other = candidateSamples[index];
      return other === undefined ? undefined : compareMetric(sample, other);
    })
    .filter((delta): delta is MetricDelta => delta !== undefined)
    .filter((delta) => delta.baselineSamples > 0 || delta.candidateSamples > 0);

  const decided = verdictFrom(metricDeltas);

  const unmeasured =
    input.baselineRuns.filter(runMeasuredNothing).length +
    input.candidateRuns.filter(runMeasuredNothing).length;

  const limitations: string[] = [...conditionsDiffering(input.baseline, input.candidate)];
  if (unmeasured > 0) {
    limitations.push(
      `${formatCount(unmeasured, 'run')} produced no span and reported no task outcome, so ${unmeasured === 1 ? 'it contributes' : 'they contribute'} no sample to any metric here; a counter of zero from such a run is the absence of a measurement rather than a measurement of zero`,
    );
  }
  if (input.baselineRuns.length < 5 || input.candidateRuns.length < 5) {
    limitations.push(
      `sample sizes are ${formatCount(input.baselineRuns.length, 'baseline run')} and ${formatCount(input.candidateRuns.length, 'candidate run')}; differences from fewer than five runs per side are not reported as directional unless the spread is very small`,
    );
  }
  if (metricDeltas.some((delta) => delta.metric === 'costUsd')) {
    limitations.push(
      'cost is derived from token counts and a configured price table, not measured',
    );
  }
  if (input.baselineGraph === undefined || input.candidateGraph === undefined) {
    limitations.push('no graph delta was computed because one side has no scan');
  }
  if (
    metricDeltas.length > 0 &&
    metricDeltas.every((delta) => delta.direction === 'indeterminate')
  ) {
    limitations.push('every metric was indeterminate, so this comparison supports no conclusion');
  }

  const graphDelta =
    input.baselineGraph !== undefined && input.candidateGraph !== undefined
      ? diffGraphs(input.baselineGraph, input.candidateGraph)
      : undefined;

  const findingDelta =
    input.baselineFindings !== undefined && input.candidateFindings !== undefined
      ? {
          resolved: input.baselineFindings
            .filter(
              (finding) =>
                !input.candidateFindings?.some((candidate) =>
                  findingsShareIdentity(finding, candidate),
                ),
            )
            .map((finding) => finding.id),
          introduced: input.candidateFindings
            .filter(
              (finding) =>
                !input.baselineFindings?.some((baseline) =>
                  findingsShareIdentity(baseline, finding),
                ),
            )
            .map((finding) => finding.id),
          unchanged: input.candidateFindings
            .filter((finding) =>
              input.baselineFindings?.some((baseline) => findingsShareIdentity(baseline, finding)),
            )
            .map((finding) => finding.id),
        }
      : undefined;

  return {
    schemaVersion: 1,
    id: makeComparisonId({
      baseline: input.baseline.reference,
      candidate: input.candidate.reference,
      createdAt: input.now,
    }),
    createdAt: input.now,
    baseline: input.baseline,
    candidate: input.candidate,
    ...(input.goalId === undefined ? {} : { goalId: input.goalId }),
    metricDeltas,
    ...(graphDelta === undefined ? {} : { graphDelta }),
    ...(findingDelta === undefined ? {} : { findingDelta }),
    verdict: decided.verdict,
    verdictReason: decided.reason,
    acceptanceResults: [...(input.acceptanceResults ?? [])],
    limitations,
    metadata: {
      comparedMetrics: metrics.length,
      baselineRuns: input.baselineRuns.length,
      candidateRuns: input.candidateRuns.length,
      ...(input.scenarioResults === undefined
        ? {}
        : { scenarioResults: input.scenarioResults.length }),
    },
  };
};
