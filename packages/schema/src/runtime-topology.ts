import { type Static, Type } from '@sinclair/typebox';
import { EvidenceId } from './evidence.ts';
import {
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  OneBasedLine,
  RelativePath,
  Sha256Hex,
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

/**
 * The exact span inputs that produced one value in the observed topology.
 *
 * An empty attribute list is meaningful: it says the value came from a span field rather than leaving
 * provenance unstated. Keeping endpoint provenance separate from relation provenance is what lets
 * reconciliation distinguish a nesting the run reported from an endpoint copied out of a declaration.
 */
export const ObservedValueProvenance = Type.Object(
  {
    /** Attributes carried by the span itself. */
    attributes: Type.Array(NonEmptyString()),
    /** Attributes carried by the resource that owns this span. */
    resourceAttributes: Type.Optional(Type.Array(NonEmptyString())),
    spanFields: Type.Array(literals(['name', 'operation', 'parentSpanId'] as const)),
  },
  { additionalProperties: false },
);
export type ObservedValueProvenance = Static<typeof ObservedValueProvenance>;

/**
 * A runtime coordinate complete enough to compare with a separately scanned repository.
 *
 * A repository, an immutable revision and a path inside it. This is the form that survives leaving the
 * workspace that produced it, so a run reaching a second checkout is described by it and federation
 * rests on nothing else. What it costs is a clean checkout with a remote, which a tree somebody is
 * editing does not have; [ObservedContentLocation] is what that tree can produce instead.
 */
export const ObservedSourceIdentity = Type.Object(
  {
    repositoryUrl: NonEmptyString(),
    revision: Type.String({ pattern: '^[0-9a-f]{40}$' }),
    file: RelativePath,
    line: Type.Optional(OneBasedLine),
    function: Type.Optional(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type ObservedSourceIdentity = Static<typeof ObservedSourceIdentity>;

/** The exact span or resource attribute behind each field in an observed source identity. */
export const ObservedSource = Type.Object(
  {
    identity: ObservedSourceIdentity,
    provenance: Type.Object(
      {
        repositoryUrl: ObservedValueProvenance,
        revision: ObservedValueProvenance,
        file: ObservedValueProvenance,
        line: Type.Optional(ObservedValueProvenance),
        function: Type.Optional(ObservedValueProvenance),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ObservedSource = Static<typeof ObservedSource>;

/**
 * A runtime coordinate that proves itself by the contents of the file rather than by a revision.
 *
 * A path relative to the scanned root and the digest of the file as the run found it. It answers the
 * question a revision answers, which is whether the file the run pointed at is the file the declaration
 * was read from, and it answers it directly: a reader can check it with `sha256sum` where a revision has
 * to be trusted to imply it. It is also the only form a working tree can produce, because a tree with
 * uncommitted work has no immutable revision to report.
 *
 * It is deliberately not part of [ObservedSourceIdentity] and cannot stand in for one. Two repositories
 * can hold a byte-identical file at one path, so this says nothing outside the workspace that produced
 * it, and a federated join must not read it. Keeping them apart is what stops the weaker claim being
 * mistaken for the stronger one by anything that only checks whether a source is present.
 */
export const ObservedContentLocation = Type.Object(
  {
    /** Path inside the root the audit scanned, which is the form a declaration is recorded against. */
    file: RelativePath,
    digest: Sha256Hex,
    line: Type.Optional(OneBasedLine),
    function: Type.Optional(NonEmptyString()),
    provenance: Type.Object(
      {
        file: ObservedValueProvenance,
        digest: ObservedValueProvenance,
        line: Type.Optional(ObservedValueProvenance),
        function: Type.Optional(ObservedValueProvenance),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ObservedContentLocation = Static<typeof ObservedContentLocation>;

export const MissingSpanAttribute = Type.Object(
  {
    attribute: NonEmptyString(),
    purpose: literals(['code_location', 'source_identity'] as const),
    reason: Type.Optional(
      literals([
        'missing',
        'conflicting_attributes',
        'invalid_path',
        'repository_mismatch',
        'revision_mismatch',
        'line_outside_declaration',
        'ambiguous_source_mapping',
        'source_not_declared',
        /** The file the run read is not the file the declaration was read from. */
        'digest_mismatch',
      ] as const),
    ),
    /** Observed components in this run that did not carry the attribute. */
    observedComponents: NonNegativeInt,
    /** Bounded span evidence sample establishing the refusal population. */
    evidence: Type.Optional(Type.Array(EvidenceId, { maxItems: 10 })),
    /** Further affected components outside the evidence sample. */
    evidenceOmitted: Type.Optional(NonNegativeInt),
  },
  { additionalProperties: false },
);
export type MissingSpanAttribute = Static<typeof MissingSpanAttribute>;

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
    /** Complete runtime source identity, including separate provenance for every field. */
    observedSource: Type.Optional(ObservedSource),
    /** Where the call was made, proved by the file's contents rather than by a revision. */
    observedContent: Type.Optional(ObservedContentLocation),
    /** Set when the span carried MCP attributes, which makes the tool a cross process call. */
    mcpServer: Type.Optional(NonEmptyString()),
    /** True when the component performed at least one declared side effect. */
    performedSideEffect: Type.Boolean(),
    evidence: Type.Array(EvidenceId),
    attributes: Metadata,
    provenance: Type.Object(
      {
        kind: ObservedValueProvenance,
        name: ObservedValueProvenance,
        codeLocation: ObservedValueProvenance,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ObservedComponent = Static<typeof ObservedComponent>;

export const ObservedEdge = Type.Object(
  {
    kind: NonEmptyString(),
    fromKind: NonEmptyString(),
    fromObservedName: NonEmptyString(),
    fromObservedSource: Type.Optional(ObservedSource),
    toKind: NonEmptyString(),
    toObservedName: NonEmptyString(),
    toObservedSource: Type.Optional(ObservedSource),
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
    provenance: Type.Object(
      {
        /** The span input that says this relation happened, apart from the inputs naming its ends. */
        relation: ObservedValueProvenance,
        from: ObservedValueProvenance,
        to: ObservedValueProvenance,
      },
      { additionalProperties: false },
    ),
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
    coverage: Type.Object(
      {
        /** Accepted spans inspected by topology derivation. Missing on imported legacy topologies. */
        acceptedSpans: Type.Optional(NonNegativeInt),
        /** Spans dropped before inspection because the configured receiver ceiling was reached. */
        droppedSpans: Type.Optional(NonNegativeInt),
        /** Inputs rejected during trace validation and therefore absent from the inspected population. */
        rejectedSpans: Type.Optional(NonNegativeInt),
        missingSpanAttributes: Type.Array(MissingSpanAttribute),
      },
      { additionalProperties: false },
    ),
    /** Repository revision reported by the target through the OpenTelemetry `vcs.*` attributes. */
    vcs: Type.Optional(
      Type.Object(
        {
          revision: Type.Optional(Type.String({ pattern: '^[0-9a-f]{7,40}$' })),
          ref: Type.Optional(NonEmptyString()),
          repositoryName: Type.Optional(NonEmptyString()),
          repositoryUrl: Type.Optional(NonEmptyString()),
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
