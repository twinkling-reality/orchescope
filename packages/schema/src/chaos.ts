import { type Static, Type } from '@sinclair/typebox';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  NonNegativeNumber,
  PositiveInt,
  Timestamp,
} from './primitives.ts';
import { EvaluatorResult } from './evaluator.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * Agent specific fault injection.
 *
 * Two delivery mechanisms exist and both are explicit:
 *  - `cooperative`: the fault plan is handed to the target through ORCHESCOPE_FAULT_PLAN and the
 *    target applies it. Fully deterministic and offline. The bundled demonstration implements it.
 *  - `proxy`: Orchescope runs a loopback fault injecting HTTP proxy and points the target at it
 *    through a base URL environment variable. Works for targets that read their endpoint from the
 *    environment, and requires explicit opt in because it changes where model traffic goes.
 */

export const FaultKind = literals(
  [
    'model_timeout',
    'model_rate_limited',
    'model_server_error',
    'model_malformed_structured_output',
    'model_stream_interrupted',
    'tool_timeout',
    'tool_exception',
    'tool_malformed_result',
    'tool_stale_result',
    'retrieval_empty',
    'retrieval_slow',
    'worker_unavailable',
    'queue_delay',
    'auth_expired',
    'side_effect_partial_success',
    'duplicate_response',
    'context_corruption',
    'prompt_injection_in_content',
  ] as const,
  { description: 'Fault classes Orchescope can inject into an agent system.' },
);
export type FaultKind = Static<typeof FaultKind>;

export const FaultDelivery = literals(['cooperative', 'proxy'] as const);
export type FaultDelivery = Static<typeof FaultDelivery>;

export const FaultSpec = Type.Object(
  {
    kind: FaultKind,
    /** Component name or span operation the fault applies to. `*` targets every match. */
    target: NonEmptyString(),
    delivery: FaultDelivery,
    /** Fraction of matching operations affected, from 0 to 1. Deterministic given a seed. */
    probability: Type.Number({ minimum: 0, maximum: 1 }),
    /** Apply the fault only to these attempt numbers, one based. Empty means every attempt. */
    attempts: Type.Optional(Type.Array(PositiveInt)),
    delayMs: Type.Optional(NonNegativeInt),
    /** Payload for injection faults. Treated as untrusted content by the target and by Orchescope. */
    payload: Type.Optional(Type.String({ maxLength: 4000 })),
    maxApplications: Type.Optional(PositiveInt),
  },
  { additionalProperties: false },
);
export type FaultSpec = Static<typeof FaultSpec>;

export const FaultPlan = Type.Object(
  {
    id: Type.String({ pattern: '^fp_[0-9a-f]{16}$' }),
    seed: NonNegativeInt,
    faults: Type.Array(FaultSpec, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type FaultPlan = Static<typeof FaultPlan>;

/** Where a chaos suite may run. Live environments require explicit approval and a cost ceiling. */
export const ChaosEnvironment = literals(['local_deterministic', 'declared_test', 'live'] as const);
export type ChaosEnvironment = Static<typeof ChaosEnvironment>;

export const ChaosOutcome = Type.Object(
  {
    faultKind: FaultKind,
    target: NonEmptyString(),
    appliedCount: NonNegativeInt,
    runId: NonEmptyString(),
    taskCompleted: Type.Boolean(),
    recovered: Type.Boolean(),
    recoveryTimeMs: Type.Optional(NonNegativeNumber),
    /** Ratio of tokens spent under fault to tokens spent in the baseline run. */
    costAmplification: Type.Optional(Type.Number({ minimum: 0 })),
    retryAmplification: Type.Optional(Type.Number({ minimum: 0 })),
    duplicateSideEffects: NonNegativeInt,
    prohibitedSideEffects: NonNegativeInt,
    userInterventions: NonNegativeInt,
    loopIterations: NonNegativeInt,
    degradedGracefully: Type.Boolean(),
    policyViolations: NonNegativeInt,
    evaluators: Type.Array(EvaluatorResult),
  },
  { additionalProperties: false },
);
export type ChaosOutcome = Static<typeof ChaosOutcome>;

export const ChaosReport = Document(
  schemaId('chaos'),
  SCHEMA_VERSIONS.chaos,
  Type.Object({
    id: Type.String({ pattern: '^chaos_[0-9a-f]{16}$' }),
    scenarioId: NonEmptyString(),
    environment: ChaosEnvironment,
    startedAt: Timestamp,
    finishedAt: Timestamp,
    baselineRunId: NonEmptyString(),
    outcomes: Type.Array(ChaosOutcome),
    /** Faults that were requested but not applied, with the reason. */
    notApplied: Type.Array(
      Type.Object(
        { faultKind: FaultKind, target: NonEmptyString(), reason: NonEmptyString() },
        { additionalProperties: false },
      ),
    ),
    metadata: Metadata,
  }),
);
export type ChaosReport = Static<typeof ChaosReport>;
