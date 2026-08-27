import { resolve, sep } from 'node:path';
import {
  type Clock,
  type Deadline,
  OrchescopeError,
  runId,
  scenarioResultId,
} from '@orchescope/domain';
import { runTracedSession } from '@orchescope/runtime';
import {
  type FaultPlan,
  type RepetitionResult,
  type RunEnvironment,
  type RunRecord,
  SCHEMA_VERSIONS,
  type Scenario,
  type ScenarioResult,
  type ScenarioVariant,
  type TraceBundle,
} from '@orchescope/schema';
import { deriveTopology, type TopologyResult } from '@orchescope/traces';
import { aggregateVariant, scenarioLimitations } from './aggregate.ts';
import { scenarioEnv } from './env.ts';
import { assertPermissions, type ScenarioPolicy } from './policy.ts';
import { computeReliability } from './reliability.ts';
import { buildRepetition } from './repetition.ts';

/**
 * Scenario execution.
 *
 * Repetitions run one after another. Concurrency inside a repetition is the target's business, requested
 * through `ORCHESCOPE_CONCURRENCY`, because two repetitions running at once would compete for the same CPU
 * and turn every duration in the report into a measurement of the machine rather than of the system.
 *
 * Safety boundaries that are not configurable, because a caller has no reason to widen them:
 *  - the target output kept in memory is capped, so a target that prints without end degrades to truncated
 *    output rather than to an exhausted machine;
 *  - termination escalates from the stop signal to SIGKILL after a grace period;
 *  - the trace receiver binds an ephemeral loopback port, so two runs on one machine never collide.
 */

const MAX_TARGET_OUTPUT_BYTES = 1_000_000;
const KILL_AFTER_MS = 2_000;
const EPHEMERAL_PORT = 0;

export type RunScenarioInput = {
  readonly scenario: Scenario;
  readonly variant?: ScenarioVariant;
  /** Overrides `scenario.repetitions`. */
  readonly repetitions?: number;
  readonly faultPlan?: FaultPlan;
  readonly projectRoot: string;
  readonly projectId: string;
  readonly clock: Clock;
  readonly deadline: Deadline;
  readonly policy: ScenarioPolicy;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly orchescopeVersion: string;
  readonly environment: RunEnvironment;
  readonly onProgress?: (event: {
    readonly repetition: number;
    readonly total: number;
    readonly status: string;
  }) => void;
};

export type ScenarioRunArtifacts = {
  readonly result: ScenarioResult;
  readonly runs: readonly {
    readonly run: RunRecord;
    readonly bundle: TraceBundle;
    readonly topology: TopologyResult;
  }[];
};

type RepetitionRun = {
  readonly repetition: RepetitionResult;
  readonly run: RunRecord;
  readonly bundle: TraceBundle;
  readonly topology: TopologyResult;
};

type RepetitionContext = {
  readonly cwd: string;
  readonly startedAt: string;
  readonly index: number;
  readonly timeoutMs: number;
  readonly costCeilingUsd: number | undefined;
};

const resolveTargetCwd = (projectRoot: string, scenario: Scenario): string => {
  const root = resolve(projectRoot);
  const cwd = scenario.target.cwd;
  const resolved = cwd === undefined ? root : resolve(root, cwd);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new OrchescopeError(
      'POLICY_DENIED',
      'The scenario working directory resolves outside the project root.',
      {
        detail: { cwd: cwd ?? '.' },
        remediation: 'Use a project relative working directory that stays inside the repository.',
      },
    );
  }
  return resolved;
};

/** What is left of the policy cost ceiling. An infinite ceiling means the policy sets no limit. */
const remainingCostCeiling = (policy: ScenarioPolicy, spentUsd: number): number | undefined =>
  Number.isFinite(policy.maxCostUsd) ? Math.max(0, policy.maxCostUsd - spentUsd) : undefined;

const buildRunRecord = (input: {
  readonly scenario: Scenario;
  readonly variantId: string | undefined;
  readonly faultPlanId: string | undefined;
  readonly repetition: RepetitionResult;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly environment: RunEnvironment;
  readonly orchescopeVersion: string;
}): RunRecord => ({
  id: input.repetition.runId,
  kind: 'scenario',
  label: `${input.scenario.id} repetition ${input.repetition.repetition + 1}`,
  status: input.repetition.status,
  startedAt: input.startedAt,
  finishedAt: input.finishedAt,
  scenarioId: input.scenario.id,
  scenarioVersion: input.scenario.schemaVersion,
  ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
  ...(input.faultPlanId === undefined ? {} : { faultPlanId: input.faultPlanId }),
  repetition: input.repetition.repetition,
  environment: input.environment,
  metrics: input.repetition.metrics,
  // Component identifiers are assigned by graph reconciliation, which the caller runs against the topology
  // returned alongside this record. Attributing metrics to identifiers here would invent them.
  componentMetrics: [],
  ...(input.repetition.exitCode === undefined ? {} : { exitCode: input.repetition.exitCode }),
  ...(input.repetition.failureReason === undefined
    ? {}
    : { failureReason: input.repetition.failureReason }),
  metadata: { orchescopeVersion: input.orchescopeVersion },
});

const runRepetition = async (
  input: RunScenarioInput,
  context: RepetitionContext,
): Promise<RepetitionRun> => {
  const scenario = input.scenario;
  const id = runId({
    projectId: input.projectId,
    kind: 'scenario',
    label: scenario.id,
    startedAt: context.startedAt,
    sequence: context.index,
  });
  const startedAt = input.clock.now();
  const session = await runTracedSession({
    command: scenario.target.command,
    cwd: context.cwd,
    runId: id,
    baseEnv: input.baseEnv,
    extraEnv: scenarioEnv(scenario, input.variant, context.index),
    serviceName: scenario.id,
    clock: input.clock,
    deadline: input.deadline,
    timeoutMs: context.timeoutMs,
    drainMs: input.policy.exportDrainMs,
    autoInstrument: input.policy.autoInstrument,
    maxSpansPerRun: input.policy.maxSpansPerRun,
    maxRequestBytes: input.policy.maxRequestBytes,
    maxSpanAttributeBytes: input.policy.maxSpanAttributeBytes,
    maxOutputBytes: MAX_TARGET_OUTPUT_BYTES,
    allowedCommands: input.policy.allowedCommands,
    receiverHost: input.policy.receiverHost,
    receiverPort: EPHEMERAL_PORT,
    stopSignal: scenario.target.stopSignal ?? 'SIGTERM',
    killAfterMs: KILL_AFTER_MS,
    ...(input.faultPlan === undefined ? {} : { faultPlan: input.faultPlan }),
  });
  const topology = deriveTopology(session.bundle);
  const repetition = buildRepetition({
    scenario,
    runId: id,
    index: context.index,
    session,
    topology,
    costCeilingUsd: context.costCeilingUsd,
    timeoutMs: context.timeoutMs,
  });
  return {
    repetition,
    bundle: session.bundle,
    topology,
    run: buildRunRecord({
      scenario,
      variantId: input.variant?.id,
      faultPlanId: input.faultPlan?.id,
      repetition,
      startedAt,
      finishedAt: input.clock.now(),
      environment: input.environment,
      orchescopeVersion: input.orchescopeVersion,
    }),
  };
};

/**
 * Whether the scenario passed, which is not the same question reliability asks.
 *
 * A skipped evaluator is a question the scenario asked and nothing answered, and `evaluate` states the
 * contract it is written against: a skipped result "never counts as a failure and never counts as a
 * pass". This once read `skipped === true || passed`, which counted it as a pass, so a target that
 * emitted no span and wrote no result file produced evaluators that all skipped and a verdict of passed.
 * That is the loop closing on nothing, and it is the same defect as a goal criterion nobody decided being
 * reported satisfied.
 *
 * `repetitionSucceeded` in `reliability.ts` keeps the other reading on purpose, and the two are not in
 * conflict. Reliability is a rate over repetitions, and a skip is constant across all of them, so folding
 * it in would drive every rate to zero and say nothing about how the system varies. This is a verdict on
 * one scenario, and a verdict that ignores an unanswered question is not a verdict.
 */
const everyRepetitionPassed = (repetitions: readonly RepetitionResult[]): boolean =>
  repetitions.every(
    (repetition) =>
      repetition.status === 'completed' &&
      repetition.evaluators.every((result) => result.skipped !== true && result.passed),
  );

const requestedRepetitions = (input: RunScenarioInput): number => {
  const requested = input.repetitions ?? input.scenario.repetitions ?? 1;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'A scenario runs at least one repetition.', {
      detail: { repetitions: requested },
      remediation: 'Pass a positive integer repetition count.',
    });
  }
  return requested;
};

export const runScenarioWithArtifacts = async (
  input: RunScenarioInput,
): Promise<ScenarioRunArtifacts> => {
  assertPermissions(input.scenario, input.policy);
  const total = requestedRepetitions(input);
  const cwd = resolveTargetCwd(input.projectRoot, input.scenario);
  const timeoutMs = Math.min(input.scenario.target.timeoutMs, input.policy.maxRunDurationMs);
  const startedAt = input.clock.now();
  const runs: RepetitionRun[] = [];
  let spentUsd = 0;

  for (let index = 0; index < total; index += 1) {
    // A cancelled or expired deadline stops the loop once there is something to report. With nothing to
    // report yet, `check` raises the cancellation or timeout error instead of returning an empty result.
    if (runs.length > 0 && (input.deadline.signal.aborted || input.deadline.expired())) break;
    input.deadline.check(`scenario ${input.scenario.id}`);
    input.onProgress?.({ repetition: index, total, status: 'started' });
    const outcome = await runRepetition(input, {
      cwd,
      startedAt,
      index,
      timeoutMs,
      costCeilingUsd: remainingCostCeiling(input.policy, spentUsd),
    });
    runs.push(outcome);
    spentUsd += outcome.repetition.metrics.costUsd ?? 0;
    input.onProgress?.({ repetition: index, total, status: outcome.repetition.status });
    if (outcome.repetition.status === 'budget_exceeded') break;
  }

  const repetitions = runs.map((entry) => entry.repetition);
  const aggregate = aggregateVariant({ variant: input.variant, repetitions });
  const proxyFaults = (input.faultPlan?.faults ?? []).filter(
    (fault) => fault.delivery === 'proxy',
  ).length;
  const result: ScenarioResult = {
    schemaVersion: SCHEMA_VERSIONS.scenarioResult,
    id: scenarioResultId({ scenarioId: input.scenario.id, startedAt }),
    scenarioId: input.scenario.id,
    scenarioVersion: input.scenario.schemaVersion,
    startedAt,
    finishedAt: input.clock.now(),
    environment: input.environment,
    repetitions,
    aggregate,
    reliability: computeReliability(repetitions),
    passed: repetitions.length === total && everyRepetitionPassed(repetitions),
    limitations: [
      ...scenarioLimitations({
        repetitions,
        aggregate,
        requestedRepetitions: total,
        proxyFaultCount: proxyFaults,
      }),
    ],
    metadata: {
      orchescopeVersion: input.orchescopeVersion,
      variantId: aggregate.variantId,
      ...(input.faultPlan === undefined ? {} : { faultPlanId: input.faultPlan.id }),
    },
  };
  return {
    result,
    runs: runs.map((entry) => ({
      run: entry.run,
      bundle: entry.bundle,
      topology: entry.topology,
    })),
  };
};

export const runScenario = async (input: RunScenarioInput): Promise<ScenarioResult> =>
  (await runScenarioWithArtifacts(input)).result;
