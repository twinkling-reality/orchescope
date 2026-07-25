import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock, isOrchescopeError, summarize } from '@orchescope/domain';
import { computeReliability } from '@orchescope/scenarios';
import {
  BenchmarkReport,
  MIN_READABLE_VERSIONS,
  type RepetitionResult,
  type RunEnvironment,
  type RunMetrics,
  SCHEMA_VERSIONS,
  type Scenario,
  type ScenarioResult,
  type ScenarioVariant,
  type VariantResult,
  validateDocument,
} from '@orchescope/schema';
import { limitationsFor } from '../src/limitations.ts';
import { runBenchmark } from '../src/run.ts';
import { buildVariants, parseDimensionValues } from '../src/variants.ts';

/**
 * Benchmarking with stubbed scenario runs, so the experiment mechanics are tested without spawning anything:
 * that warmup runs never reach a reported number, and that the report says out loud what it cannot support.
 */

const environment: RunEnvironment = {
  orchescopeVersion: '0.1.0',
  platform: 'test',
  arch: 'test',
  cpuCount: 1,
  totalMemoryBytes: 1_000_000,
  runtimeName: 'node',
  runtimeVersion: '24.0.0',
};

const scenario: Scenario = {
  schemaVersion: 1,
  id: 'temp-target',
  name: 'Temporary target',
  target: {
    command: ['node', 'main.ts'],
    resultSource: 'result_file',
    timeoutMs: 1000,
    stopSignal: 'SIGTERM',
  },
  evaluators: [],
  budgets: {},
  faults: [],
  requiredPermissions: [],
  tags: [],
  metadata: {},
};

const runMetrics = (durationMs: number, tokens: number): RunMetrics => ({
  durationMs,
  modelCalls: 1,
  toolCalls: 1,
  agentSteps: 1,
  handoffs: 0,
  retrievalCalls: 0,
  memoryOperations: 0,
  inputTokens: tokens,
  outputTokens: 0,
  errors: 0,
  retries: 0,
  recoveredErrors: 0,
  duplicateSideEffects: 0,
  prohibitedSideEffects: 0,
  sideEffects: 0,
  userInterventions: 0,
  policyViolations: 0,
  maxObservedConcurrency: 1,
  loopIterations: 1,
});

const repetitionsFor = (
  durations: readonly number[],
  tokensPerRun: number,
): readonly RepetitionResult[] =>
  durations.map((durationMs, index) => ({
    runId: `run_${String(index).padStart(16, '0')}`,
    repetition: index,
    status: 'completed' as const,
    taskSuccess: true,
    metrics: runMetrics(durationMs, tokensPerRun),
    evaluators: [],
    sideEffects: [],
    duplicateSideEffectKeys: [],
    prohibitedSideEffectKinds: [],
    faultsApplied: [],
  }));

const variantResultFor = (
  variant: ScenarioVariant,
  repetitions: readonly RepetitionResult[],
): VariantResult => {
  const metrics = repetitions.map((repetition) => repetition.metrics);
  return {
    variantId: variant.id ?? 'default',
    variant,
    runIds: repetitions.map((repetition) => repetition.runId),
    repetitions: repetitions.length,
    completedRuns: repetitions.length,
    failedRuns: 0,
    successRate: 1,
    durationMs: summarize(metrics.map((entry) => entry.durationMs)),
    totalTokens: summarize(metrics.map((entry) => entry.inputTokens + entry.outputTokens)),
    modelCalls: summarize(metrics.map((entry) => entry.modelCalls)),
    toolCalls: summarize(metrics.map((entry) => entry.toolCalls)),
    retries: summarize(metrics.map((entry) => entry.retries)),
    aggregateMetrics: runMetrics(
      metrics.reduce((total, entry) => total + entry.durationMs, 0),
      metrics.reduce((total, entry) => total + entry.inputTokens, 0),
    ),
    evaluators: [],
  };
};

const scenarioResultFor = (
  variant: ScenarioVariant,
  durations: readonly number[],
  tokensPerRun: number,
): ScenarioResult => {
  const repetitions = repetitionsFor(durations, tokensPerRun);
  return {
    schemaVersion: SCHEMA_VERSIONS.scenarioResult,
    id: 'sres_0123456789abcdef',
    scenarioId: scenario.id,
    scenarioVersion: scenario.schemaVersion,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    environment,
    repetitions: [...repetitions],
    aggregate: variantResultFor(variant, repetitions),
    reliability: computeReliability(repetitions),
    passed: true,
    limitations: [],
    metadata: {},
  };
};

const invalidArgument = (error: unknown): boolean =>
  isOrchescopeError(error) && error.code === 'INVALID_ARGUMENT';

describe('parseDimensionValues', () => {
  it('accepts a comma separated list of counts', () => {
    assert.deepEqual(parseDimensionValues('1,2,4'), [1, 2, 4]);
    assert.deepEqual(parseDimensionValues(' 1 , 8 '), [1, 8]);
  });

  it('rejects zero, because a variant with no agents is not a variant', () => {
    assert.throws(() => parseDimensionValues('0'), invalidArgument);
  });

  it('rejects a value that is not a number', () => {
    assert.throws(() => parseDimensionValues('abc'), invalidArgument);
    assert.throws(() => parseDimensionValues('1,-2'), invalidArgument);
    assert.throws(() => parseDimensionValues('1.5'), invalidArgument);
  });

  it('rejects an empty list and a repeated value', () => {
    assert.throws(() => parseDimensionValues('  '), invalidArgument);
    assert.throws(() => parseDimensionValues('2,2'), invalidArgument);
  });
});

describe('buildVariants', () => {
  it('varies one field per dimension and names each variant', () => {
    const variants = buildVariants({ dimension: 'agent_count', values: [1, 4] });
    assert.deepEqual(
      variants.map((variant) => variant.id),
      ['agent_count=1', 'agent_count=4'],
    );
    assert.deepEqual(
      variants.map((variant) => variant.agents),
      [1, 4],
    );
  });

  it('splits a model configuration into provider and model', () => {
    const variants = buildVariants({
      dimension: 'model_config',
      values: ['openai/gpt-4o-mini'],
    });
    assert.deepEqual(variants[0]?.model, { provider: 'openai', model: 'gpt-4o-mini' });
    assert.throws(
      () => buildVariants({ dimension: 'model_config', values: ['gpt-4o'] }),
      invalidArgument,
    );
  });

  it('keeps the base variant and records a git reference in the environment', () => {
    const variants = buildVariants({
      dimension: 'git_ref',
      values: ['main'],
      base: { id: 'baseline', agents: 2, env: { TARGET_MODE: 'batch' } },
    });
    assert.equal(variants[0]?.id, 'baseline/git_ref=main');
    assert.equal(variants[0]?.agents, 2);
    assert.deepEqual(variants[0]?.env, { TARGET_MODE: 'batch', ORCHESCOPE_GIT_REF: 'main' });
  });

  it('refuses a count that is not a positive whole number', () => {
    assert.throws(
      () => buildVariants({ dimension: 'agent_count', values: ['abc'] }),
      invalidArgument,
    );
    assert.throws(() => buildVariants({ dimension: 'worker_count', values: [0] }), invalidArgument);
  });
});

describe('runBenchmark', () => {
  it('runs warmup runs first and excludes them from every reported number', async () => {
    const calls: number[] = [];
    const report = await runBenchmark({
      scenario,
      dimension: 'agent_count',
      values: [1, 2],
      repetitions: 3,
      warmupRuns: 2,
      clock: fixedClock(Date.parse('2026-01-01T00:00:00.000Z'), 1),
      environment,
      run: (variant, repetitions) => {
        calls.push(repetitions);
        const warmup = repetitions === 2;
        return Promise.resolve(
          scenarioResultFor(variant, warmup ? [900, 950] : [100, 110, 120], warmup ? 5000 : 100),
        );
      },
    });

    assert.deepEqual(calls, [2, 3, 2, 3], 'each variant warms up before it is measured');
    assert.equal(report.warmupRuns, 2);
    assert.equal(report.variants.length, 2);
    for (const variant of report.variants) {
      assert.deepEqual(variant.durationMs.values, [100, 110, 120]);
      assert.equal(variant.totalTokens.max, 100);
      assert.equal(variant.successRate, 1);
    }
    assert.deepEqual(
      report.variants.map((variant) => variant.variantId),
      ['agent_count=1', 'agent_count=2'],
    );

    const validated = validateDocument(
      BenchmarkReport,
      SCHEMA_VERSIONS.benchmark,
      MIN_READABLE_VERSIONS.benchmark,
      report,
    );
    assert.ok(validated.ok, `the report should match its schema: ${JSON.stringify(validated)}`);
  });

  it('states that a comparison is not compute normalised when token use differs', async () => {
    const report = await runBenchmark({
      scenario,
      dimension: 'agent_count',
      values: [1, 2],
      repetitions: 3,
      warmupRuns: 0,
      clock: fixedClock(Date.parse('2026-01-01T00:00:00.000Z'), 1),
      environment,
      run: (variant, _repetitions) =>
        Promise.resolve(
          scenarioResultFor(variant, [100, 100, 100], variant.agents === 1 ? 100 : 200),
        ),
    });

    const note = report.limitations.find((entry) => entry.includes('not compute normalised'));
    assert.ok(note !== undefined, `expected a compute note: ${JSON.stringify(report.limitations)}`);
    assert.match(note, /100 percent more tokens/);
    assert.ok(report.limitations.some((entry) => entry.includes('fewer than 5 completed runs')));
    assert.ok(
      report.limitations.every((entry) => !entry.includes('significan')),
      'a benchmark never claims statistical significance',
    );
  });

  it('says nothing about compute normalisation when token use is within ten percent', () => {
    const first = variantResultFor({ id: 'a' }, repetitionsFor([100, 100, 100], 100));
    const second = variantResultFor({ id: 'b' }, repetitionsFor([100, 100, 100], 105));
    const notes = limitationsFor([first, second]);
    assert.ok(notes.every((note) => !note.includes('not compute normalised')));
    assert.ok(notes.some((note) => note.includes('quantiles')));
  });

  it('refuses a repetition count below one', async () => {
    await assert.rejects(
      () =>
        runBenchmark({
          scenario,
          dimension: 'agent_count',
          values: [1],
          repetitions: 0,
          warmupRuns: 0,
          clock: fixedClock(0, 1),
          environment,
          run: (variant) => Promise.resolve(scenarioResultFor(variant, [1], 1)),
        }),
      invalidArgument,
    );
  });
});
