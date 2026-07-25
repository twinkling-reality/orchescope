/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ENDPOINTS,
  extractServerMessage,
  parseCreateComparison,
  parseCreateGoal,
  parseOpenLocation,
  parseRerunScenario,
} from '../src/api.ts';

describe('ENDPOINTS', () => {
  it('names the paths this page will post to', () => {
    assert.deepEqual(ENDPOINTS, {
      report: '/api/report',
      goals: '/api/goals',
      scenarioRuns: '/api/scenario-runs',
      comparisons: '/api/comparisons',
      openLocation: '/api/open-location',
    });
  });
});

describe('extractServerMessage', () => {
  it('prefers error, then message, then detail', () => {
    assert.equal(extractServerMessage({ error: 'a', message: 'b', detail: 'c' }), 'a');
    assert.equal(extractServerMessage({ message: 'b', detail: 'c' }), 'b');
    assert.equal(extractServerMessage({ detail: 'c' }), 'c');
  });

  it('returns null for anything else', () => {
    for (const value of [null, undefined, 'text', 42, [], {}, { error: '' }, { error: 7 }]) {
      assert.equal(extractServerMessage(value), null);
    }
  });
});

describe('parseCreateGoal', () => {
  it('accepts a flat goal identifier', () => {
    assert.deepEqual(parseCreateGoal({ goalId: 'OSC-GOAL-0001' }), { goalId: 'OSC-GOAL-0001' });
  });

  it('accepts the identifier nested inside a goal document', () => {
    assert.deepEqual(parseCreateGoal({ goal: { id: 'OSC-GOAL-0002' } }), {
      goalId: 'OSC-GOAL-0002',
    });
  });

  it('rejects a response with no identifier', () => {
    for (const value of [{}, { goal: {} }, { goalId: '' }, null, 'ok']) {
      assert.equal(parseCreateGoal(value), null);
    }
  });
});

describe('parseRerunScenario', () => {
  it('requires a run identifier and treats the status as optional', () => {
    assert.deepEqual(parseRerunScenario({ runId: 'run_0000000000000001', status: 'running' }), {
      runId: 'run_0000000000000001',
      status: 'running',
    });
    assert.deepEqual(parseRerunScenario({ runId: 'run_0000000000000001' }), {
      runId: 'run_0000000000000001',
      status: null,
    });
    assert.equal(parseRerunScenario({ status: 'running' }), null);
  });
});

describe('parseCreateComparison', () => {
  it('accepts a flat or a nested comparison identifier', () => {
    assert.deepEqual(
      parseCreateComparison({ comparisonId: 'cmp_0000000000000001', verdict: 'improved' }),
      {
        comparisonId: 'cmp_0000000000000001',
        verdict: 'improved',
      },
    );
    assert.deepEqual(
      parseCreateComparison({ comparison: { id: 'cmp_0000000000000002', verdict: 'mixed' } }),
      { comparisonId: 'cmp_0000000000000002', verdict: 'mixed' },
    );
  });

  it('treats a missing verdict as absent rather than as a value', () => {
    assert.deepEqual(parseCreateComparison({ comparisonId: 'cmp_0000000000000003' }), {
      comparisonId: 'cmp_0000000000000003',
      verdict: null,
    });
  });

  it('rejects a response with no comparison identifier', () => {
    assert.equal(parseCreateComparison({ verdict: 'improved' }), null);
  });
});

describe('parseOpenLocation', () => {
  it('requires an explicit boolean', () => {
    assert.deepEqual(parseOpenLocation({ opened: true }), { opened: true });
    assert.deepEqual(parseOpenLocation({ opened: false }), { opened: false });
    assert.equal(parseOpenLocation({ opened: 'yes' }), null);
    assert.equal(parseOpenLocation({}), null);
    assert.equal(parseOpenLocation(null), null);
  });
});
