/**
 * Which finding in this report a goal is about.
 *
 * A goal stores the identifier the finding had when the goal was cut, and that identifier does not
 * survive a rescan. It is a sequence number inside a category, assigned over a sorted list of one
 * scan's findings, so a rule that sorts earlier and fires for the first time renumbers every finding
 * after it. Ingesting a run is enough: on the demonstration system the retry finding moves from
 * `OSC-REL-0003` to `OSC-REL-0005`, and `OSC-REL-0003` becomes a model timeout finding that has
 * nothing to do with the goal. Following the stored identifier would send a reader to that one.
 *
 * The stable name of a finding is the rule that produced it together with the components it names, and
 * a goal carries both: `metadata.ruleId` and `affectedComponents`. A rule can fire more than once in a
 * report, once per group of components, so the components are what separate them and the rule alone is
 * only the fallback. When neither matches, the finding is genuinely absent from this report, which is
 * a fact worth stating rather than a lookup to retry.
 */

import type { Finding, Goal } from '@orchescope/schema';

const sameComponents = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const seen = new Set(left);
  return right.every((id) => seen.has(id));
};

export function findingForGoal(goal: Goal, findings: readonly Finding[]): Finding | null {
  const ruleId = goal.metadata['ruleId'];
  if (typeof ruleId !== 'string' || ruleId.length === 0) {
    return findings.find((finding) => finding.id === goal.findingId) ?? null;
  }
  const byRule = findings.filter((finding) => finding.ruleId === ruleId);
  if (byRule.length === 0) return null;
  return (
    byRule.find((finding) => sameComponents(finding.components, goal.affectedComponents)) ??
    byRule[0] ??
    null
  );
}
