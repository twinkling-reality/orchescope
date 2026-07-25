import { type Static, Type } from '@sinclair/typebox';
import { VariantResult } from './benchmark.ts';
import { FaultKind } from './chaos.ts';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  Timestamp,
} from './primitives.ts';
import { RunEnvironment, RunMetrics } from './run.ts';
import { EvaluatorResult } from './evaluator.ts';
import { SideEffectRecord } from './trace.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * The result of executing one scenario, with every repetition kept alongside the aggregate. Raw
 * measurements are never discarded, because a summary that cannot be recomputed cannot be audited.
 */

export const RepetitionResult = Type.Object(
  {
    runId: NonEmptyString(),
    repetition: NonNegativeInt,
    status: literals(['completed', 'failed', 'timeout', 'cancelled', 'budget_exceeded'] as const),
    taskSuccess: Type.Optional(Type.Boolean()),
    metrics: RunMetrics,
    evaluators: Type.Array(EvaluatorResult),
    sideEffects: Type.Array(SideEffectRecord),
    duplicateSideEffectKeys: Type.Array(NonEmptyString()),
    prohibitedSideEffectKinds: Type.Array(NonEmptyString()),
    faultsApplied: Type.Array(
      Type.Object(
        { kind: FaultKind, target: NonEmptyString(), appliedCount: NonNegativeInt },
        { additionalProperties: false },
      ),
    ),
    exitCode: Type.Optional(Type.Integer()),
    failureReason: Type.Optional(Type.String({ maxLength: 1000 })),
    /** Bounded excerpt of the target output, redacted, kept for the report detail view. */
    outputExcerpt: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false },
);
export type RepetitionResult = Static<typeof RepetitionResult>;

/**
 * Reliability across repetitions.
 *
 * `pass^k` is the probability that k independently sampled runs all succeed, estimated as
 * C(successes, k) / C(total, k). It is the metric introduced by tau-bench (https://arxiv.org/abs/2406.12045)
 * and is reported instead of a bare success rate because an agent system that succeeds four times out
 * of five is not a system that succeeds.
 */
export const Reliability = Type.Object(
  {
    repetitions: NonNegativeInt,
    successes: NonNegativeInt,
    successRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    passPowerK: Type.Array(
      Type.Object(
        { k: NonNegativeInt, value: Type.Number({ minimum: 0, maximum: 1 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type Reliability = Static<typeof Reliability>;

export const ScenarioResult = Document(
  schemaId('scenarioResult'),
  SCHEMA_VERSIONS.scenarioResult,
  Type.Object({
    id: Type.String({ pattern: '^sres_[0-9a-f]{16}$' }),
    scenarioId: NonEmptyString(),
    scenarioVersion: NonNegativeInt,
    startedAt: Timestamp,
    finishedAt: Timestamp,
    environment: RunEnvironment,
    repetitions: Type.Array(RepetitionResult, { minItems: 1 }),
    aggregate: VariantResult,
    reliability: Reliability,
    passed: Type.Boolean({ description: 'True when every repetition satisfied every evaluator.' }),
    limitations: Type.Array(NonEmptyString()),
    metadata: Metadata,
  }),
);
export type ScenarioResult = Static<typeof ScenarioResult>;
