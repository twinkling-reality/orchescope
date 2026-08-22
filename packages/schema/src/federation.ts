import { type Static, Type } from '@sinclair/typebox';
import { EdgeKind, EdgeObservation } from './edge.ts';
import { Evidence, EvidenceId } from './evidence.ts';
import { SystemGraph } from './graph.ts';
import { ComponentId } from './identity.ts';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  SemverString,
  Timestamp,
} from './primitives.ts';
import {
  MissingSpanAttribute,
  ObservedSource,
  ObservedValueProvenance,
} from './runtime-topology.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/** An immutable repository coordinate carried independently by a scan and a runtime span. */
export const RepositoryCoordinate = Type.Object(
  {
    repositoryUrl: NonEmptyString(),
    revision: Type.String({ pattern: '^[0-9a-f]{40}$' }),
  },
  { additionalProperties: false },
);
export type RepositoryCoordinate = Static<typeof RepositoryCoordinate>;

/** A component reference whose local identifier is qualified by the repository that declared it. */
export const FederatedComponentReference = Type.Object(
  {
    repository: RepositoryCoordinate,
    componentId: ComponentId,
  },
  { additionalProperties: false },
);
export type FederatedComponentReference = Static<typeof FederatedComponentReference>;

/** One separately scanned graph eligible to participate in federation. */
export const FederatedRepository = Type.Object(
  {
    coordinate: RepositoryCoordinate,
    graph: SystemGraph,
  },
  { additionalProperties: false },
);
export type FederatedRepository = Static<typeof FederatedRepository>;

/** A runtime component joined to one declaration under an exact repository coordinate. */
export const FederatedComponentJoin = Type.Object(
  {
    component: FederatedComponentReference,
    observedKind: NonEmptyString(),
    observedName: NonEmptyString(),
    observedSource: ObservedSource,
    rule: Type.Literal('code_location'),
    runIds: Type.Array(NonEmptyString(), { minItems: 1 }),
    evidence: Type.Array(EvidenceId),
  },
  { additionalProperties: false },
);
export type FederatedComponentJoin = Static<typeof FederatedComponentJoin>;

const FederatedRelationProvenance = Type.Object(
  {
    relation: ObservedValueProvenance,
    from: ObservedValueProvenance,
    to: ObservedValueProvenance,
  },
  { additionalProperties: false },
);

/** A runtime relation whose independently resolved endpoints belong to different repositories. */
export const FederatedRelation = Type.Object(
  {
    kind: EdgeKind,
    from: FederatedComponentReference,
    to: FederatedComponentReference,
    fromObservedSource: ObservedSource,
    toObservedSource: ObservedSource,
    observation: EdgeObservation,
    evidence: Type.Array(EvidenceId),
    provenance: FederatedRelationProvenance,
  },
  { additionalProperties: false },
);
export type FederatedRelation = Static<typeof FederatedRelation>;

export const FederationRefusalReason = literals([
  'missing',
  'conflicting_attributes',
  'invalid_path',
  'repository_mismatch',
  'revision_mismatch',
  'repository_dirty',
  'line_outside_declaration',
  'ambiguous_source_mapping',
  'source_not_declared',
  'relation_evidence_missing',
  'endpoint_refused',
  'same_repository',
] as const);
export type FederationRefusalReason = Static<typeof FederationRefusalReason>;

export const FederationRefusalSample = Type.Object(
  {
    runId: Type.Optional(NonEmptyString()),
    observedKind: Type.Optional(NonEmptyString()),
    observedName: Type.Optional(NonEmptyString()),
    relationKind: Type.Optional(NonEmptyString()),
    repositoryUrl: Type.Optional(NonEmptyString()),
    revision: Type.Optional(Type.String({ pattern: '^[0-9a-f]{40}$' })),
  },
  { additionalProperties: false },
);
export type FederationRefusalSample = Static<typeof FederationRefusalSample>;

/** A bounded, counted refusal rather than a fallback to weaker identity. */
export const FederationRefusal = Type.Object(
  {
    scope: literals(['repository', 'component', 'relation'] as const),
    reason: FederationRefusalReason,
    attribute: Type.Optional(NonEmptyString()),
    count: NonNegativeInt,
    samples: Type.Array(FederationRefusalSample, { maxItems: 10 }),
  },
  { additionalProperties: false },
);
export type FederationRefusal = Static<typeof FederationRefusal>;

/**
 * A self-contained multi-repository result.
 *
 * Each embedded graph stays a closed single-repository document. Qualified references are the only
 * values allowed to cross graph boundaries, so federation does not change local component identity.
 */
export const FederationReport = Document(
  schemaId('federation'),
  SCHEMA_VERSIONS.federation,
  Type.Object({
    federationId: Type.String({ pattern: '^fed_[0-9a-f]{16}$' }),
    generatedAt: Timestamp,
    orchescopeVersion: SemverString,
    repositories: Type.Array(FederatedRepository),
    componentJoins: Type.Array(FederatedComponentJoin),
    relations: Type.Array(FederatedRelation),
    /** Declaration, span and derivation records retain their distinct bases in one closed document. */
    evidence: Type.Array(Evidence),
    coverage: Type.Object(
      {
        repositoriesSupplied: NonNegativeInt,
        eligibleRepositories: NonNegativeInt,
        observedComponents: NonNegativeInt,
        joinedComponents: NonNegativeInt,
        observedRelations: NonNegativeInt,
        withinRepositoryRelations: NonNegativeInt,
        joinedCrossRepositoryRelations: NonNegativeInt,
        sourceIdentity: Type.Array(MissingSpanAttribute),
        refusals: Type.Array(FederationRefusal),
      },
      { additionalProperties: false },
    ),
    metadata: Metadata,
  }),
);
export type FederationReport = Static<typeof FederationReport>;
