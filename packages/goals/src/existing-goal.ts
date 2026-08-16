import type { Finding, Goal } from '@orchescope/schema';

/**
 * The goal a finding already has.
 *
 * Six calls naming the same finding produced six identical goals, because nothing looked for one that
 * already existed. An agent exploring the response shape, reading `scope` and then `agentPrompt`, makes
 * that call more than once without meaning to, and a tool whose own subject is effects that repeat is a
 * poor place for the operation to be one.
 *
 * The match is on the rule as well as the identifier. A finding identifier is a sequence number inside
 * its category, assigned over one scan's drafts, and it is renumbered whenever the set of findings
 * changes: on its own it would eventually return a goal cut from a different finding that had since
 * inherited the number. The rule identifier is the finding's stable name and the goal records it.
 *
 * A settled goal is not returned. A validated one is the record of a change that was made and judged, and
 * a rejected or abandoned one is a decision not to make it, so a finding that fires after either is work
 * nobody has taken on yet.
 */

/** Statuses in which a goal is still the open answer to its finding. */
const OPEN_STATUSES: ReadonlySet<Goal['status']> = new Set(['draft', 'ready', 'in_progress']);

export const openGoalForFinding = (
  /** Goals for this project, newest first. */
  goals: readonly Goal[],
  finding: Pick<Finding, 'id' | 'ruleId'>,
): Goal | undefined =>
  goals.find(
    (goal) =>
      goal.findingId === finding.id &&
      goal.metadata['ruleId'] === finding.ruleId &&
      OPEN_STATUSES.has(goal.status),
  );
