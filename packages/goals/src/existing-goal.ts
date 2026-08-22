import {
  legacyFindingSubject,
  semanticFindingKeyDigest,
  semanticFindingSubjectDigest,
  usesSemanticFindingIdentity,
} from '@orchescope/domain';
import type { Finding, Goal } from '@orchescope/schema';

/**
 * The goal a finding already has.
 *
 * Six calls naming the same finding produced six identical goals, because nothing looked for one that
 * already existed. An agent exploring the response shape, reading `scope` and then `agentPrompt`, makes
 * that call more than once without meaning to, and a tool whose own subject is effects that repeat is a
 * poor place for the operation to be one.
 *
 * A semantic goal matches the identifier, full key digest, rule and subject digest. A version-1 goal
 * without semantic metadata uses the compatibility boundary its document already carries: the stored
 * rule and canonical affected-component subject. Neither path lets a same-rule finding about another
 * subject inherit the goal.
 *
 * A settled goal is not returned. A validated one is the record of a change that was made and judged, and
 * a rejected or abandoned one is a decision not to make it, so a finding that fires after either is work
 * nobody has taken on yet.
 */

/** Statuses in which a goal is still the open answer to its finding. */
const OPEN_STATUSES: ReadonlySet<Goal['status']> = new Set(['draft', 'ready', 'in_progress']);

export const goalMatchesFinding = (
  goal: Goal,
  finding: Pick<Finding, 'id' | 'ruleId' | 'components' | 'metadata'>,
): boolean => {
  if (goal.metadata['ruleId'] !== finding.ruleId) return false;
  const goalKey = semanticFindingKeyDigest(goal.metadata);
  if (usesSemanticFindingIdentity(goal.metadata)) {
    const findingKey = semanticFindingKeyDigest(finding.metadata);
    const goalSubject = semanticFindingSubjectDigest(goal.metadata);
    const findingSubject = semanticFindingSubjectDigest(finding.metadata);
    return (
      goal.findingId === finding.id &&
      goalKey !== undefined &&
      findingKey !== undefined &&
      goalKey === findingKey &&
      goalSubject !== undefined &&
      goalSubject === findingSubject
    );
  }
  if (goal.affectedComponents.length === 0) return false;
  return (
    legacyFindingSubject({ components: goal.affectedComponents }) ===
    legacyFindingSubject({ components: finding.components })
  );
};

export const openGoalForFinding = (
  /** Goals for this project, newest first. */
  goals: readonly Goal[],
  finding: Pick<Finding, 'id' | 'ruleId' | 'components' | 'metadata'>,
): Goal | undefined =>
  goals.find((goal) => goalMatchesFinding(goal, finding) && OPEN_STATUSES.has(goal.status));
