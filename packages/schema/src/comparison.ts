import { type Static, Type } from '@sinclair/typebox';
import { ComponentId, EdgeId } from './identity.ts';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  Timestamp,
} from './primitives.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * Baseline versus candidate comparison. A comparison never claims an improvement from latency alone:
 * a verdict requires the success rate to hold and the sample size to be reported.
 */

export const ComparisonSideKind = literals([
  'run',
  'benchmark_variant',
  'git_ref',
  'scan',
] as const);
export type ComparisonSideKind = Static<typeof ComparisonSideKind>;

export const ComparisonSide = Type.Object(
  {
    kind: ComparisonSideKind,
    reference: NonEmptyString({ description: 'Run id, variant id, git ref or scan id.' }),
    label: NonEmptyString(),
    /** Present when this side executed the system rather than only analysing it. */
    runIds: Type.Array(NonEmptyString()),
    scanId: Type.Optional(NonEmptyString()),
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
  },
  { additionalProperties: false },
);
export type ComparisonSide = Static<typeof ComparisonSide>;

export const MetricDelta = Type.Object(
  {
    metric: NonEmptyString(),
    unit: NonEmptyString(),
    baseline: Type.Optional(Type.Number()),
    candidate: Type.Optional(Type.Number()),
    absoluteChange: Type.Optional(Type.Number()),
    relativeChange: Type.Optional(
      Type.Number({ description: 'Fraction, so 0.15 means fifteen percent.' }),
    ),
    baselineSamples: NonNegativeInt,
    candidateSamples: NonNegativeInt,
    direction: literals(['improved', 'regressed', 'unchanged', 'indeterminate'] as const),
    /** Set when the sample size or variance does not support a directional claim. */
    caveat: Type.Optional(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type MetricDelta = Static<typeof MetricDelta>;

export const GraphDelta = Type.Object(
  {
    addedComponents: Type.Array(ComponentId),
    removedComponents: Type.Array(ComponentId),
    renamedComponents: Type.Array(
      Type.Object({ from: ComponentId, to: ComponentId }, { additionalProperties: false }),
    ),
    changedComponents: Type.Array(
      Type.Object(
        { componentId: ComponentId, changes: Type.Array(NonEmptyString()) },
        { additionalProperties: false },
      ),
    ),
    addedEdges: Type.Array(EdgeId),
    removedEdges: Type.Array(EdgeId),
  },
  { additionalProperties: false },
);
export type GraphDelta = Static<typeof GraphDelta>;

export const FindingDelta = Type.Object(
  {
    resolved: Type.Array(NonEmptyString()),
    introduced: Type.Array(NonEmptyString()),
    unchanged: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type FindingDelta = Static<typeof FindingDelta>;

export const ComparisonVerdict = literals([
  'improved',
  'regressed',
  'mixed',
  'unchanged',
  'insufficient_evidence',
] as const);
export type ComparisonVerdict = Static<typeof ComparisonVerdict>;

export const Comparison = Document(
  schemaId('comparison'),
  SCHEMA_VERSIONS.comparison,
  Type.Object({
    id: Type.String({ pattern: '^cmp_[0-9a-f]{16}$' }),
    createdAt: Timestamp,
    baseline: ComparisonSide,
    candidate: ComparisonSide,
    goalId: Type.Optional(Type.String({ pattern: '^OSC-GOAL-\\d{4}$' })),
    metricDeltas: Type.Array(MetricDelta),
    graphDelta: Type.Optional(GraphDelta),
    findingDelta: Type.Optional(FindingDelta),
    verdict: ComparisonVerdict,
    verdictReason: NonEmptyString(),
    /** Acceptance criteria evaluated when the comparison validates a goal. */
    acceptanceResults: Type.Array(
      Type.Object(
        {
          criterion: NonEmptyString(),
          satisfied: Type.Boolean(),
          detail: NonEmptyString(),
        },
        { additionalProperties: false },
      ),
    ),
    limitations: Type.Array(NonEmptyString()),
    metadata: Metadata,
  }),
);
export type Comparison = Static<typeof Comparison>;
