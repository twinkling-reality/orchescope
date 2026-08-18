import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Finding, Goal } from '@orchescope/schema';
import { judgeGoal } from '../src/goal.ts';

/**
 * Whether the finding a goal was cut from still fires.
 *
 * Presence is resolved on the goal's rule rather than on the finding identifier, because identifiers are
 * renumbered by every rescan. That reading is right and it was incomplete: a rule reports both polarities
 * and `model-call-without-timeout` answers a repository where every call declares a deadline with a
 * strength carrying the same rule. The goal read its own rule back out of the finding set, saw it, and
 * told an agent that had done exactly what was asked that nothing had changed.
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
  ({ id: 'OSC-REL-0001', ruleId: 'model-call-without-timeout', polarity }) as Finding;

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
});
