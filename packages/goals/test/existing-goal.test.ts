import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Goal } from '@orchescope/schema';
import { openGoalForFinding } from '../src/existing-goal.ts';

/**
 * Which goal a finding already has.
 *
 * The property under test is that asking twice produces one goal, and that the identity it matches on
 * survives the two things that move underneath it: a rescan that renumbers findings, and a goal that has
 * since been settled.
 */

const goal = (overrides: Partial<Goal> = {}): Goal =>
  ({
    id: 'OSC-GOAL-0001',
    findingId: 'OSC-REL-0003',
    status: 'ready',
    metadata: { ruleId: 'retry-around-non-idempotent-operation' },
    ...overrides,
  }) as Goal;

const finding = {
  id: 'OSC-REL-0003',
  ruleId: 'retry-around-non-idempotent-operation',
} as const;

describe('openGoalForFinding', () => {
  it('returns the goal a finding already has, so asking twice does not produce two', () => {
    assert.equal(openGoalForFinding([goal()], finding)?.id, 'OSC-GOAL-0001');
  });

  it('returns nothing when the finding has no goal', () => {
    assert.equal(openGoalForFinding([], finding), undefined);
    assert.equal(
      openGoalForFinding([goal({ findingId: 'OSC-REL-0004' })], finding),
      undefined,
      'a goal for a different finding was returned',
    );
  });

  /*
   * The identifier is a per category sequence number over one scan's findings, so a rule that sorts
   * earlier renumbers everything after it. Matching on it alone would eventually hand back a goal cut
   * from whichever finding used to hold the number.
   */
  it('declines a goal whose rule is not the rule this finding fired', () => {
    const stale = goal({ metadata: { ruleId: 'model-call-without-timeout' } });
    assert.equal(openGoalForFinding([stale], finding), undefined);
  });

  it('declines a settled goal, because a finding that fires after one is work nobody has taken on', () => {
    for (const status of ['validated', 'rejected', 'abandoned'] as const) {
      assert.equal(
        openGoalForFinding([goal({ status })], finding),
        undefined,
        `a ${status} goal was returned as though it were still open`,
      );
    }
  });

  it('accepts a goal that is drafted or already being worked on', () => {
    for (const status of ['draft', 'ready', 'in_progress'] as const) {
      assert.equal(openGoalForFinding([goal({ status })], finding)?.status, status);
    }
  });

  it('returns the newest of several, which is the order the store reads them in', () => {
    const goals = [goal({ id: 'OSC-GOAL-0007' }), goal({ id: 'OSC-GOAL-0002' })];
    assert.equal(openGoalForFinding(goals, finding)?.id, 'OSC-GOAL-0007');
  });
});
