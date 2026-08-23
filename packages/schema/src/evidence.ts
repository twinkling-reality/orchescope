import { type Static, Type } from '@sinclair/typebox';
import {
  Confidence,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  NonNegativeNumber,
  OneBasedLine,
  RelativePath,
  Sha256Hex,
  ZeroBasedColumn,
} from './primitives.ts';

/**
 * Evidence is the only thing Orchescope is allowed to argue from. Every component, edge, metric
 * and finding carries evidence references, and every evidence record is content addressed so the
 * same fact discovered twice is stored once.
 */

/** How a claim was established. Presenting an inference as an observation is a defect. */
export const ClaimBasis = literals(
  ['observed', 'discovered', 'inferred', 'estimated', 'simulated', 'model_interpreted'] as const,
  {
    description:
      'observed: seen in a runtime trace. discovered: read from source or configuration. ' +
      'inferred: derived from other evidence by a deterministic rule. estimated: computed from a ' +
      'model of the system rather than measured. simulated: produced under injected faults. ' +
      'model_interpreted: proposed by a language model and reviewed against supplied evidence.',
  },
);
export type ClaimBasis = Static<typeof ClaimBasis>;

export const SourceLocation = Type.Object(
  {
    file: RelativePath,
    startLine: OneBasedLine,
    startColumn: Type.Optional(ZeroBasedColumn),
    endLine: Type.Optional(OneBasedLine),
    endColumn: Type.Optional(ZeroBasedColumn),
    /** Digest of the file contents when the location was recorded, so staleness is detectable. */
    fileHash: Type.Optional(Sha256Hex),
  },
  { additionalProperties: false },
);
export type SourceLocation = Static<typeof SourceLocation>;

export const ConfigLocation = Type.Object(
  {
    file: RelativePath,
    /** RFC 6901 JSON pointer into the parsed configuration document. */
    pointer: Type.String({ pattern: '^(?:/(?:[^/~]|~[01])*)*$' }),
    fileHash: Type.Optional(Sha256Hex),
  },
  { additionalProperties: false },
);
export type ConfigLocation = Static<typeof ConfigLocation>;

const evidenceBase = {
  /** Content address of the evidence record. Equal content yields an equal identifier. */
  id: Type.String({ pattern: '^ev_[0-9a-f]{16}$' }),
  basis: ClaimBasis,
  /** Identifier of the analyser that produced the evidence, for example `adapter:openai-agents-js`. */
  producer: NonEmptyString(),
};

export const SourceSpanEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('source_span'),
    location: SourceLocation,
    /** Short excerpt, already redacted. Long excerpts are stored as artifacts instead. */
    excerpt: Type.Optional(Type.String({ maxLength: 2000 })),
    symbol: Type.Optional(
      NonEmptyString({ description: 'Resolved symbol or expression that matched.' }),
    ),
  },
  { additionalProperties: false },
);

export const ConfigEntryEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('config_entry'),
    location: ConfigLocation,
    value: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

export const DependencyEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('dependency'),
    manifest: RelativePath,
    packageName: NonEmptyString(),
    versionRange: Type.Optional(Type.String()),
    ecosystem: literals(['npm', 'pypi'] as const),
  },
  { additionalProperties: false },
);

export const SpanEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('span'),
    runId: NonEmptyString(),
    traceId: Type.String({ pattern: '^[0-9a-f]{32}$' }),
    spanId: Type.String({ pattern: '^[0-9a-f]{16}$' }),
    spanName: NonEmptyString(),
    /** Exact observed component coordinate when this accepted span was attributable. */
    observedComponent: Type.Optional(
      Type.Object(
        { kind: NonEmptyString(), observedName: NonEmptyString() },
        { additionalProperties: false },
      ),
    ),
    attribute: Type.Optional(NonEmptyString()),
    attributeValue: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

const metricEvidenceBase = {
  ...evidenceBase,
  kind: Type.Literal('metric'),
  metric: NonEmptyString(),
  value: Type.Number(),
  unit: NonEmptyString(),
  /** Number of metric observations, distinct from the exact run population below. */
  sampleSize: NonNegativeInt,
  componentId: Type.Optional(Type.String()),
};

export const MetricEvidence = Type.Union([
  Type.Object(
    {
      ...metricEvidenceBase,
      /** Exact run identity for an established single-run metric. */
      runId: NonEmptyString(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...metricEvidenceBase,
      /** Exact bounded run population for an aggregate metric. */
      runIds: Type.Array(NonEmptyString(), { minItems: 1, maxItems: 100 }),
    },
    { additionalProperties: false },
  ),
]);

export const ScenarioOutcomeEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('scenario_outcome'),
    runId: NonEmptyString(),
    scenarioId: NonEmptyString(),
    variantId: Type.Optional(NonEmptyString()),
    outcome: literals(['success', 'failure', 'timeout', 'budget_exceeded', 'error'] as const),
    evaluator: Type.Optional(NonEmptyString()),
    detail: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

export const FaultInjectionEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('fault_injection'),
    runId: NonEmptyString(),
    faultKind: NonEmptyString(),
    target: NonEmptyString(),
    appliedCount: NonNegativeInt,
    /** Outcome facts carried with the injection so a resilience claim cites more than application alone. */
    taskCompleted: Type.Optional(Type.Boolean()),
    recovered: Type.Optional(Type.Boolean()),
    duplicateSideEffects: Type.Optional(NonNegativeInt),
    costAmplification: Type.Optional(Type.Number({ minimum: 0 })),
    retryAmplification: Type.Optional(Type.Number({ minimum: 0 })),
    prohibitedSideEffects: Type.Optional(NonNegativeInt),
    userInterventions: Type.Optional(NonNegativeInt),
    degradedGracefully: Type.Optional(Type.Boolean()),
    policyViolations: Type.Optional(NonNegativeInt),
  },
  { additionalProperties: false },
);

export const ModelInterpretationEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('model_interpretation'),
    taskId: NonEmptyString(),
    provider: NonEmptyString(),
    model: NonEmptyString(),
    promptHash: Sha256Hex,
    /** Artifact reference holding the full request and response for audit. */
    transcriptRef: Type.Optional(Sha256Hex),
    /** Evidence the interpretation was asked to explain. A claim outside these bounds is rejected. */
    groundedIn: Type.Array(Type.String({ pattern: '^ev_[0-9a-f]{16}$' })),
    reviewed: Type.Boolean(),
    reviewVerdict: Type.Optional(literals(['supported', 'unsupported', 'conflicting'] as const)),
  },
  { additionalProperties: false },
);

export const DerivedEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('derived'),
    rule: NonEmptyString({
      description: 'Identifier of the deterministic rule that derived the claim.',
    }),
    inputs: Type.Array(Type.String({ pattern: '^ev_[0-9a-f]{16}$' }), { minItems: 1 }),
    note: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

export const AbsenceEvidence = Type.Object(
  {
    ...evidenceBase,
    kind: Type.Literal('absence'),
    /** What was searched, so that "not found" is auditable rather than an assertion. */
    searched: NonEmptyString(),
    scope: NonEmptyString(),
    inspectedCount: NonNegativeInt,
  },
  { additionalProperties: false },
);

export const Evidence = Type.Union([
  SourceSpanEvidence,
  ConfigEntryEvidence,
  DependencyEvidence,
  SpanEvidence,
  MetricEvidence,
  ScenarioOutcomeEvidence,
  FaultInjectionEvidence,
  ModelInterpretationEvidence,
  DerivedEvidence,
  AbsenceEvidence,
]);
export type Evidence = Static<typeof Evidence>;
export type EvidenceKind = Evidence['kind'];

export const EvidenceId = Type.String({ pattern: '^ev_[0-9a-f]{16}$' });
export type EvidenceId = Static<typeof EvidenceId>;

/** A claim with its supporting evidence, used wherever a value needs provenance. */
export const Claim = Type.Object(
  {
    basis: ClaimBasis,
    confidence: Confidence,
    evidence: Type.Array(EvidenceId),
    metadata: Type.Optional(Metadata),
  },
  { additionalProperties: false },
);
export type Claim = Static<typeof Claim>;

export const MeasuredValue = Type.Object(
  {
    value: NonNegativeNumber,
    unit: NonEmptyString(),
    sampleSize: NonNegativeInt,
    basis: ClaimBasis,
  },
  { additionalProperties: false },
);
export type MeasuredValue = Static<typeof MeasuredValue>;
