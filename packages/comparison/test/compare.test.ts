import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ComparisonSide, RunMetrics, RunRecord, Timestamp } from '@orchescope/schema';
import {
  compare,
  compareMetric,
  DEFAULT_COMPARED_METRICS,
  samplesFromRuns,
} from '../src/compare.ts';

/**
 * Comparison tests.
 *
 * A comparison is the only place Orchescope says a change helped, so these tests are about the ways that claim can be
 * wrong: a direction read the wrong way round, a latency win that hides a success loss, and a difference asserted from
 * samples too few to support it.
 */

const NOW = '2026-07-24T00:00:00.000Z' as Timestamp;

const metrics = (overrides: Partial<RunMetrics> = {}): RunMetrics => ({
  durationMs: 1000,
  modelCalls: 2,
  toolCalls: 3,
  agentSteps: 4,
  handoffs: 0,
  retrievalCalls: 0,
  memoryOperations: 0,
  inputTokens: 100,
  outputTokens: 50,
  errors: 0,
  retries: 0,
  recoveredErrors: 0,
  duplicateSideEffects: 0,
  prohibitedSideEffects: 0,
  sideEffects: 1,
  userInterventions: 0,
  policyViolations: 0,
  maxObservedConcurrency: 1,
  loopIterations: 1,
  taskSuccess: true,
  ...overrides,
});

let counter = 0;
const run = (overrides: Partial<RunMetrics> = {}): RunRecord => {
  counter += 1;
  return {
    id: `run_${counter.toString(16).padStart(16, '0')}`,
    kind: 'scenario',
    label: 'support-desk',
    status: 'completed',
    startedAt: NOW,
    environment: {
      orchescopeVersion: '0.1.0',
      runtimeName: 'node',
      runtimeVersion: '24.0.0',
      platform: 'darwin',
      arch: 'arm64',
      cpuCount: 8,
      totalMemoryBytes: 1024,
    },
    metrics: metrics(overrides),
    componentMetrics: [],
    metadata: {},
  };
};

const side = (label: string, runs: readonly RunRecord[]): ComparisonSide => ({
  kind: 'run',
  reference: runs[0]?.id ?? 'none',
  label,
  runIds: runs.map((record) => record.id),
});

const sample = (metric: string, values: readonly number[]) => ({ metric, unit: 'ms', values });

describe('compareMetric', () => {
  it('calls a large latency drop an improvement', () => {
    const delta = compareMetric(
      sample('durationMs', [1000, 1010, 990, 1005, 995]),
      sample('durationMs', [500, 510, 495, 505, 500]),
    );
    assert.equal(delta.direction, 'improved');
    assert.equal(delta.baselineSamples, 5);
    assert.equal(delta.candidateSamples, 5);
    assert.ok((delta.relativeChange ?? 0) < 0);
  });

  it('knows that more of a good thing is the improvement', () => {
    const delta = compareMetric(
      sample('successRate', [0, 0, 0, 0, 0]),
      sample('successRate', [1, 1, 1, 1, 1]),
    );
    assert.equal(delta.direction, 'improved');
  });

  it('refuses a direction when the samples cannot support one', () => {
    const delta = compareMetric(sample('durationMs', [1000]), sample('durationMs', [900]));
    assert.equal(delta.direction, 'indeterminate');
    assert.ok((delta.caveat ?? '').length > 0);
  });

  it('reports an unchanged metric as unchanged rather than as indeterminate', () => {
    const delta = compareMetric(sample('durationMs', [1000]), sample('durationMs', [1000]));
    assert.equal(delta.direction, 'unchanged');
  });

  it('decides an event that must not happen by whether it still happens', () => {
    const improved = compareMetric(
      sample('duplicateSideEffects', [1]),
      sample('duplicateSideEffects', [0]),
    );
    assert.equal(improved.direction, 'improved');
    assert.match(improved.caveat ?? '', /presence/);

    const regressed = compareMetric(
      sample('duplicateSideEffects', [0]),
      sample('duplicateSideEffects', [1]),
    );
    assert.equal(regressed.direction, 'regressed');
  });

  it('still requires samples for a count that moves without reaching zero', () => {
    const delta = compareMetric(
      sample('duplicateSideEffects', [3]),
      sample('duplicateSideEffects', [2]),
    );
    assert.equal(delta.direction, 'indeterminate');
  });

  it('says so rather than guessing when a metric has no defined direction', () => {
    const delta = compareMetric(
      sample('unknownMetric', [1, 1, 1, 1, 1]),
      sample('unknownMetric', [2, 2, 2, 2, 2]),
    );
    assert.equal(delta.direction, 'indeterminate');
    assert.match(delta.caveat ?? '', /no improvement direction/);
  });

  it('reports one side with no samples instead of comparing against nothing', () => {
    const delta = compareMetric(sample('durationMs', []), sample('durationMs', [10]));
    assert.equal(delta.direction, 'indeterminate');
    assert.match(delta.caveat ?? '', /no samples/);
  });
});

describe('samplesFromRuns', () => {
  it('derives the totals and rates that are not stored directly', () => {
    const samples = samplesFromRuns(
      [run(), run({ taskSuccess: false })],
      ['totalTokens', 'successRate'],
    );
    assert.deepEqual(samples[0]?.values, [150, 150]);
    assert.deepEqual(samples[1]?.values, [1, 0]);
  });

  it('leaves out a metric a run does not carry rather than substituting zero', () => {
    const samples = samplesFromRuns([run()], ['costUsd']);
    assert.deepEqual(samples[0]?.values, []);
  });
});

describe('compare', () => {
  const fiveOf = (overrides: Partial<RunMetrics> = {}) => [
    run(overrides),
    run(overrides),
    run(overrides),
    run(overrides),
    run(overrides),
  ];

  it('refuses to call a faster but less successful candidate an improvement', () => {
    const baselineRuns = fiveOf({ durationMs: 1000, taskSuccess: true });
    const candidateRuns = fiveOf({ durationMs: 400, taskSuccess: false });
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      now: NOW,
    });
    assert.equal(result.verdict, 'regressed');
    assert.match(result.verdictReason, /task success declined/);
  });

  it('calls a mixed result mixed', () => {
    const baselineRuns = fiveOf({ durationMs: 1000, retries: 0 });
    const candidateRuns = fiveOf({ durationMs: 400, retries: 9 });
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      now: NOW,
    });
    assert.equal(result.verdict, 'mixed');
  });

  it('reports insufficient evidence rather than a verdict from one run a side', () => {
    const baselineRuns = [run({ durationMs: 1000 })];
    const candidateRuns = [run({ durationMs: 900 })];
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      metrics: ['durationMs'],
      now: NOW,
    });
    assert.equal(result.verdict, 'insufficient_evidence');
    assert.ok(result.limitations.some((entry) => entry.includes('sample sizes are 1 baseline')));
  });

  it('records the sample size of every metric it reports', () => {
    const baselineRuns = fiveOf();
    const candidateRuns = fiveOf();
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      now: NOW,
    });
    for (const delta of result.metricDeltas) {
      assert.equal(delta.baselineSamples, 5, `${delta.metric} lost its sample size`);
      assert.equal(delta.candidateSamples, 5);
    }
    assert.ok(result.metricDeltas.length <= DEFAULT_COMPARED_METRICS.length);
  });

  it('is deterministic: the same input produces the same identifier and the same verdict', () => {
    const baselineRuns = fiveOf();
    const candidateRuns = fiveOf({ durationMs: 500 });
    const input = {
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      now: NOW,
    };
    const first = compare(input);
    const second = compare(input);
    assert.equal(first.id, second.id);
    assert.equal(first.verdict, second.verdict);
    assert.deepEqual(first.metricDeltas, second.metricDeltas);
  });

  it('reports which findings a change resolved and which it introduced', () => {
    const baselineRuns = fiveOf();
    const candidateRuns = fiveOf();
    const finding = (id: string, ruleId: string) =>
      ({ id, ruleId }) as unknown as Parameters<typeof compare>[0]['baselineFindings'] extends
        | readonly (infer T)[]
        | undefined
        ? T
        : never;
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      baselineFindings: [finding('f1', 'duplicate-side-effect'), finding('f2', 'no-timeout')],
      candidateFindings: [
        finding('f3', 'no-timeout'),
        finding('f4', 'sequential-independent-calls'),
      ],
      now: NOW,
    });
    assert.deepEqual(result.findingDelta?.resolved, ['f1']);
    assert.deepEqual(result.findingDelta?.introduced, ['f4']);
    assert.deepEqual(result.findingDelta?.unchanged, ['f3']);
  });

  it('states that no graph delta was computed when one side has no scan', () => {
    const baselineRuns = fiveOf();
    const candidateRuns = fiveOf();
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      now: NOW,
    });
    assert.ok(result.limitations.some((entry) => entry.includes('no graph delta')));
  });
});
