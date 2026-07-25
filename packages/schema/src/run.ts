import { type Static, Type } from '@sinclair/typebox';
import { ComponentId } from './identity.ts';
import {
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  SemverString,
  Timestamp,
} from './primitives.ts';

/**
 * A run is one bounded execution that produced runtime evidence: a wrapped process, one scenario
 * repetition, one benchmark variant repetition or one chaos repetition.
 */

export const RunKind = literals([
  'trace',
  'scenario',
  'benchmark_variant',
  'chaos',
  'demonstration',
] as const);
export type RunKind = Static<typeof RunKind>;

export const RunStatus = literals([
  'running',
  'completed',
  'failed',
  'timeout',
  'cancelled',
  'budget_exceeded',
] as const);
export type RunStatus = Static<typeof RunStatus>;

/** Environment capture. Reported with every benchmark so numbers can be judged, not just quoted. */
export const RunEnvironment = Type.Object(
  {
    orchescopeVersion: SemverString,
    platform: NonEmptyString(),
    arch: NonEmptyString(),
    cpuCount: NonNegativeInt,
    cpuModel: Type.Optional(NonEmptyString()),
    totalMemoryBytes: NonNegativeInt,
    runtimeName: NonEmptyString(),
    runtimeVersion: NonEmptyString(),
    /** True when the machine was under other measurable load, which weakens timing comparisons. */
    loadAverage1m: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type RunEnvironment = Static<typeof RunEnvironment>;

/**
 * Metrics for one run. Counters are always present; anything that could not be measured is absent
 * rather than zero, because zero is a measurement.
 */
export const RunMetrics = Type.Object(
  {
    durationMs: Type.Number({ minimum: 0 }),
    timeToFirstOutputMs: Type.Optional(Type.Number({ minimum: 0 })),
    taskSuccess: Type.Optional(Type.Boolean()),
    modelCalls: NonNegativeInt,
    toolCalls: NonNegativeInt,
    agentSteps: NonNegativeInt,
    handoffs: NonNegativeInt,
    retrievalCalls: NonNegativeInt,
    memoryOperations: NonNegativeInt,
    queueWaitMs: Type.Optional(Type.Number({ minimum: 0 })),
    inputTokens: NonNegativeInt,
    outputTokens: NonNegativeInt,
    costUsd: Type.Optional(Type.Number({ minimum: 0 })),
    errors: NonNegativeInt,
    retries: NonNegativeInt,
    recoveredErrors: NonNegativeInt,
    duplicateSideEffects: NonNegativeInt,
    prohibitedSideEffects: NonNegativeInt,
    sideEffects: NonNegativeInt,
    userInterventions: NonNegativeInt,
    policyViolations: NonNegativeInt,
    maxObservedConcurrency: NonNegativeInt,
    loopIterations: NonNegativeInt,
  },
  { additionalProperties: false },
);
export type RunMetrics = Static<typeof RunMetrics>;

/** Per component roll up for one run, used by graph overlays. */
export const ComponentRunMetrics = Type.Object(
  {
    componentId: ComponentId,
    executionCount: NonNegativeInt,
    selfDurationMs: Type.Number({ minimum: 0 }),
    totalDurationMs: Type.Number({ minimum: 0 }),
    p95DurationMs: Type.Optional(Type.Number({ minimum: 0 })),
    inputTokens: NonNegativeInt,
    outputTokens: NonNegativeInt,
    costUsd: Type.Optional(Type.Number({ minimum: 0 })),
    errorCount: NonNegativeInt,
    retryCount: NonNegativeInt,
  },
  { additionalProperties: false },
);
export type ComponentRunMetrics = Static<typeof ComponentRunMetrics>;

export const RunRecord = Type.Object(
  {
    id: Type.String({ pattern: '^run_[0-9a-f]{16}$' }),
    kind: RunKind,
    label: NonEmptyString(),
    status: RunStatus,
    startedAt: Timestamp,
    finishedAt: Type.Optional(Timestamp),
    scenarioId: Type.Optional(NonEmptyString()),
    scenarioVersion: Type.Optional(NonNegativeInt),
    variantId: Type.Optional(NonEmptyString()),
    faultPlanId: Type.Optional(NonEmptyString()),
    experimentId: Type.Optional(NonEmptyString()),
    repetition: Type.Optional(NonNegativeInt),
    environment: RunEnvironment,
    metrics: RunMetrics,
    componentMetrics: Type.Array(ComponentRunMetrics),
    /** Exit code of the wrapped process when a process was wrapped. */
    exitCode: Type.Optional(Type.Integer()),
    failureReason: Type.Optional(Type.String({ maxLength: 1000 })),
    git: Type.Optional(
      Type.Object(
        {
          commit: Type.Optional(Type.String({ pattern: '^[0-9a-f]{7,40}$' })),
          ref: Type.Optional(NonEmptyString()),
          dirty: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    metadata: Metadata,
  },
  { additionalProperties: false },
);
export type RunRecord = Static<typeof RunRecord>;
