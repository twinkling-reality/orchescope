import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunObservation } from '@orchescope/domain';
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
const record = (overrides: Partial<RunMetrics> = {}): RunRecord => {
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

/** A run that measured something. Ten spans is a stand in for any positive number of them. */
const run = (overrides: Partial<RunMetrics> = {}): RunObservation => ({
  run: record(overrides),
  spanCount: 10,
});

/**
 * A run that measured nothing: no span arrived and the target reported no outcome.
 *
 * Its counters are the zeros the schema requires it to carry, which is exactly why it is dangerous. The
 * `taskSuccess` field is absent because nothing set it, and that absence is the signal.
 */
const silentRun = (): RunObservation => {
  const observation = record({
    durationMs: 0,
    modelCalls: 0,
    toolCalls: 0,
    agentSteps: 0,
    inputTokens: 0,
    outputTokens: 0,
    sideEffects: 0,
    duplicateSideEffects: 0,
  });
  const { taskSuccess: _unknownOutcome, ...withoutOutcome } = observation.metrics;
  return { run: { ...observation, metrics: withoutOutcome }, spanCount: 0 };
};

const side = (label: string, runs: readonly RunObservation[]): ComparisonSide => ({
  kind: 'run',
  reference: runs[0]?.run.id ?? 'none',
  label,
  runIds: runs.map((observation) => observation.run.id),
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

  /*
   * A metric name may carry the reduction that summarises its samples. `durationMs.p95` was already in
   * the direction table and produced by nothing, so three acceptance criteria named it and could never
   * be decided. The tail is what the criterion asks about, and the mean is what hides it.
   */
  it('summarises a quantile metric by its quantile rather than by the mean', () => {
    const slowTail = [100, 100, 100, 100, 100, 100, 100, 100, 100, 900];
    const evenTail = [180, 180, 180, 180, 180, 180, 180, 180, 180, 180];
    const byMean = compareMetric(sample('durationMs', slowTail), sample('durationMs', evenTail));
    const byTail = compareMetric(
      sample('durationMs.p95', slowTail),
      sample('durationMs.p95', evenTail),
    );
    // The two sets have the same mean, so the mean sees nothing and the tail sees the whole difference.
    assert.equal(byMean.baseline, byMean.candidate);
    assert.equal(byTail.baseline, 900);
    assert.equal(byTail.candidate, 180);
    assert.equal(byTail.direction, 'improved');
    // What the claim rests on is stated rather than implied, because it is weaker than the mean test.
    assert.match(byTail.caveat ?? '', /order statistics/);
  });

  it('still refuses a quantile direction below the sample floor', () => {
    const delta = compareMetric(sample('durationMs.p95', [900]), sample('durationMs.p95', [100]));
    assert.equal(delta.direction, 'indeterminate');
    assert.match(delta.caveat ?? '', /at least 3 samples per side/);
  });

  it('reads the base metric off each run for a name that carries a reduction', () => {
    const runs = [run({ durationMs: 300 }), run({ durationMs: 100 }), run({ durationMs: 200 })];
    const [plain, median] = samplesFromRuns(runs, ['durationMs', 'durationMs.p50']);
    assert.deepEqual(plain?.values, median?.values);
    assert.equal(plain?.unit, 'ms');
    assert.equal(
      median?.unit,
      'ms',
      'the unit comes from the metric being read, not from its suffix',
    );
    assert.equal(compareMetric(median as never, median as never).baseline, 200);
  });

  it('leaves a name whose suffix is not a quantile alone', () => {
    const delta = compareMetric(
      sample('durationMs.tail', [100, 900]),
      sample('durationMs.tail', [100, 900]),
    );
    assert.equal(
      delta.baseline,
      500,
      'an unrecognised suffix falls back to the mean of the samples',
    );
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

  /*
   * The zeros on a run that measured nothing are the schema's requirement that its counters exist, not
   * counts of anything. Reading them as samples is how `duplicateSideEffects` came to be compared as
   * zero against zero, judged unchanged, and banked by an acceptance criterion.
   */
  it('takes no sample from a run that produced no span and reported no outcome', () => {
    const samples = samplesFromRuns([silentRun()], ['duplicateSideEffects', 'durationMs']);
    assert.deepEqual(samples[0]?.values, []);
    assert.deepEqual(samples[1]?.values, []);
  });

  /*
   * The target result document exists so that a target with no tracing at all can still be evaluated,
   * so a run measured by that alone is a measurement and stays one.
   */
  it('still takes samples from a run the target reported on without any span', () => {
    const reported: RunObservation = {
      run: record({ taskSuccess: true, duplicateSideEffects: 2 }),
      spanCount: 0,
    };
    const samples = samplesFromRuns([reported], ['duplicateSideEffects', 'successRate']);
    assert.deepEqual(samples[0]?.values, [2]);
    assert.deepEqual(samples[1]?.values, [1]);
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

  /*
   * The A/A that started this. Two traced runs of an uninstrumented target, every counter zero on both
   * sides, reported `duplicateSideEffects` as unchanged and gave an acceptance criterion something to
   * bank. Nothing was compared, and that is what the comparison now says.
   */
  it('compares nothing when neither side measured anything, and says so', () => {
    const baselineRuns = [silentRun()];
    const candidateRuns = [silentRun()];
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      now: NOW,
    });
    assert.deepEqual(result.metricDeltas, []);
    assert.equal(result.verdict, 'insufficient_evidence');
    assert.match(result.verdictReason, /neither side carries a value/);
    assert.ok(
      result.limitations.some((entry) => entry.includes('produced no span and reported no task')),
      'a reader has to be told which runs were left out and why',
    );
  });

  it('leaves a run that measured nothing out of a side that also has real runs', () => {
    const baselineRuns = [...fiveOf({ durationMs: 1000 }), silentRun()];
    const candidateRuns = fiveOf({ durationMs: 1000 });
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      metrics: ['durationMs'],
      now: NOW,
    });
    assert.equal(result.metricDeltas[0]?.baselineSamples, 5);
    assert.equal(result.metricDeltas[0]?.baseline, 1000);
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
    const finding = (id: string, ruleId: string, component: string) =>
      ({
        id,
        ruleId,
        polarity: 'risk',
        components: [component],
        edges: [],
        metadata: {},
      }) as unknown as Parameters<typeof compare>[0]['baselineFindings'] extends
        | readonly (infer T)[]
        | undefined
        ? T
        : never;
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      baselineFindings: [
        finding('f1', 'duplicate-side-effect', 'tool:refund'),
        finding('f2', 'no-timeout', 'model:primary'),
      ],
      candidateFindings: [
        finding('f3', 'no-timeout', 'model:primary'),
        finding('f4', 'sequential-independent-calls', 'agent:planner'),
      ],
      now: NOW,
    });
    assert.deepEqual(result.findingDelta?.resolved, ['f1']);
    assert.deepEqual(result.findingDelta?.introduced, ['f4']);
    assert.deepEqual(result.findingDelta?.unchanged, ['f3']);
  });

  it('does not conflate simultaneous subjects from one rule', () => {
    const baselineRuns = fiveOf();
    const candidateRuns = fiveOf();
    const finding = (id: string, component: string) =>
      ({
        id,
        ruleId: 'model-call-without-timeout',
        polarity: 'risk',
        components: [component],
        edges: [],
        metadata: {},
      }) as never;
    const result = compare({
      baseline: side('baseline', baselineRuns),
      candidate: side('candidate', candidateRuns),
      baselineRuns,
      candidateRuns,
      baselineFindings: [
        finding('OSC-AAAAA-0001', 'model:primary'),
        finding('OSC-BBBBB-0002', 'model:secondary'),
      ],
      candidateFindings: [finding('OSC-CCCCC-0003', 'model:secondary')],
      now: NOW,
    });
    assert.deepEqual(result.findingDelta?.resolved, ['OSC-AAAAA-0001']);
    assert.deepEqual(result.findingDelta?.introduced, []);
    assert.deepEqual(result.findingDelta?.unchanged, ['OSC-CCCCC-0003']);
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
