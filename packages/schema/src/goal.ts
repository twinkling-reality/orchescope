import { type Static, Type } from '@sinclair/typebox';
import { EvidenceId, SourceLocation } from './evidence.ts';
import { ComponentId } from './identity.ts';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  RelativePath,
  Timestamp,
} from './primitives.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * An improvement goal is the contract between a finding and whoever implements the change, human or
 * agent. It is bounded on purpose: the write scope, the prohibited changes, the acceptance criteria
 * and the exact validation command are all part of the document.
 */

export const GoalStatus = literals([
  'draft',
  'ready',
  'in_progress',
  'validated',
  'rejected',
  'abandoned',
] as const);
export type GoalStatus = Static<typeof GoalStatus>;

export const AcceptanceCriterion = Type.Object(
  {
    id: Type.String({ pattern: '^AC-\\d{2}$' }),
    statement: NonEmptyString({ description: 'Checkable claim, not an aspiration.' }),
    /** How the criterion is checked. Manual criteria are labelled so nobody assumes automation. */
    check: Type.Union([
      Type.Object(
        {
          kind: Type.Literal('metric_improvement'),
          metric: NonEmptyString(),
          comparator: literals(['lt', 'lte', 'gt', 'gte'] as const),
          /** Relative threshold expressed as a fraction, so 0.15 means fifteen percent. */
          relativeThreshold: Type.Optional(Type.Number()),
          absoluteThreshold: Type.Optional(Type.Number()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('metric_not_worse'),
          metric: NonEmptyString(),
          tolerance: Type.Number({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal('scenario_passes'), scenarioId: NonEmptyString() },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal('finding_resolved'), findingId: NonEmptyString() },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal('command_succeeds'),
          command: Type.Array(NonEmptyString(), { minItems: 1 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal('manual_review'), instruction: NonEmptyString() },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);
export type AcceptanceCriterion = Static<typeof AcceptanceCriterion>;

export const ValidationPlan = Type.Object(
  {
    /** Scenarios that must be rerun to judge the change. */
    scenarioIds: Type.Array(NonEmptyString()),
    /** Runs the candidate is compared against. */
    baselineRunIds: Type.Array(NonEmptyString()),
    baselineBenchmarkId: Type.Optional(NonEmptyString()),
    commands: Type.Array(
      Type.Object(
        {
          purpose: NonEmptyString(),
          command: Type.Array(NonEmptyString(), { minItems: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    repetitions: NonNegativeInt,
    /** True when validation needs to execute the target system rather than only analyse it. */
    requiresExecution: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ValidationPlan = Static<typeof ValidationPlan>;

export const GoalScope = Type.Object(
  {
    allowedWritePaths: Type.Array(RelativePath, { minItems: 1 }),
    prohibitedChanges: Type.Array(NonEmptyString()),
    /** Behaviour that must not change, expressed for a reviewer rather than a compiler. */
    invariants: Type.Array(NonEmptyString()),
    requiredApprovals: Type.Array(
      literals(['human_review', 'live_execution', 'cost_budget'] as const),
    ),
  },
  { additionalProperties: false },
);
export type GoalScope = Static<typeof GoalScope>;

export const Goal = Document(
  schemaId('goal'),
  SCHEMA_VERSIONS.goal,
  Type.Object({
    id: Type.String({ pattern: '^OSC-GOAL-\\d{4}$' }),
    findingId: Type.String({ pattern: '^OSC-[A-Z]{3,5}-\\d{4}$' }),
    title: NonEmptyString(),
    status: GoalStatus,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    problemStatement: NonEmptyString(),
    /** Evidence copied from the finding so a goal remains readable after a rescan. */
    evidence: Type.Array(EvidenceId, { minItems: 1 }),
    evidenceSummary: Type.Array(
      Type.Object(
        {
          label: NonEmptyString(),
          value: NonEmptyString(),
          basis: NonEmptyString(),
        },
        { additionalProperties: false },
      ),
    ),
    affectedComponents: Type.Array(ComponentId, { minItems: 1 }),
    sourceLocations: Type.Array(SourceLocation),
    scope: GoalScope,
    risk: literals(['low', 'medium', 'high'] as const),
    acceptanceCriteria: Type.Array(AcceptanceCriterion, { minItems: 1 }),
    validation: ValidationPlan,
    expectedImprovement: Type.Optional(NonEmptyString()),
    rollback: NonEmptyString({ description: 'How to undo the change if validation fails.' }),
    /** Comparisons that evaluated this goal, newest last. */
    validationResults: Type.Array(
      Type.Object(
        {
          comparisonId: NonEmptyString(),
          at: Timestamp,
          verdict: NonEmptyString(),
        },
        { additionalProperties: false },
      ),
    ),
    /**
     * Reviews recorded against this goal, newest last.
     *
     * A `manual_review` criterion is the one term nothing in a run can decide, and until something
     * recorded that a review happened it could never be satisfied, which made every goal cut from a
     * finding that needs one permanently unvalidatable. This is what an explicit act writes.
     *
     * What it records is an attestation and not a verification. Orchescope authenticates nobody, so it
     * can say a review was recorded, when, and what the reviewer wrote, and it must not say more than
     * that. A reader judging the goal is judging the note.
     */
    reviews: Type.Optional(
      Type.Array(
        Type.Object(
          {
            at: Timestamp,
            /** What the reviewer checked and concluded, in their own words. */
            note: Type.String({ minLength: 1, maxLength: 2000 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    metadata: Metadata,
  }),
);
export type Goal = Static<typeof Goal>;
