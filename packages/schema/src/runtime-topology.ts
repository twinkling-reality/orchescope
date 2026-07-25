import { type Static, Type } from '@sinclair/typebox';
import { EvidenceId } from './evidence.ts';
import {
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  OneBasedLine,
  RelativePath,
  literals,
} from './primitives.ts';
import { AgentOperation, SideEffectRecord } from './trace.ts';

/**
 * The runtime topology is the contract between trace normalisation and graph reconciliation.
 *
 * It is deliberately expressed in observed names rather than component identifiers: at this stage
 * nothing has been matched to the static model yet, and pretending otherwise is how a runtime graph
 * silently invents components.
 */

/**
 * Source position carried by a span through the OpenTelemetry `code.*` attributes. This is the
 * strongest join key available between an observed span and a statically discovered component.
 */
export const ObservedCodeLocation = Type.Object(
  {
    file: RelativePath,
    line: Type.Optional(OneBasedLine),
    function: Type.Optional(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type ObservedCodeLocation = Static<typeof ObservedCodeLocation>;

export const ObservedComponent = Type.Object(
  {
    /** Component kind inferred from the operation and attribute shape. */
    kind: NonEmptyString(),
    observedName: NonEmptyString(),
    operation: AgentOperation,
    spanCount: NonNegativeInt,
    errorCount: NonNegativeInt,
    retryCount: NonNegativeInt,
    /** Time in this component excluding time in its children. */
    selfDurationMs: Type.Number({ minimum: 0 }),
    totalDurationMs: Type.Number({ minimum: 0 }),
    durationsMs: Type.Array(Type.Number({ minimum: 0 })),
    inputTokens: NonNegativeInt,
    outputTokens: NonNegativeInt,
    provider: Type.Optional(NonEmptyString()),
    model: Type.Optional(NonEmptyString()),
    codeLocation: Type.Optional(ObservedCodeLocation),
    /** Set when the span carried MCP attributes, which makes the tool a cross process call. */
    mcpServer: Type.Optional(NonEmptyString()),
    /** True when the component performed at least one declared side effect. */
    performedSideEffect: Type.Boolean(),
    evidence: Type.Array(EvidenceId),
    attributes: Metadata,
  },
  { additionalProperties: false },
);
export type ObservedComponent = Static<typeof ObservedComponent>;

export const ObservedEdge = Type.Object(
  {
    kind: NonEmptyString(),
    fromKind: NonEmptyString(),
    fromObservedName: NonEmptyString(),
    toKind: NonEmptyString(),
    toObservedName: NonEmptyString(),
    executionCount: NonNegativeInt,
    errorCount: NonNegativeInt,
    retryCount: NonNegativeInt,
    /** Times this relation overlapped in wall clock with a sibling relation of the same parent. */
    parallelCount: NonNegativeInt,
    totalDurationMs: Type.Number({ minimum: 0 }),
    durationsMs: Type.Array(Type.Number({ minimum: 0 })),
    inputTokens: NonNegativeInt,
    outputTokens: NonNegativeInt,
    evidence: Type.Array(EvidenceId),
  },
  { additionalProperties: false },
);
export type ObservedEdge = Static<typeof ObservedEdge>;

export const RuntimeTopology = Type.Object(
  {
    runIds: Type.Array(NonEmptyString(), { minItems: 1 }),
    components: Type.Array(ObservedComponent),
    edges: Type.Array(ObservedEdge),
    sideEffects: Type.Array(SideEffectRecord),
    /** Repository revision reported by the target through the OpenTelemetry `vcs.*` attributes. */
    vcs: Type.Optional(
      Type.Object(
        {
          revision: Type.Optional(Type.String({ pattern: '^[0-9a-f]{7,40}$' })),
          ref: Type.Optional(NonEmptyString()),
          repositoryName: Type.Optional(NonEmptyString()),
        },
        { additionalProperties: false },
      ),
    ),
    /** Spans that could not be attributed to any component, with the reason. */
    unattributed: Type.Array(
      Type.Object(
        {
          reason: literals(['no_operation', 'no_name', 'unsupported_dialect'] as const),
          count: NonNegativeInt,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type RuntimeTopology = Static<typeof RuntimeTopology>;
