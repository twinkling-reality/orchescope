import { type Static, Type } from '@sinclair/typebox';
import { EvidenceId } from './evidence.ts';
import { ComponentId, EdgeId } from './identity.ts';
import { literals, NonEmptyString, NonNegativeInt } from './primitives.ts';

/**
 * The reconciliation delta between what a repository declares and what a run exercises.
 *
 * This is the primary output of Orchescope. Observability tools infer their graph from spans, so a
 * component that never executed is invisible to them. Static scanners infer their graph from source,
 * so a component that executed without being declared is invisible to them. The delta between the two
 * is what neither side can compute alone.
 */

export const DeclaredNotExercised = Type.Object(
  {
    components: Type.Array(ComponentId),
    edges: Type.Array(EdgeId),
    /** Runs considered when deciding that something was never exercised. */
    runIds: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type DeclaredNotExercised = Static<typeof DeclaredNotExercised>;

export const ExercisedNotDeclared = Type.Object(
  {
    components: Type.Array(ComponentId),
    edges: Type.Array(EdgeId),
  },
  { additionalProperties: false },
);
export type ExercisedNotDeclared = Static<typeof ExercisedNotDeclared>;

/**
 * A declaration contradicted by an observation. The MCP specification requires clients to treat tool
 * annotations as untrusted, so Orchescope reports agreement or disagreement between a declaration and
 * a measurement and never claims a declaration is trustworthy.
 */
export const Contradiction = Type.Object(
  {
    componentId: ComponentId,
    kind: literals([
      'read_only_hint',
      'idempotent_hint',
      'destructive_hint',
      'timeout',
      'retry_bound',
      'approval',
    ] as const),
    declared: NonEmptyString(),
    observed: NonEmptyString(),
    evidence: Type.Array(EvidenceId, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type Contradiction = Static<typeof Contradiction>;

/**
 * A side effect observed more than once for the same logical operation. Attribution names the retry
 * attempt and the component, which is the difference between "duplicates happened" and "this retry of
 * this non idempotent tool caused them".
 */
export const DuplicateSideEffect = Type.Object(
  {
    key: NonEmptyString({
      description: 'kind + target + idempotency key, or kind + target when no key exists.',
    }),
    componentId: Type.Optional(ComponentId),
    occurrences: NonNegativeInt,
    retryAttempts: Type.Array(NonNegativeInt),
    idempotencyKeyPresent: Type.Boolean(),
    runIds: Type.Array(NonEmptyString(), { minItems: 1 }),
    evidence: Type.Array(EvidenceId, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type DuplicateSideEffect = Static<typeof DuplicateSideEffect>;

export const ReconciliationDelta = Type.Object(
  {
    declaredNotExercised: DeclaredNotExercised,
    exercisedNotDeclared: ExercisedNotDeclared,
    contradictions: Type.Array(Contradiction),
    duplicateSideEffects: Type.Array(DuplicateSideEffect),
    coverage: Type.Object(
      {
        declaredComponents: NonNegativeInt,
        exercisedComponents: NonNegativeInt,
        declaredEdges: NonNegativeInt,
        exercisedEdges: NonNegativeInt,
        /** Fraction of declared components seen in at least one run, or undefined with no runs. */
        componentExerciseRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        edgeExerciseRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      },
      { additionalProperties: false },
    ),
    /** Revision the static side was read at, so a delta can be reproduced. */
    revision: Type.Optional(
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
export type ReconciliationDelta = Static<typeof ReconciliationDelta>;
