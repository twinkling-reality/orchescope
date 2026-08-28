import type { Scenario, ScenarioRequirement } from '@orchescope/schema';
import { formatCount } from './counting.ts';

/**
 * Whether a scenario is the one a rule asked for, and what to say when none is.
 *
 * One definition, used to search and to state what is missing, because those were two statements of the
 * same rule and one of them was prose. It lives here rather than in `findings` because the composer in
 * `workspace` writes the file this searches for, and a composer that disagrees with the search writes a
 * file the rule then refuses. Two copies of a predicate are two answers.
 *
 * A fault aimed at `*` satisfies a fault clause whatever the requirement resolved, because the schema
 * defines `*` as every match (`FaultSpec.target`), and a fault aimed at everything is aimed at this
 * component too. The two rules this replaces disagreed about that: one accepted `*` and the component
 * identifier, the other accepted neither, and nothing anywhere argued for either. The wider reading wins,
 * because the narrower one refuses a scenario that does what the rule asked.
 */

const EVERY_TARGET = '*';

/** `a`, `a and b`, `a, b and c`, so a clause list reads as a sentence rather than as a record. */
const listOf = (values: readonly string[]): string =>
  values.length <= 1
    ? (values[0] ?? '')
    : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1] ?? ''}`;

const faultClauseMet = (scenario: Scenario, requirement: ScenarioRequirement): boolean =>
  requirement.faultKinds.length === 0 ||
  scenario.faults.some(
    (fault) =>
      requirement.faultKinds.includes(fault.kind) &&
      (fault.target === EVERY_TARGET || requirement.faultTargets.includes(fault.target)),
  );

const evaluatorClauseMet = (scenario: Scenario, requirement: ScenarioRequirement): boolean =>
  requirement.evaluatorKinds.every((kind) =>
    scenario.evaluators.some((evaluator) => evaluator.kind === kind),
  );

const prohibitedClauseMet = (scenario: Scenario, requirement: ScenarioRequirement): boolean =>
  !requirement.prohibitedEffects || (scenario.expect?.prohibitedEffects?.length ?? 0) > 0;

const recordedClauseMet = (scenario: Scenario, requirement: ScenarioRequirement): boolean =>
  requirement.recordedScenarioIds === undefined ||
  requirement.recordedScenarioIds.includes(scenario.id);

export const scenarioSatisfies = (scenario: Scenario, requirement: ScenarioRequirement): boolean =>
  recordedClauseMet(scenario, requirement) &&
  faultClauseMet(scenario, requirement) &&
  evaluatorClauseMet(scenario, requirement) &&
  prohibitedClauseMet(scenario, requirement);

export const scenarioSatisfying = (
  requirement: ScenarioRequirement,
  scenarios: readonly Scenario[],
): Scenario | undefined => scenarios.find((scenario) => scenarioSatisfies(scenario, requirement));

/**
 * The clauses a rule asked for, in the vocabulary an operator writes into a file.
 *
 * The kinds are printed as the schema spells them rather than translated into prose, because the reader of
 * this sentence has to type them and a sentence they cannot act on is what this replaces. The target is
 * the resolved one, so the reader is told which component of theirs the fault belongs on rather than being
 * left to work it out from a rule identifier.
 *
 * It reads as the tail of "no repository scenario meets what this needs: ", which is the one sentence all
 * three rules now write from the predicate that decided them.
 */
export const describeScenarioRequirement = (requirement: ScenarioRequirement): string => {
  const clauses: string[] = [];
  const target = requirement.faultTargets[0];
  if (requirement.faultKinds.length > 0 && target !== undefined) {
    clauses.push(`a ${requirement.faultKinds.join(' or ')} fault aimed at ${target}`);
  }
  for (const kind of requirement.evaluatorKinds) clauses.push(`a ${kind} evaluator`);
  if (requirement.prohibitedEffects) {
    clauses.push('at least one entry under expect.prohibitedEffects');
  }
  const recorded = requirement.recordedScenarioIds;
  if (recorded !== undefined) {
    clauses.push(
      recorded.length === 0
        ? 'to be a scenario the runs that recorded this belonged to, and they belonged to none'
        : `to be one of ${recorded.join(', ')}, the ${formatCount(recorded.length, 'scenario')} those runs belonged to`,
    );
  }
  return clauses.length === 0 ? 'a repository scenario' : listOf(clauses);
};

/**
 * The declaration a rule carries, with the parts only an audit can resolve filled in.
 *
 * Binding rather than constructing is what stops the declaration and the instance drifting: a rule cannot
 * quietly search for a fault kind it did not declare, because the kinds come from the declaration and only
 * the resolved names come from the caller.
 */
export const bindScenarioRequirement = (
  declared: ScenarioRequirement,
  resolved: {
    readonly faultTargets?: readonly string[];
    readonly recordedScenarioIds?: readonly string[];
  },
): ScenarioRequirement => ({
  ...declared,
  ...(resolved.faultTargets === undefined ? {} : { faultTargets: [...resolved.faultTargets] }),
  ...(resolved.recordedScenarioIds === undefined
    ? {}
    : { recordedScenarioIds: [...resolved.recordedScenarioIds] }),
});
