import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fixedClock, isOrchescopeError, summarize } from '@orchescope/domain';
import { computeReliability } from '@orchescope/scenarios';
import {
  ChaosReport,
  type EvaluatorResult,
  type FaultPlan,
  type FaultSpec,
  MIN_READABLE_VERSIONS,
  type RepetitionResult,
  type RunEnvironment,
  type RunMetrics,
  SCHEMA_VERSIONS,
  type Scenario,
  type ScenarioResult,
  validateDocument,
} from '@orchescope/schema';
import { assertEnvironmentAllowed, buildFaultPlan, singleFaultPlans } from '../src/plan.ts';
import { runChaosSuite } from '../src/run.ts';

/**
 * Chaos mechanics with stubbed runs. The interesting cases are the honest ones: a fault the target never
 * applied produces no outcome, and an amplification with a zero baseline produces no ratio.
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

const modelTimeout: FaultSpec = {
  kind: 'model_timeout',
  target: '*',
  delivery: 'cooperative',
  probability: 1,
};

const toolException: FaultSpec = {
  kind: 'tool_exception',
  target: 'issue_refund',
  delivery: 'cooperative',
  probability: 0.5,
};

const scenario: Scenario = {
  schemaVersion: 1,
  id: 'refund-flow',
  name: 'Refund flow',
  target: {
    command: ['node', 'main.ts'],
    resultSource: 'result_file',
    timeoutMs: 1000,
    stopSignal: 'SIGTERM',
  },
  evaluators: [],
  budgets: {},
  faults: [modelTimeout, toolException],
  requiredPermissions: [],
  tags: [],
  metadata: {},
};

const passingEvaluator: EvaluatorResult = {
  kind: 'exit_code',
  passed: true,
  detail: 'the target exited with code 0',
};

const runMetrics = (input: {
  readonly durationMs: number;
  readonly tokens: number;
  readonly retries: number;
  readonly duplicates: number;
}): RunMetrics => ({
  durationMs: input.durationMs,
  modelCalls: 2,
  toolCalls: 1,
  agentSteps: 1,
  handoffs: 0,
  retrievalCalls: 0,
  memoryOperations: 0,
  inputTokens: input.tokens,
  outputTokens: 0,
  errors: input.retries,
  retries: input.retries,
  recoveredErrors: input.retries,
  duplicateSideEffects: input.duplicates,
  prohibitedSideEffects: 0,
  sideEffects: 1,
  userInterventions: 1,
  policyViolations: 0,
  maxObservedConcurrency: 1,
  loopIterations: 2,
});

const repetitionFor = (input: {
  readonly index: number;
  readonly durationMs: number;
  readonly tokens: number;
  readonly retries: number;
  readonly succeeded: boolean;
  readonly appliedFault?: FaultSpec;
  readonly appliedCount?: number;
  readonly duplicates?: number;
}): RepetitionResult => ({
  runId: `run_${String(input.index).padStart(16, '0')}`,
  repetition: input.index,
  status: input.succeeded ? 'completed' : 'failed',
  taskSuccess: input.succeeded,
  metrics: runMetrics({
    durationMs: input.durationMs,
    tokens: input.tokens,
    retries: input.retries,
    duplicates: input.duplicates ?? 0,
  }),
  evaluators: [passingEvaluator],
  sideEffects: [],
  duplicateSideEffectKeys: [],
  prohibitedSideEffectKinds: [],
  faultsApplied:
    input.appliedFault === undefined
      ? []
      : [
          {
            kind: input.appliedFault.kind,
            target: 'openai/gpt-4o-mini',
            appliedCount: input.appliedCount ?? 1,
          },
        ],
});

const resultFor = (repetitions: readonly RepetitionResult[]): ScenarioResult => {
  const metrics = repetitions.map((repetition) => repetition.metrics);
  return {
    schemaVersion: SCHEMA_VERSIONS.scenarioResult,
    id: 'sres_0123456789abcdef',
    scenarioId: scenario.id,
    scenarioVersion: scenario.schemaVersion,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    environment,
    repetitions: [...repetitions],
    aggregate: {
      variantId: 'default',
      variant: {},
      runIds: repetitions.map((repetition) => repetition.runId),
      repetitions: repetitions.length,
      completedRuns: repetitions.filter((repetition) => repetition.status === 'completed').length,
      failedRuns: repetitions.filter((repetition) => repetition.status !== 'completed').length,
      durationMs: summarize(metrics.map((entry) => entry.durationMs)),
      totalTokens: summarize(metrics.map((entry) => entry.inputTokens + entry.outputTokens)),
      modelCalls: summarize(metrics.map((entry) => entry.modelCalls)),
      toolCalls: summarize(metrics.map((entry) => entry.toolCalls)),
      retries: summarize(metrics.map((entry) => entry.retries)),
      aggregateMetrics: runMetrics({ durationMs: 0, tokens: 0, retries: 0, duplicates: 0 }),
      evaluators: [passingEvaluator],
    },
    reliability: computeReliability(repetitions),
    passed: repetitions.every((repetition) => repetition.status === 'completed'),
    limitations: [],
    metadata: {},
  };
};

const baselineResult = (retriesPerRun = 1): ScenarioResult =>
  resultFor([
    repetitionFor({
      index: 0,
      durationMs: 100,
      tokens: 100,
      retries: retriesPerRun,
      succeeded: true,
    }),
    repetitionFor({
      index: 1,
      durationMs: 120,
      tokens: 100,
      retries: retriesPerRun,
      succeeded: true,
    }),
  ]);

/** The fault run: the target applied the model timeout twice and recovered after retrying. */
const faultedResult = (): ScenarioResult =>
  resultFor([
    repetitionFor({
      index: 2,
      durationMs: 400,
      tokens: 250,
      retries: 3,
      succeeded: true,
      appliedFault: modelTimeout,
      appliedCount: 2,
      duplicates: 1,
    }),
    repetitionFor({
      index: 3,
      durationMs: 420,
      tokens: 250,
      retries: 3,
      succeeded: true,
      appliedFault: modelTimeout,
      appliedCount: 2,
    }),
  ]);

/** The fault run for a fault the target never applied. */
const untouchedResult = (): ScenarioResult =>
  resultFor([
    repetitionFor({ index: 4, durationMs: 110, tokens: 100, retries: 1, succeeded: true }),
  ]);

const policyDenied = (error: unknown): boolean =>
  isOrchescopeError(error) && error.code === 'POLICY_DENIED';

describe('assertEnvironmentAllowed', () => {
  it('refuses a live run that was not explicitly allowed', () => {
    assert.throws(
      () => assertEnvironmentAllowed('live', ['local_deterministic', 'declared_test']),
      policyDenied,
    );
  });

  it('names the owner of the system in the refusal for a live run', () => {
    assert.throws(
      () => assertEnvironmentAllowed('live', []),
      (error: unknown) =>
        isOrchescopeError(error) && (error.remediation ?? '').includes('owner of the system'),
    );
  });

  it('allows an environment the policy lists', () => {
    assert.doesNotThrow(() => assertEnvironmentAllowed('live', ['live']));
    assert.doesNotThrow(() =>
      assertEnvironmentAllowed('local_deterministic', ['local_deterministic']),
    );
  });

  it('refuses a declared test environment that was not granted', () => {
    assert.throws(
      () => assertEnvironmentAllowed('declared_test', ['local_deterministic']),
      policyDenied,
    );
  });
});

describe('buildFaultPlan', () => {
  it('derives the identifier from the seed and the faults', () => {
    const first = buildFaultPlan({ faults: [modelTimeout], seed: 7 });
    const again = buildFaultPlan({ faults: [modelTimeout], seed: 7 });
    const other = buildFaultPlan({ faults: [modelTimeout], seed: 8 });
    assert.equal(first.id, again.id);
    assert.notEqual(first.id, other.id);
    assert.match(first.id, /^fp_[0-9a-f]{16}$/);
  });

  it('refuses an empty plan and a negative seed', () => {
    assert.throws(
      () => buildFaultPlan({ faults: [], seed: 1 }),
      (error: unknown) => isOrchescopeError(error) && error.code === 'INVALID_ARGUMENT',
    );
    assert.throws(
      () => buildFaultPlan({ faults: [modelTimeout], seed: -1 }),
      (error: unknown) => isOrchescopeError(error) && error.code === 'INVALID_ARGUMENT',
    );
  });
});

describe('singleFaultPlans', () => {
  it('produces one plan per fault, all sharing the seed', () => {
    const plans = singleFaultPlans(scenario, 42);
    assert.equal(plans.length, 2);
    assert.deepEqual(
      plans.map((entry) => entry.plan.faults.length),
      [1, 1],
    );
    assert.deepEqual(
      plans.map((entry) => entry.plan.seed),
      [42, 42],
    );
    assert.deepEqual(
      plans.map((entry) => entry.fault.kind),
      ['model_timeout', 'tool_exception'],
    );
    assert.deepEqual(plans[0]?.plan.faults, [modelTimeout]);
    assert.notEqual(plans[0]?.plan.id, plans[1]?.plan.id);
  });
});

describe('runChaosSuite', () => {
  const runSuite = async (input: {
    readonly baseline: ScenarioResult;
    readonly perFault: (plan: FaultPlan) => ScenarioResult;
  }) =>
    runChaosSuite({
      scenario,
      environment: 'local_deterministic',
      allowedEnvironments: ['local_deterministic'],
      seed: 7,
      repetitions: 2,
      clock: fixedClock(Date.parse('2026-01-01T00:00:00.000Z'), 1),
      runBaseline: () => Promise.resolve(input.baseline),
      runWithPlan: (plan) => Promise.resolve(input.perFault(plan)),
    });

  it('computes amplification against the baseline and attributes the outcome to one fault', async () => {
    const report = await runSuite({
      baseline: baselineResult(),
      perFault: (plan) =>
        plan.faults[0]?.kind === 'model_timeout' ? faultedResult() : untouchedResult(),
    });

    assert.equal(report.baselineRunId, 'run_0000000000000000');
    assert.equal(report.outcomes.length, 1);
    const outcome = report.outcomes[0];
    assert.ok(outcome !== undefined);
    assert.equal(outcome.faultKind, 'model_timeout');
    assert.equal(outcome.target, '*');
    assert.equal(outcome.appliedCount, 4);
    assert.equal(outcome.taskCompleted, true);
    assert.equal(outcome.recovered, true);
    assert.equal(outcome.degradedGracefully, true);
    assert.equal(outcome.recoveryTimeMs, 400);
    // 250 tokens per repetition under fault against 100 in the baseline.
    assert.equal(outcome.costAmplification, 2.5);
    assert.equal(outcome.retryAmplification, 3);
    assert.equal(outcome.duplicateSideEffects, 1);
    assert.equal(outcome.userInterventions, 2);
    assert.equal(outcome.loopIterations, 4);
    assert.equal(outcome.policyViolations, 0);
    assert.deepEqual(outcome.evaluators, [passingEvaluator]);

    assert.deepEqual(report.notApplied, [
      {
        faultKind: 'tool_exception',
        target: 'issue_refund',
        reason: 'the target reported no application of this fault',
      },
    ]);

    const validated = validateDocument(
      ChaosReport,
      SCHEMA_VERSIONS.chaos,
      MIN_READABLE_VERSIONS.chaos,
      report,
    );
    assert.ok(validated.ok, `the report should match its schema: ${JSON.stringify(validated)}`);
  });

  it('omits an amplification the baseline cannot support', async () => {
    const report = await runSuite({
      baseline: baselineResult(0),
      perFault: (plan) =>
        plan.faults[0]?.kind === 'model_timeout' ? faultedResult() : untouchedResult(),
    });
    const outcome = report.outcomes[0];
    assert.ok(outcome !== undefined);
    assert.equal(
      outcome.retryAmplification,
      undefined,
      'no retries in the baseline means no ratio',
    );
    assert.equal(outcome.costAmplification, 2.5);
  });

  it('refuses a live environment before running anything', async () => {
    let started = false;
    await assert.rejects(
      () =>
        runChaosSuite({
          scenario,
          environment: 'live',
          allowedEnvironments: ['local_deterministic'],
          seed: 1,
          repetitions: 1,
          clock: fixedClock(0, 1),
          runBaseline: () => {
            started = true;
            return Promise.resolve(baselineResult());
          },
          runWithPlan: () => Promise.resolve(untouchedResult()),
        }),
      policyDenied,
    );
    assert.equal(started, false, 'the baseline must not run when the environment is refused');
  });

  it('reports every fault as not applied when the target ignored the plan', async () => {
    const report = await runSuite({
      baseline: baselineResult(),
      perFault: () => untouchedResult(),
    });
    assert.deepEqual(report.outcomes, []);
    assert.equal(report.notApplied.length, 2);
    assert.ok(report.notApplied.every((entry) => entry.reason.includes('reported no application')));
  });
});
