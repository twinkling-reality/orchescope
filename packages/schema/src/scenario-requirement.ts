import { type Static, Type } from '@sinclair/typebox';
import { FaultKind } from './chaos.ts';
import { Evaluator } from './evaluator.ts';
import { literals, NonEmptyString } from './primitives.ts';

/**
 * The scenario a rule needs before a goal cut from its finding can be decided by rerunning something.
 *
 * Three rules gated eligibility on a scenario existing and each wrote the search for one out longhand, so
 * the shape a scenario had to have was stated once as a `find` and once again as the prose explaining what
 * was missing. Two statements of one rule are two answers, and the one that drifts is the one nobody
 * reads: the two static rules had already drifted apart about which spellings of a component a fault may
 * name, one accepting `*` and the component identifier and the other accepting neither.
 *
 * Declared, the same shape searches for a scenario, says what is missing when there is none, and is what
 * `orchescope init --scenario` composes a file from. A clause added here is a clause all three do.
 */

/**
 * The evaluator vocabulary, read off the evaluator union rather than written out beside it.
 *
 * A second list is a second thing to remember, and this one would be remembered only when a kind was
 * added and never when one was renamed.
 */
const EVALUATOR_KINDS = Evaluator.anyOf.map(
  (option) => option.properties.kind.const,
) as readonly Evaluator['kind'][];

const EvaluatorKind = literals(EVALUATOR_KINDS as readonly string[]);

export const ScenarioRequirement = Type.Object(
  {
    /**
     * Fault kinds, any one of which satisfies this clause when aimed at one of `faultTargets`. Empty
     * means the requirement asks for no fault at all.
     */
    faultKinds: Type.Array(FaultKind),
    /**
     * Spellings a fault may be aimed at, resolved from the graph the audit built and never written down
     * anywhere. The first is the one to write into a file; the rest are the other names the same
     * components answer to. A fault aimed at `*` satisfies the clause whatever this holds.
     */
    faultTargets: Type.Array(NonEmptyString()),
    /** Evaluator kinds the scenario must all declare. */
    evaluatorKinds: Type.Array(EvaluatorKind),
    /** Whether `expect.prohibitedEffects` has to name at least one effect. */
    prohibitedEffects: Type.Boolean(),
    /**
     * Scenario identifiers this requirement admits, when the rule is about recorded work rather than
     * about a declaration. Present and empty means nothing recorded can satisfy it yet, which is a
     * requirement a file cannot answer and a run can.
     */
    recordedScenarioIds: Type.Optional(Type.Array(NonEmptyString())),
  },
  { additionalProperties: false },
);
export type ScenarioRequirement = Static<typeof ScenarioRequirement>;
