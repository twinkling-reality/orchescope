/// <reference types="node" />

import type { ChaosOutcome } from '@orchescope/schema';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summariseOutcomes } from '../src/presentation/resilience-outcomes.ts';

const outcome = (overrides: Partial<ChaosOutcome> = {}): ChaosOutcome => ({
  faultKind: 'tool_timeout',
  target: 'issue_refund',
  appliedCount: 1,
  runId: 'run_0000000000000001',
  taskCompleted: true,
  recovered: true,
  duplicateSideEffects: 0,
  prohibitedSideEffects: 0,
  userInterventions: 0,
  loopIterations: 0,
  degradedGracefully: false,
  policyViolations: 0,
  evaluators: [],
  ...overrides,
});

describe('summariseOutcomes', () => {
  it('reports nothing at all for a chaos run with no outcomes', () => {
    const summary = summariseOutcomes([]);
    assert.equal(summary.total, 0);
    assert.equal(summary.incomplete, 0);
    assert.deepEqual(summary.failingFaultKinds, []);
  });

  it('separates a task that did not complete from one that completed after degrading', () => {
    const summary = summariseOutcomes([
      outcome({ taskCompleted: false }),
      outcome({ taskCompleted: true, degradedGracefully: true }),
      outcome({ taskCompleted: true, degradedGracefully: false }),
    ]);
    assert.equal(summary.total, 3);
    assert.equal(summary.incomplete, 1);
    assert.equal(summary.degraded, 1);
    assert.equal(summary.absorbed, 1);
  });

  it('names the fault kinds that left a task incomplete, once each and in encounter order', () => {
    const summary = summariseOutcomes([
      outcome({ faultKind: 'tool_exception', taskCompleted: false }),
      outcome({ faultKind: 'tool_timeout', taskCompleted: false }),
      outcome({ faultKind: 'tool_exception', taskCompleted: false }),
      outcome({ faultKind: 'model_rate_limited', taskCompleted: true }),
    ]);
    assert.deepEqual(summary.failingFaultKinds, ['tool_exception', 'tool_timeout']);
  });

  it('counts an outcome that repeated an external effect even when the task completed', () => {
    const summary = summariseOutcomes([
      outcome({ taskCompleted: true, duplicateSideEffects: 2 }),
      outcome({ taskCompleted: true, prohibitedSideEffects: 1 }),
      outcome({ taskCompleted: true, policyViolations: 3 }),
    ]);
    assert.equal(summary.incomplete, 0);
    assert.equal(summary.withDuplicateSideEffects, 1);
    assert.equal(summary.withProhibitedSideEffects, 1);
    assert.equal(summary.withPolicyViolations, 1);
  });

  it('names no failing fault kind when everything completed', () => {
    const summary = summariseOutcomes([outcome(), outcome({ faultKind: 'model_rate_limited' })]);
    assert.equal(summary.incomplete, 0);
    assert.deepEqual(summary.failingFaultKinds, []);
    assert.equal(summary.absorbed, 2);
  });
});
