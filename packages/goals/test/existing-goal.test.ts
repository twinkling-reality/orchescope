import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Finding, Goal } from '@orchescope/schema';
import { openGoalForFinding } from '../src/existing-goal.ts';

/**
 * Which goal a finding already has.
 *
 * The property under test is that asking twice produces one goal, including when a version-1 goal has a
 * sequential handle and the rescan emits a semantic handle for the same rule and affected subject.
 */

const goal = (overrides: Partial<Goal> = {}): Goal =>
  ({
    id: 'OSC-GOAL-0001',
    findingId: 'OSC-REL-0003',
    status: 'ready',
    affectedComponents: ['tool:issue_refund'],
    metadata: { ruleId: 'retry-around-non-idempotent-operation' },
    ...overrides,
  }) as Goal;

const finding: Pick<Finding, 'id' | 'ruleId' | 'components' | 'metadata'> = {
  id: 'OSC-REL-0003',
  ruleId: 'retry-around-non-idempotent-operation',
  components: ['tool:issue_refund'],
  metadata: {},
};

describe('openGoalForFinding', () => {
  it('returns the goal a finding already has, so asking twice does not produce two', () => {
    assert.equal(openGoalForFinding([goal()], finding)?.id, 'OSC-GOAL-0001');
  });

  it('returns nothing when the finding has no goal', () => {
    assert.equal(openGoalForFinding([], finding), undefined);
  });

  it('matches a version-1 goal by its rule and canonical affected subject after a rerun', () => {
    assert.equal(
      openGoalForFinding([goal({ findingId: 'OSC-REL-0004' })], finding)?.id,
      'OSC-GOAL-0001',
    );
  });

  it('declines a goal whose rule is not the rule this finding fired', () => {
    const stale = goal({ metadata: { ruleId: 'model-call-without-timeout' } });
    assert.equal(openGoalForFinding([stale], finding), undefined);
  });

  it('declines the same rule and identifier when the affected subject differs', () => {
    const stale = goal({ affectedComponents: ['tool:send_email'] });
    assert.equal(openGoalForFinding([stale], finding), undefined);
  });

  it('declines a version-1 goal that carries no affected subject', () => {
    assert.equal(openGoalForFinding([goal({ affectedComponents: [] })], finding), undefined);
  });

  it('requires complete semantic metadata to agree', () => {
    const metadata = {
      ruleId: finding.ruleId,
      findingIdentity: 'semantic-sha256-v1',
      findingSemanticKey: 'a'.repeat(64),
      findingSemanticSubject: 'b'.repeat(64),
    };
    const semantic = {
      ...finding,
      id: 'OSC-ABCDE-1234',
      metadata,
    };
    assert.equal(
      openGoalForFinding(
        [goal({ findingId: semantic.id, metadata, affectedComponents: semantic.components })],
        semantic,
      )?.id,
      'OSC-GOAL-0001',
    );
    assert.equal(
      openGoalForFinding(
        [
          goal({
            findingId: semantic.id,
            affectedComponents: semantic.components,
            metadata: { ...metadata, findingSemanticSubject: 'c'.repeat(64) },
          }),
        ],
        semantic,
      ),
      undefined,
    );
    assert.equal(
      openGoalForFinding(
        [
          goal({
            findingId: semantic.id,
            affectedComponents: semantic.components,
            metadata: {
              ruleId: finding.ruleId,
              findingIdentity: 'semantic-sha256-v1',
            },
          }),
        ],
        semantic,
      ),
      undefined,
      'an incomplete semantic goal fell through to version-1 subject matching',
    );
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
