import { type Static, Type } from '@sinclair/typebox';
import { NonEmptyString, NonNegativeInt, PositiveInt, literals } from './primitives.ts';

/**
 * Evaluators decide whether a scenario run satisfied its expectations.
 *
 * Deterministic evaluators are the default and the only ones required for a scenario to be runnable.
 * The single model based evaluator is explicitly marked as needing model access so that a scenario
 * cannot silently become dependent on a paid credential.
 */

export const EffectExpectation = Type.Object(
  {
    kind: NonEmptyString(),
    target: Type.Optional(NonEmptyString()),
    minCount: Type.Optional(NonNegativeInt),
    maxCount: Type.Optional(NonNegativeInt),
  },
  { additionalProperties: false },
);
export type EffectExpectation = Static<typeof EffectExpectation>;

export const Evaluator = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('output_contains_all'),
      values: Type.Array(NonEmptyString(), { minItems: 1 }),
      caseSensitive: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('output_contains_none'),
      values: Type.Array(NonEmptyString(), { minItems: 1 }),
      caseSensitive: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('json_pointer_equals'),
      pointer: Type.String({ pattern: '^(?:/(?:[^/~]|~[01])*)*$' }),
      value: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('effect_recorded'),
      effect: EffectExpectation,
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('no_duplicate_effects') }, { additionalProperties: false }),
  Type.Object(
    {
      kind: Type.Literal('span_observed'),
      operation: NonEmptyString(),
      componentName: Type.Optional(NonEmptyString()),
      minCount: Type.Optional(PositiveInt),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('metric_threshold'),
      metric: NonEmptyString(),
      comparator: literals(['lt', 'lte', 'gt', 'gte', 'eq'] as const),
      value: Type.Number(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('exit_code'),
      equals: Type.Integer(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('model_judge'),
      question: NonEmptyString(),
      passWhen: literals(['yes', 'no'] as const),
      /** Model based evaluation is optional and never required for a scenario to be runnable. */
      requiresModelAccess: Type.Literal(true),
    },
    { additionalProperties: false },
  ),
]);
export type Evaluator = Static<typeof Evaluator>;
export type EvaluatorKind = Evaluator['kind'];

export const EvaluatorResult = Type.Object(
  {
    kind: NonEmptyString(),
    passed: Type.Boolean(),
    detail: Type.String({ maxLength: 2000 }),
    skipped: Type.Optional(Type.Boolean()),
    skipReason: Type.Optional(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type EvaluatorResult = Static<typeof EvaluatorResult>;
