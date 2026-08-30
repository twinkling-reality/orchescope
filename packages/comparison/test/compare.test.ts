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
    // Twenty a side, because that is what a p95 requires and this test is about what the tail shows.
    // Two slow runs, so the ninety fifth percentile of twenty samples lands on one of them.
    const slowTail = [...Array(18).fill(100), 900, 900];
    const evenTail = Array(20).fill(180);
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
    assert.match(delta.caveat ?? '', /at least 20 samples per side/);
  });

  /*
   * The floor belongs to the metric, not to the comparison.
   *
   * One number for every metric let a p95 be called from three runs, which is the slowest of three.
   * Measured on a real repository, that reported a 15.3 per cent improvement on a system nobody changed
   * and an acceptance criterion banked it, in the same document where the mean of those three runs was
   * reported indeterminate. This repository had already decided the answer at schema level and applies it
   * when a scenario aggregate withholds a p95 below twenty samples; the comparison now asks the same.
   */
  it('refuses a p95 from ten samples a side, which clears the general floor and not its own', () => {
    const delta = compareMetric(
      sample('durationMs.p95', Array(10).fill(1000)),
      sample('durationMs.p95', Array(10).fill(400)),
    );
    assert.equal(delta.direction, 'indeterminate');
    assert.match(delta.caveat ?? '', /at least 20 samples per side, has 10 and 10/);
  });

  it('decides a p95 once twenty samples a side are there', () => {
    const delta = compareMetric(
      sample('durationMs.p95', Array(20).fill(1000)),
      sample('durationMs.p95', Array(20).fill(400)),
    );
    assert.equal(delta.direction, 'improved');
  });

  /* A guard: the requirement is per quantile, so raising p95 must not raise the median with it. */
  it('still decides a p50 from three samples a side', () => {
    const delta = compareMetric(
      sample('durationMs.p50', [1000, 1000, 1000]),
      sample('durationMs.p50', [400, 400, 400]),
    );
    assert.equal(delta.direction, 'improved');
  });

  /* A guard: a mean is licensed by the spread test over the general floor, and is untouched. */
  it('still puts a mean through the spread test at three samples a side', () => {
    const delta = compareMetric(
      sample('durationMs', [1000, 1001, 999]),
      sample('durationMs', [400, 401, 399]),
    );
    assert.equal(delta.direction, 'improved');
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

/**
 * What a comparison could not compare.
 *
 * A comparison of two executions of different work is arithmetic on numbers answering different
 * questions, and it reads exactly like a result. Measured on the demonstration system, the goal plan the
 * product printed compared one scenario against another running under an injected fault plan and reported
 * `successRate 1 -> 0 regressed` and `totalTokens 1395 -> 394 improved`: the first was the injected
 * failures and the second was a smaller task, in a document whose limitations mentioned neither.
 *
 * Selection now refuses to prescribe such a pair. This is the other half, for the comparison a person
 * types by hand, which stays possible on purpose and must not stay silent.
 */
describe('compare, the conditions each side ran under', () => {
  const conditioned = (
    label: string,
    runs: readonly RunObservation[],
    conditions: Partial<Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'>>,
  ): ComparisonSide => ({ ...side(label, runs), ...conditions });

  const five = (overrides: Partial<RunMetrics>) => [
    run(overrides),
    run(overrides),
    run(overrides),
    run(overrides),
    run(overrides),
  ];

  const pair = (
    baselineConditions: Partial<Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'>>,
    candidateConditions: Partial<Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'>>,
  ) => {
    const baselineRuns = five({ durationMs: 1000 });
    const candidateRuns = five({ durationMs: 400 });
    return compare({
      baseline: conditioned('baseline', baselineRuns, baselineConditions),
      candidate: conditioned('candidate', candidateRuns, candidateConditions),
      baselineRuns,
      candidateRuns,
      now: NOW,
    });
  };

  it('says so when the two sides ran different scenarios', () => {
    const result = pair({ scenarioId: 'support-desk' }, { scenarioId: 'support-desk-faults' });
    assert.ok(
      result.limitations.some((limitation) =>
        /ran different scenarios, support-desk against support-desk-faults/.test(limitation),
      ),
      `nothing said the two sides ran different work: ${result.limitations.join(' | ')}`,
    );
  });

  it('says so when only one side ran under an injected fault plan', () => {
    const result = pair(
      { scenarioId: 'support-desk' },
      { scenarioId: 'support-desk', faultPlanId: 'fp_injected' },
    );
    assert.ok(
      result.limitations.some((limitation) =>
        /only the candidate side ran under an injected fault plan/.test(limitation),
      ),
      `nothing said one side had faults injected: ${result.limitations.join(' | ')}`,
    );
  });

  it('says nothing about conditions when the two sides ran the same work', () => {
    const result = pair(
      { scenarioId: 'support-desk', faultPlanId: 'fp_same' },
      { scenarioId: 'support-desk', faultPlanId: 'fp_same' },
    );
    assert.equal(
      result.limitations.some((limitation) => /different scenarios|fault plan/.test(limitation)),
      false,
      `a comparison of like with like was qualified anyway: ${result.limitations.join(' | ')}`,
    );
  });

  /* A side that reports no condition is not evidence that its runs agreed, so nothing is claimed. */
  it('claims nothing about a side that reports no condition', () => {
    const result = pair({}, { scenarioId: 'support-desk' });
    assert.equal(
      result.limitations.some((limitation) => /different scenarios/.test(limitation)),
      false,
    );
  });
});

/**
 * Scan-to-scan finding judgement: the Round 3 hole.
 *
 * Binary `finding_resolved` treated a scale-down, a no-op and a scale-up of the same grouped finding as
 * the same failure. With no run metrics, findings must decide improved / unchanged / regressed.
 */
describe('compare, finding scale decides when metrics cannot', () => {
  const scanSide = (reference: string): ComparisonSide => ({
    kind: 'scan',
    reference,
    label: reference,
    runIds: [],
    scanId: reference,
  });

  const grouped = (id: string, occurrences: number) =>
    ({
      id,
      ruleId: 'model-call-without-timeout',
      polarity: 'risk',
      severity: 'medium',
      components: ['model:shared'],
      edges: [],
      metrics: [
        {
          name: 'occurrences',
          value: occurrences,
          unit: 'occurrence',
          sampleSize: occurrences,
          basis: 'discovered',
        },
      ],
      metadata: {},
    }) as never;

  it('calls a scale-down improved, equal scale unchanged, and a scale-up regressed', () => {
    const improve = compare({
      baseline: scanSide('scan_baseline'),
      candidate: scanSide('scan_improve'),
      baselineRuns: [],
      candidateRuns: [],
      baselineFindings: [grouped('OSC-BASE-0001', 6)],
      candidateFindings: [grouped('OSC-CAND-0004', 4)],
      now: NOW,
    });
    assert.equal(improve.verdict, 'improved');
    assert.equal(improve.findingDelta?.scaleChanges?.[0]?.direction, 'improved');

    const noop = compare({
      baseline: scanSide('scan_baseline'),
      candidate: scanSide('scan_noop'),
      baselineRuns: [],
      candidateRuns: [],
      baselineFindings: [grouped('OSC-BASE-0001', 6)],
      candidateFindings: [grouped('OSC-CAND-0006', 6)],
      now: NOW,
    });
    assert.equal(noop.verdict, 'unchanged');

    const regress = compare({
      baseline: scanSide('scan_baseline'),
      candidate: scanSide('scan_regress'),
      baselineRuns: [],
      candidateRuns: [],
      baselineFindings: [grouped('OSC-BASE-0001', 6)],
      candidateFindings: [grouped('OSC-CAND-0007', 7)],
      now: NOW,
    });
    assert.equal(regress.verdict, 'regressed');
    assert.equal(regress.findingDelta?.scaleChanges?.[0]?.direction, 'regressed');
  });

  it('calls an introduced risk a regression even when nothing was resolved', () => {
    const result = compare({
      baseline: scanSide('scan_baseline'),
      candidate: scanSide('scan_worse'),
      baselineRuns: [],
      candidateRuns: [],
      baselineFindings: [grouped('OSC-BASE-0001', 1)],
      candidateFindings: [
        grouped('OSC-CAND-0001', 1),
        {
          id: 'OSC-NEW-0002',
          ruleId: 'prompt-injection-boundary',
          polarity: 'risk',
          severity: 'medium',
          components: ['tool:add'],
          edges: [],
          metrics: [],
          metadata: {},
        } as never,
      ],
      now: NOW,
    });
    assert.equal(result.verdict, 'regressed');
    assert.deepEqual(result.findingDelta?.introduced, ['OSC-NEW-0002']);
  });
});
