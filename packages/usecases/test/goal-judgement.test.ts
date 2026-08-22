import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Finding, Goal } from '@orchescope/schema';
import { judgeGoal } from '../src/goal.ts';

/**
 * Whether the finding a goal was cut from still fires.
 *
 * Presence is resolved on the goal's rule and canonical subject. A rule may emit several risks at once,
 * and may answer the same population with a strength after the risk has cleared.
 */

const workspace = {
  store: {
    latestComparisonForGoal: () => undefined,
    scenarioResults: () => [],
  },
} as never;

const goal = {
  id: 'OSC-GOAL-0001',
  findingId: 'OSC-REL-0001',
  status: 'ready',
  affectedComponents: ['model:primary'],
  metadata: { ruleId: 'model-call-without-timeout' },
  acceptanceCriteria: [
    {
      id: 'AC-01',
      statement: 'finding model-call-without-timeout no longer fires on a rescan',
      check: { kind: 'finding_resolved', findingId: 'OSC-REL-0001' },
    },
  ],
  validationResults: [],
} as unknown as Goal;

const finding = (polarity: 'risk' | 'strength'): Finding =>
  ({
    id: 'OSC-REL-0001',
    ruleId: 'model-call-without-timeout',
    polarity,
    components: ['model:primary'],
    edges: [],
    metadata: {},
  }) as unknown as Finding;

describe('the finding a goal is judged against', () => {
  it('is unsatisfied while the risk still fires', () => {
    const validation = judgeGoal({
      workspace,
      goal,
      findings: [finding('risk')],
      rescanned: true,
    });
    assert.equal(validation.validated, false);
  });

  it('is satisfied once the risk is gone', () => {
    const validation = judgeGoal({ workspace, goal, findings: [], rescanned: true });
    assert.equal(validation.validated, true);
  });

  it('is satisfied when the same rule now reports a strength', () => {
    const validation = judgeGoal({
      workspace,
      goal,
      findings: [finding('strength')],
      rescanned: true,
    });
    assert.equal(validation.validated, true, validation.outcomes[0]?.detail);
  });

  it('is satisfied when only another subject from the same rule still fires', () => {
    const other = { ...finding('risk'), components: ['model:secondary'] };
    const validation = judgeGoal({ workspace, goal, findings: [other], rescanned: true });
    assert.equal(validation.validated, true, validation.outcomes[0]?.detail);
  });
});
