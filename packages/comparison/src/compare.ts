import {
  differenceIsMeaningful,
  formatCount,
  comparisonId as makeComparisonId,
  mean,
  relativeChange,
} from '@orchescope/domain';
import { diffGraphs } from '@orchescope/graph';
import type {
  Comparison,
  ComparisonSide,
  ComparisonVerdict,
  Finding,
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

/**
 * Metrics that count something which must not happen at all.
 *
 * For these, crossing the zero boundary is a categorical change in behaviour rather than a statistical claim: a
 * duplicated payment that happened once and now happens never is decided by presence, not by a sample size. Latency
 * and token counts still go through the distribution rule, because there a small sample genuinely cannot support a
 * direction.
 */
const INCIDENT_METRICS = new Set([
  'duplicateSideEffects',
  'prohibitedSideEffects',
  'policyViolations',
  'userInterventions',
]);

const directionFor = (
  metric: string,
  baseline: number,
  candidate: number,
  meaningful: { readonly meaningful: boolean; readonly reason: string },
): { readonly direction: MetricDelta['direction']; readonly caveat: string | undefined } => {
  if (baseline === candidate) return { direction: 'unchanged', caveat: undefined };
  if (INCIDENT_METRICS.has(metric) && (baseline === 0 || candidate === 0)) {
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
  minimumSamplesPerSide = 3,
): MetricDelta => {
  const baselineMean = mean(baseline.values);
  const candidateMean = mean(candidate.values);
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
  const meaningful = differenceIsMeaningful(
    baseline.values,
    candidate.values,
    minimumSamplesPerSide,
  );
  const decided = directionFor(baseline.metric, baselineMean, candidateMean, meaningful);
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
    ...(decided.caveat === undefined ? {} : { caveat: decided.caveat }),
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

const numericMetric = (run: RunRecord, metric: string): number | undefined => {
  const metrics = run.metrics as unknown as Record<string, unknown>;
  const value = metrics[metric];
  if (typeof value === 'number') return value;
  if (metric === 'totalTokens') return run.metrics.inputTokens + run.metrics.outputTokens;
  if (metric === 'successRate')
    return run.metrics.taskSuccess === undefined ? undefined : run.metrics.taskSuccess ? 1 : 0;
  return undefined;
};

export const samplesFromRuns = (runs: readonly RunRecord[], metrics: readonly string[]) =>
  metrics.map((metric) => ({
    metric,
    unit: METRIC_UNITS[metric] ?? 'value',
    values: runs
      .map((run) => numericMetric(run, metric))
      .filter((value): value is number => value !== undefined),
  }));

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
      reason: `${improvements.length} metric(s) improved and ${regressions.length} regressed`,
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

export type CompareInput = {
  readonly baseline: ComparisonSide;
  readonly candidate: ComparisonSide;
  readonly baselineRuns: readonly RunRecord[];
  readonly candidateRuns: readonly RunRecord[];
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

  const limitations: string[] = [];
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
  if (metricDeltas.every((delta) => delta.direction === 'indeterminate')) {
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
                !input.candidateFindings?.some((candidate) => candidate.ruleId === finding.ruleId),
            )
            .map((finding) => finding.id),
          introduced: input.candidateFindings
            .filter(
              (finding) =>
                !input.baselineFindings?.some((baseline) => baseline.ruleId === finding.ruleId),
            )
            .map((finding) => finding.id),
          unchanged: input.candidateFindings
            .filter((finding) =>
              input.baselineFindings?.some((baseline) => baseline.ruleId === finding.ruleId),
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
