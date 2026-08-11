/**
 * The working set, split at the line that decides what can be handed off.
 *
 * `sortFindingsForAction` already ranks a finding that can become a bounded, verifiable goal ahead of
 * one that still needs runtime evidence or a design decision. That order was correct and invisible: the
 * only thing on the row saying which side of it a finding fell was a phrase at the right hand edge, so
 * a reader had to read every row to find the boundary the list was already sorted by.
 *
 * Grouping makes the boundary structural. Nothing is reordered and nothing is hidden; the split is
 * drawn where the sort already put it.
 */

import type { Finding } from '@orchescope/schema';
import { sortFindingsForAction } from './filters.ts';

export type FindingGroupId = 'goal_ready' | 'needs_review';

export interface FindingGroup {
  readonly id: FindingGroupId;
  readonly label: string;
  /** Why these findings are on this side of the line, in the reader's terms. */
  readonly reason: string;
  readonly findings: readonly Finding[];
}

const GROUP_TEXT: Readonly<Record<FindingGroupId, { label: string; reason: string }>> = {
  goal_ready: {
    label: 'Ready to hand to somebody',
    reason:
      'Each of these has enough behind it to say what to change, which files the change may touch, and the command that decides whether it worked.',
  },
  needs_review: {
    label: 'Needs something else first',
    reason:
      'Each of these says what it is still missing. Handing one over now would produce a task nothing could check.',
  },
};

/**
 * Splits findings into the two groups, keeping the action order inside each. A group with nothing in it
 * is omitted rather than drawn empty: an empty heading over no rows says a set exists when it does not,
 * and the counts a reader needs are already on the screen that called this.
 */
export function groupFindingsByReadiness(findings: readonly Finding[]): readonly FindingGroup[] {
  const ordered = sortFindingsForAction(findings);
  const groups: FindingGroup[] = [];
  for (const id of ['goal_ready', 'needs_review'] as const) {
    const wanted = id === 'goal_ready';
    const matching = ordered.filter((finding) => finding.goalReadiness.eligible === wanted);
    if (matching.length === 0) {
      continue;
    }
    groups.push({ id, ...GROUP_TEXT[id], findings: matching });
  }
  return groups;
}
