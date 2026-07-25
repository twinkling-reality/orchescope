import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EvaluatorResult, RepetitionResult, RunMetrics } from '@orchescope/schema';
import { computeReliability } from '../src/reliability.ts';

/**
 * pass^k against hand computed values. C(successes, k) / C(total, k) is small enough to check by hand, which
 * is the point: the estimator that decides whether a system is called reliable has to be verifiable.
 */

const metrics: RunMetrics = {
  durationMs: 100,
  modelCalls: 0,
  toolCalls: 0,
  agentSteps: 0,
  handoffs: 0,
  retrievalCalls: 0,
  memoryOperations: 0,
  inputTokens: 0,
  outputTokens: 0,
  errors: 0,
  retries: 0,
  recoveredErrors: 0,
  duplicateSideEffects: 0,
  prohibitedSideEffects: 0,
  sideEffects: 0,
  userInterventions: 0,
  policyViolations: 0,
  maxObservedConcurrency: 1,
  loopIterations: 0,
};

const repetition = (
  index: number,
  succeeded: boolean,
  evaluators: readonly EvaluatorResult[] = [],
): RepetitionResult => ({
  runId: `run_${String(index).padStart(16, '0')}`,
  repetition: index,
  status: succeeded ? 'completed' : 'failed',
  taskSuccess: succeeded,
  metrics,
  evaluators: [...evaluators],
  sideEffects: [],
  duplicateSideEffectKeys: [],
  prohibitedSideEffectKinds: [],
  faultsApplied: [],
});

const series = (successes: number, failures: number): readonly RepetitionResult[] => [
  ...Array.from({ length: successes }, (_, index) => repetition(index, true)),
  ...Array.from({ length: failures }, (_, index) => repetition(successes + index, false)),
];

const valueAt = (
  reliability: ReturnType<typeof computeReliability>,
  k: number,
): number | undefined => reliability.passPowerK.find((entry) => entry.k === k)?.value;

describe('computeReliability', () => {
  it('matches the hand computed estimator for three successes in five runs', () => {
    const reliability = computeReliability(series(3, 2));
    assert.equal(reliability.repetitions, 5);
    assert.equal(reliability.successes, 3);
    assert.equal(reliability.successRate, 0.6);
    // C(3,1)/C(5,1) = 3/5, C(3,2)/C(5,2) = 3/10, C(3,3)/C(5,3) = 1/10.
    assert.equal(valueAt(reliability, 1), 0.6);
    assert.ok(Math.abs((valueAt(reliability, 2) ?? 0) - 0.3) < 1e-12);
    assert.ok(Math.abs((valueAt(reliability, 3) ?? 0) - 0.1) < 1e-12);
    assert.equal(valueAt(reliability, 4), 0, 'four successes were never observed');
    assert.equal(valueAt(reliability, 5), 0);
  });

  it('reports zero for every k when nothing succeeded', () => {
    const reliability = computeReliability(series(0, 4));
    assert.equal(reliability.successes, 0);
    assert.equal(reliability.successRate, 0);
    assert.deepEqual(
      reliability.passPowerK.map((entry) => entry.value),
      [0, 0, 0, 0],
    );
  });

  it('stops at k of five and reports one when every run succeeded', () => {
    const reliability = computeReliability(series(6, 0));
    assert.equal(reliability.repetitions, 6);
    assert.deepEqual(
      reliability.passPowerK.map((entry) => entry.k),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      reliability.passPowerK.map((entry) => entry.value),
      [1, 1, 1, 1, 1],
    );
  });

  it('withholds a success rate when there are no repetitions', () => {
    const reliability = computeReliability([]);
    assert.equal(reliability.repetitions, 0);
    assert.equal(reliability.successRate, undefined);
    assert.deepEqual(reliability.passPowerK, []);
  });

  it('counts a repetition with a failing evaluator as a failure', () => {
    const failing: EvaluatorResult = { kind: 'exit_code', passed: false, detail: 'exited with 1' };
    const reliability = computeReliability([repetition(0, true, [failing])]);
    assert.equal(reliability.successes, 0);
  });

  it('ignores a skipped evaluator when deciding success', () => {
    const skipped: EvaluatorResult = {
      kind: 'model_judge',
      passed: false,
      detail: 'not evaluated',
      skipped: true,
      skipReason:
        'analysis in this build is deterministic, so a judged question is recorded and never answered',
    };
    const reliability = computeReliability([repetition(0, true, [skipped])]);
    assert.equal(reliability.successes, 1);
    assert.equal(valueAt(reliability, 1), 1);
  });
});
