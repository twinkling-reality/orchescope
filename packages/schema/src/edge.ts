import { type Static, Type } from '@sinclair/typebox';
import { ClaimBasis, ConfigLocation, EvidenceId, SourceLocation } from './evidence.ts';
import { ComponentId, EdgeId } from './identity.ts';
import { Confidence, literals, Metadata, NonEmptyString, NonNegativeInt } from './primitives.ts';

/**
 * Relations between components. Every edge kind answers a specific review question, which is why
 * there is no generic `depends_on`.
 */
export const EDGE_KINDS = [
  'contains',
  'invokes_model',
  'calls_tool',
  'hands_off_to',
  'uses_prompt',
  'reads_memory',
  'writes_memory',
  'queries_retrieval',
  'publishes_to_queue',
  'consumes_from_queue',
  'calls_service',
  'queries_database',
  'provides_tool',
  'served_by_provider',
  'falls_back_to',
  'guarded_by',
  'performs_side_effect',
  'validated_by',
  'observed_after',
] as const;

export const EdgeKind = literals(EDGE_KINDS, {
  description: 'Kind of relation between two components.',
});
export type EdgeKind = Static<typeof EdgeKind>;

export const BackoffKind = literals(['none', 'fixed', 'exponential', 'unknown'] as const);

/** Reliability configuration attached to a relation, as discovered or as observed. */
export const EdgePolicy = Type.Object(
  {
    timeoutMs: Type.Optional(NonNegativeInt),
    retry: Type.Optional(
      Type.Object(
        {
          maxAttempts: Type.Optional(NonNegativeInt),
          bounded: Type.Boolean({
            description: 'False when no attempt ceiling could be established.',
          }),
          backoff: BackoffKind,
          /** Whether an idempotency key was found on the retried operation. */
          idempotency: literals(['declared', 'absent', 'unknown'] as const),
        },
        { additionalProperties: false },
      ),
    ),
    concurrency: Type.Optional(NonNegativeInt),
    requiresApproval: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type EdgePolicy = Static<typeof EdgePolicy>;

/** Aggregated runtime facts for a relation. Absent when the relation was never observed. */
export const EdgeObservation = Type.Object(
  {
    executionCount: NonNegativeInt,
    errorCount: NonNegativeInt,
    retryCount: NonNegativeInt,
    /** Number of times this relation ran concurrently with a sibling relation. */
    parallelCount: NonNegativeInt,
    totalDurationMs: Type.Number({ minimum: 0 }),
    p50DurationMs: Type.Optional(Type.Number({ minimum: 0 })),
    p95DurationMs: Type.Optional(Type.Number({ minimum: 0 })),
    maxDurationMs: Type.Optional(Type.Number({ minimum: 0 })),
    inputTokens: NonNegativeInt,
    outputTokens: NonNegativeInt,
    costUsd: Type.Optional(Type.Number({ minimum: 0 })),
    runIds: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type EdgeObservation = Static<typeof EdgeObservation>;

export const Edge = Type.Object(
  {
    id: EdgeId,
    kind: EdgeKind,
    from: ComponentId,
    to: ComponentId,
    basis: ClaimBasis,
    confidence: Confidence,
    discoveredBy: Type.Array(NonEmptyString(), { minItems: 1 }),
    sourceLocations: Type.Array(SourceLocation),
    configLocations: Type.Array(ConfigLocation),
    evidence: Type.Array(EvidenceId),
    policy: Type.Optional(EdgePolicy),
    observation: Type.Optional(EdgeObservation),
    /** True when the relation is only present in runtime traces and absent from the static model. */
    runtimeOnly: Type.Boolean(),
    metadata: Metadata,
  },
  { additionalProperties: false },
);
export type Edge = Static<typeof Edge>;
