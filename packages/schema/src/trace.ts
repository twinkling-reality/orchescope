import { type Static, Type } from '@sinclair/typebox';
import { ComponentId } from './identity.ts';
import {
  Document,
  literals,
  Metadata,
  MetadataValue,
  NonEmptyString,
  NonNegativeInt,
  Timestamp,
} from './primitives.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * Runtime evidence, normalised from OpenTelemetry into the shape Orchescope reasons about.
 *
 * Nanosecond timestamps stay strings because a nanosecond epoch does not fit in a double. Durations
 * are computed once during normalisation and stored in milliseconds.
 */

export const SpanKind = literals([
  'unspecified',
  'internal',
  'server',
  'client',
  'producer',
  'consumer',
] as const);
export type SpanKind = Static<typeof SpanKind>;

export const SpanStatus = literals(['unset', 'ok', 'error'] as const);
export type SpanStatus = Static<typeof SpanStatus>;

/**
 * The agent-system operation a span represents. Derived from `gen_ai.operation.name` when present,
 * otherwise from the span name and attribute shape. `unclassified` is kept rather than guessed.
 */
export const AgentOperation = literals([
  'invoke_agent',
  'chat',
  'text_completion',
  'embeddings',
  'execute_tool',
  'create_agent',
  'invoke_workflow',
  'plan',
  'handoff',
  'retrieval',
  'memory_read',
  'memory_write',
  'queue_wait',
  'side_effect',
  'approval',
  'evaluation',
  /**
   * A request the system made to something outside itself.
   *
   * The generative AI conventions have no word for this, and the declared model has had `external_service`
   * from the beginning, so until now only source analysis could populate it: a run could not say which of
   * the services a repository talks to it actually reached. That is the half of the reconciliation the
   * whole product is about, missing for the components whose repeats are the most expensive.
   */
  'outbound_request',
  'unclassified',
] as const);
export type AgentOperation = Static<typeof AgentOperation>;

export const SpanEvent = Type.Object(
  {
    name: NonEmptyString(),
    timeUnixNano: Type.String({ pattern: '^\\d+$' }),
    attributes: Type.Record(Type.String(), MetadataValue),
  },
  { additionalProperties: false },
);
export type SpanEvent = Static<typeof SpanEvent>;

/**
 * A declared side effect, reported by the instrumented target as a span event. Duplicate detection
 * uses the triple (kind, target, idempotencyKey); an absent key means duplicates cannot be ruled out.
 */
export const SideEffectRecord = Type.Object(
  {
    kind: NonEmptyString(),
    target: NonEmptyString(),
    idempotencyKey: Type.Optional(NonEmptyString()),
    traceId: Type.String({ pattern: '^[0-9a-f]{32}$' }),
    spanId: Type.String({ pattern: '^[0-9a-f]{16}$' }),
    spanName: NonEmptyString(),
    outcome: literals(['succeeded', 'failed', 'partial', 'unknown'] as const),
    /** Attempt number the effect was performed on, when the target reported one. */
    retryAttempt: Type.Optional(NonNegativeInt),
    timeUnixNano: Type.String({ pattern: '^\\d+$' }),
  },
  { additionalProperties: false },
);
export type SideEffectRecord = Static<typeof SideEffectRecord>;

export const NormalizedSpan = Type.Object(
  {
    traceId: Type.String({ pattern: '^[0-9a-f]{32}$' }),
    spanId: Type.String({ pattern: '^[0-9a-f]{16}$' }),
    parentSpanId: Type.Optional(Type.String({ pattern: '^[0-9a-f]{16}$' })),
    name: NonEmptyString(),
    kind: SpanKind,
    operation: AgentOperation,
    startTimeUnixNano: Type.String({ pattern: '^\\d+$' }),
    endTimeUnixNano: Type.String({ pattern: '^\\d+$' }),
    durationMs: Type.Number({ minimum: 0 }),
    status: SpanStatus,
    statusMessage: Type.Optional(Type.String({ maxLength: 1000 })),
    attributes: Type.Record(Type.String(), MetadataValue),
    /** Bounded attributes of the resource that emitted this span, retained per span. */
    resourceAttributes: Type.Optional(Type.Record(Type.String(), MetadataValue)),
    events: Type.Array(SpanEvent),
    serviceName: NonEmptyString(),
    scopeName: Type.Optional(NonEmptyString()),
    /** Component this span is attributed to, once reconciliation has run. */
    componentId: Type.Optional(ComponentId),
    /** True when the span was retried by the instrumented system, per `orchescope.retry.attempt`. */
    retryAttempt: Type.Optional(NonNegativeInt),
  },
  { additionalProperties: false },
);
export type NormalizedSpan = Static<typeof NormalizedSpan>;

export const TraceSource = literals([
  'otlp_http_json',
  'otlp_http_protobuf',
  'imported_ndjson',
  'imported_otlp_json',
] as const);
export type TraceSource = Static<typeof TraceSource>;

export const TraceBundle = Document(
  schemaId('traceBundle'),
  SCHEMA_VERSIONS.traceBundle,
  Type.Object({
    runId: Type.String({ pattern: '^run_[0-9a-f]{16}$' }),
    capturedAt: Timestamp,
    source: TraceSource,
    /** Services that reported spans, useful when a target spawns child processes. */
    services: Type.Array(NonEmptyString()),
    spans: Type.Array(NormalizedSpan),
    sideEffects: Type.Array(SideEffectRecord),
    droppedSpanCount: NonNegativeInt,
    /** Spans rejected during validation, with the reason, so ingestion failures are visible. */
    rejected: Type.Array(
      Type.Object(
        { reason: NonEmptyString(), count: NonNegativeInt },
        { additionalProperties: false },
      ),
    ),
    metadata: Metadata,
  }),
);
export type TraceBundle = Static<typeof TraceBundle>;
