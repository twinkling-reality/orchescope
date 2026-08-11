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
    /** Occurrences inside the single run that repeated it most. This is the number that means duplication. */
    occurrences: NonNegativeInt,
    /** Occurrences across every run considered, which is a history rather than a duplication count. */
    totalOccurrences: NonNegativeInt,
    retryAttempts: Type.Array(NonNegativeInt),
    idempotencyKeyPresent: Type.Boolean(),
    runIds: Type.Array(NonEmptyString(), { minItems: 1 }),
    evidence: Type.Array(EvidenceId, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type DuplicateSideEffect = Static<typeof DuplicateSideEffect>;

/**
 * How the observed names were joined to declarations.
 *
 * A run reports names and a repository declares identities, so every join is made by a rule and the rules are not
 * equally strong. A match on a code location is the observation and the declaration pointing at the same line. A match
 * on kind and name alone is the weakest: it is correct whenever a name means one thing in a repository, and wrong when
 * two modules use the same word. That has already happened once here, where a model observed as `test` joined a
 * declaration in an unrelated test file, so the count is reported rather than left for a reader to assume.
 */
export const JoinSummary = Type.Object(
  {
    byCodeLocation: NonNegativeInt,
    byRuntimeName: NonNegativeInt,
    byKindAndName: NonNegativeInt,
    /** Components joined on kind and name alone, which is the rule that can match the wrong module. */
    onNameAlone: Type.Array(ComponentId),
    /** Observed names that matched more than one declaration, and were therefore joined to none. */
    ambiguous: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type JoinSummary = Static<typeof JoinSummary>;

export const ReconciliationDelta = Type.Object(
  {
    declaredNotExercised: DeclaredNotExercised,
    exercisedNotDeclared: ExercisedNotDeclared,
    contradictions: Type.Array(Contradiction),
    duplicateSideEffects: Type.Array(DuplicateSideEffect),
    joins: JoinSummary,
    coverage: Type.Object(
      {
        /**
         * Observable components with a static declaration. Runtime-only (undeclared) components are
         * not counted here; they appear only under `exercisedNotDeclared`.
         */
        declaredComponents: NonNegativeInt,
        /** Declared observable components that also appeared in at least one run. */
        exercisedComponents: NonNegativeInt,
        declaredEdges: NonNegativeInt,
        exercisedEdges: NonNegativeInt,
        /** `exercisedComponents / declaredComponents`, or undefined with no runs or nothing declared. */
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
