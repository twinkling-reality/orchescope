import { type Static, Type } from '@sinclair/typebox';
import { ClaimBasis, EvidenceId, SourceLocation } from './evidence.ts';
import { ComponentId, EdgeId } from './identity.ts';
import {
  Confidence,
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  Timestamp,
} from './primitives.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * A finding is a reviewable claim about the system with the evidence attached. Findings are not
 * advice: a finding that cannot name affected components and evidence is rejected before storage.
 */

export const FindingCategory = literals([
  'architecture',
  'performance',
  'cost',
  'reliability',
  'resilience',
  'security',
  'permissions',
  'agent_complexity',
  'maintainability',
  'scenario_coverage',
  'observability',
] as const);
export type FindingCategory = Static<typeof FindingCategory>;

export const Severity = literals(['critical', 'high', 'medium', 'low', 'info'] as const);
export type Severity = Static<typeof Severity>;

/**
 * Whether the finding reports a risk or a strength. Strengths use `info` severity and are shown in
 * their own section, because a report that only lists problems is not a review.
 */
export const FindingPolarity = literals(['risk', 'strength'] as const);
export type FindingPolarity = Static<typeof FindingPolarity>;

export const Recommendation = Type.Object(
  {
    summary: NonEmptyString({ description: 'What to change, in one sentence.' }),
    steps: Type.Array(NonEmptyString()),
    /** Effort estimate is a design judgement, labelled as such in the report. */
    effort: literals(['small', 'medium', 'large', 'unknown'] as const),
    risk: literals(['low', 'medium', 'high', 'unknown'] as const),
  },
  { additionalProperties: false },
);
export type Recommendation = Static<typeof Recommendation>;

export const SuggestedExperiment = Type.Object(
  {
    description: NonEmptyString(),
    command: Type.Array(NonEmptyString(), {
      minItems: 1,
      description: 'Argv of the command to run.',
    }),
    scenarioId: Type.Optional(NonEmptyString()),
    expectedSignal: NonEmptyString({
      description: 'The measurement that would confirm or refute this.',
    }),
  },
  { additionalProperties: false },
);
export type SuggestedExperiment = Static<typeof SuggestedExperiment>;

export const FindingMetric = Type.Object(
  {
    name: NonEmptyString(),
    value: Type.Number(),
    unit: NonEmptyString(),
    sampleSize: NonNegativeInt,
    basis: ClaimBasis,
    comparisonValue: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);
export type FindingMetric = Static<typeof FindingMetric>;

export const Finding = Type.Object(
  {
    /** Stable, readable identifier, for example `OSC-PERF-0003`. */
    id: Type.String({ pattern: '^OSC-[A-Z]{3,5}-\\d{4}$' }),
    /** Identifier of the rule or analysis task that produced this finding. */
    ruleId: NonEmptyString(),
    category: FindingCategory,
    polarity: FindingPolarity,
    severity: Severity,
    confidence: Confidence,
    basis: ClaimBasis,
    title: NonEmptyString({ description: 'One line, specific, no advice verbs.' }),
    explanation: NonEmptyString({ description: 'Two to five sentences explaining the mechanism.' }),
    impact: NonEmptyString({
      description: 'What this costs or risks, phrased in observable terms.',
    }),
    components: Type.Array(ComponentId),
    edges: Type.Array(EdgeId),
    sourceLocations: Type.Array(SourceLocation),
    evidence: Type.Array(EvidenceId, { minItems: 1 }),
    metrics: Type.Array(FindingMetric),
    recommendation: Type.Optional(Recommendation),
    suggestedExperiment: Type.Optional(SuggestedExperiment),
    /** What must be true before this finding may be converted into an improvement goal. */
    goalReadiness: Type.Object(
      {
        eligible: Type.Boolean(),
        reason: NonEmptyString(),
        requiresRuntimeEvidence: Type.Boolean(),
        requiresHumanReview: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    /**
     * External taxonomy references, so findings are comparable with other tools. Only set where the
     * mapping is unambiguous: `owasp-llm:LLM01`, `owasp-asi:ASI02`, `atlas:AML.T0110`, `cwe:CWE-77`.
     */
    taxonomy: Type.Array(
      Type.String({ pattern: '^(owasp-llm|owasp-asi|atlas|cwe|mast):[A-Za-z0-9.\\-]+$' }),
    ),
    /** Findings that contradict this one, preserved rather than silently dropped. */
    conflictsWith: Type.Array(Type.String({ pattern: '^OSC-[A-Z]{3,5}-\\d{4}$' })),
    tags: Type.Array(NonEmptyString()),
    createdAt: Timestamp,
    metadata: Metadata,
  },
  { additionalProperties: false },
);
export type Finding = Static<typeof Finding>;

export const FindingSet = Document(
  schemaId('finding'),
  SCHEMA_VERSIONS.finding,
  Type.Object({
    scanId: NonEmptyString(),
    generatedAt: Timestamp,
    findings: Type.Array(Finding),
    /** Rules that were evaluated, including the ones that produced nothing. */
    rulesEvaluated: Type.Array(
      Type.Object(
        {
          ruleId: NonEmptyString(),
          category: FindingCategory,
          status: literals(['fired', 'clear', 'insufficient_evidence', 'not_applicable'] as const),
          detail: Type.Optional(Type.String({ maxLength: 500 })),
        },
        { additionalProperties: false },
      ),
    ),
  }),
);
export type FindingSet = Static<typeof FindingSet>;
