import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Evaluator, NormalizedSpan, RunMetrics } from '@orchescope/schema';
import { sideEffectRecord } from '@orchescope/testkit';
import { type EvaluationInput, evaluate } from '../src/evaluate.ts';

/**
 * One pass and one fail for every deterministic evaluator, plus the two cases that must never silently
 * become a verdict: a metric that was not measured and a question that needs a model.
 */

const metrics = (overrides: Partial<RunMetrics> = {}): RunMetrics => ({
  durationMs: 120,
  modelCalls: 2,
  toolCalls: 1,
  agentSteps: 1,
  handoffs: 0,
  retrievalCalls: 0,
  memoryOperations: 0,
  inputTokens: 100,
  outputTokens: 50,
  errors: 0,
  retries: 0,
  recoveredErrors: 0,
  duplicateSideEffects: 0,
  prohibitedSideEffects: 0,
  sideEffects: 1,
  userInterventions: 0,
  policyViolations: 0,
  maxObservedConcurrency: 1,
  loopIterations: 1,
  ...overrides,
});

const span = (overrides: Partial<NormalizedSpan> = {}): NormalizedSpan => ({
  traceId: 'a'.repeat(32),
  spanId: 'b'.repeat(16),
  name: 'chat gpt-4o-mini',
  kind: 'client',
  operation: 'chat',
  startTimeUnixNano: '1700000000000000000',
  endTimeUnixNano: '1700000000100000000',
  durationMs: 100,
  status: 'ok',
  attributes: { 'gen_ai.request.model': 'gpt-4o-mini', 'gen_ai.provider.name': 'openai' },
  events: [],
  serviceName: 'demo',
  ...overrides,
});

const inputFor = (
  evaluator: Evaluator,
  overrides: Partial<Omit<EvaluationInput, 'evaluators' | 'judge'>> = {},
): EvaluationInput => ({
  evaluators: [evaluator],
  output: 'Refund issued for order 42',
  resultMetadata: { status: 'done', attempts: 2 },
  sideEffects: [],
  reportedEffects: [],
  duplicateSideEffectKeys: [],
  spans: [],
  metrics: metrics(),
  exitCode: 0,
  ...overrides,
});

const only = (
  evaluator: Evaluator,
  overrides: Partial<Omit<EvaluationInput, 'evaluators' | 'judge'>> = {},
) => {
  const results = evaluate(inputFor(evaluator, overrides));
  assert.equal(results.length, 1);
  const result = results[0];
  assert.ok(result !== undefined);
  return result;
};

describe('output_contains_all', () => {
  it('passes when every value appears, ignoring case by default', () => {
    const result = only({ kind: 'output_contains_all', values: ['refund issued', 'ORDER 42'] });
    assert.equal(result.passed, true);
  });

  it('fails and names the missing values', () => {
    const result = only({ kind: 'output_contains_all', values: ['refund issued', 'cancelled'] });
    assert.equal(result.passed, false);
    assert.match(result.detail, /cancelled/);
  });

  it('honours an explicit case sensitive match', () => {
    const result = only({
      kind: 'output_contains_all',
      values: ['REFUND ISSUED'],
      caseSensitive: true,
    });
    assert.equal(result.passed, false);
  });
});

describe('output_contains_none', () => {
  it('passes when no forbidden value appears', () => {
    assert.equal(only({ kind: 'output_contains_none', values: ['cancelled'] }).passed, true);
  });

  it('fails and names the forbidden value', () => {
    const result = only({ kind: 'output_contains_none', values: ['refund'] });
    assert.equal(result.passed, false);
    assert.match(result.detail, /refund/);
  });
});

describe('json_pointer_equals', () => {
  it('passes against the target result metadata', () => {
    const result = only({ kind: 'json_pointer_equals', pointer: '/status', value: 'done' });
    assert.equal(result.passed, true);
  });

  it('fails and reports the value it found', () => {
    const result = only({ kind: 'json_pointer_equals', pointer: '/status', value: 'pending' });
    assert.equal(result.passed, false);
    assert.match(result.detail, /"done"/);
  });

  it('falls back to the parsed output when the metadata has no such pointer', () => {
    const result = only(
      { kind: 'json_pointer_equals', pointer: '/totals/refunded', value: 3 },
      { resultMetadata: undefined, output: '{"totals":{"refunded":3}}' },
    );
    assert.equal(result.passed, true);
  });

  it('fails when the pointer resolves nowhere', () => {
    const result = only({ kind: 'json_pointer_equals', pointer: '/missing', value: 'x' });
    assert.equal(result.passed, false);
    assert.match(result.detail, /does not resolve/);
  });
});

describe('effect_recorded', () => {
  it('passes when the effect appears in the trace', () => {
    const result = only(
      { kind: 'effect_recorded', effect: { kind: 'refund', target: 'billing' } },
      { sideEffects: [sideEffectRecord({ kind: 'refund', target: 'billing' })] },
    );
    assert.equal(result.passed, true);
  });

  it('passes when only the result file reported the effect', () => {
    const result = only(
      { kind: 'effect_recorded', effect: { kind: 'refund', target: 'billing' } },
      { reportedEffects: [{ kind: 'refund', target: 'billing', outcome: 'succeeded' }] },
    );
    assert.equal(result.passed, true);
  });

  it('does not count an effect recorded in both places twice', () => {
    const result = only(
      {
        kind: 'effect_recorded',
        effect: { kind: 'refund', target: 'billing', minCount: 1, maxCount: 1 },
      },
      {
        sideEffects: [
          sideEffectRecord({ kind: 'refund', target: 'billing', idempotencyKey: 'r-1' }),
        ],
        reportedEffects: [{ kind: 'refund', target: 'billing', idempotencyKey: 'r-1' }],
      },
    );
    assert.equal(result.passed, true);
  });

  it('fails when the effect was never recorded', () => {
    const result = only({ kind: 'effect_recorded', effect: { kind: 'refund', target: 'billing' } });
    assert.equal(result.passed, false);
    assert.match(result.detail, /recorded 0 times/);
  });
});

describe('no_duplicate_effects', () => {
  it('passes when nothing was recorded twice', () => {
    assert.equal(only({ kind: 'no_duplicate_effects' }).passed, true);
  });

  it('fails and names the duplicated key', () => {
    const result = only(
      { kind: 'no_duplicate_effects' },
      { duplicateSideEffectKeys: ['refund|billing|r-1'] },
    );
    assert.equal(result.passed, false);
    assert.match(result.detail, /refund\|billing\|r-1/);
  });
});

describe('span_observed', () => {
  it('passes on the normalised operation and component name', () => {
    const result = only(
      { kind: 'span_observed', operation: 'chat', componentName: 'openai/gpt-4o-mini' },
      { spans: [span()] },
    );
    assert.equal(result.passed, true);
  });

  it('fails when the component name does not match', () => {
    const result = only(
      { kind: 'span_observed', operation: 'chat', componentName: 'anthropic/claude' },
      { spans: [span()] },
    );
    assert.equal(result.passed, false);
  });

  it('fails when too few spans carry the operation', () => {
    const result = only(
      { kind: 'span_observed', operation: 'execute_tool', minCount: 2 },
      { spans: [span({ operation: 'execute_tool', name: 'execute_tool refund' })] },
    );
    assert.equal(result.passed, false);
    assert.match(result.detail, /at least 2 expected/);
  });
});

describe('metric_threshold', () => {
  it('passes when the comparison holds', () => {
    const result = only({
      kind: 'metric_threshold',
      metric: 'modelCalls',
      comparator: 'lte',
      value: 2,
    });
    assert.equal(result.passed, true);
  });

  it('fails when the comparison does not hold', () => {
    const result = only({
      kind: 'metric_threshold',
      metric: 'modelCalls',
      comparator: 'lt',
      value: 2,
    });
    assert.equal(result.passed, false);
    assert.match(result.detail, /modelCalls was 2/);
  });

  it('skips a metric that was not measured rather than failing it', () => {
    const result = only({
      kind: 'metric_threshold',
      metric: 'costUsd',
      comparator: 'lt',
      value: 1,
    });
    assert.equal(result.skipped, true);
    assert.equal(result.passed, false);
    assert.match(result.skipReason ?? '', /was not measured/);
  });
});

describe('exit_code', () => {
  it('passes on the expected code', () => {
    assert.equal(only({ kind: 'exit_code', equals: 0 }).passed, true);
  });

  it('fails on a different code', () => {
    const result = only({ kind: 'exit_code', equals: 0 }, { exitCode: 1 });
    assert.equal(result.passed, false);
  });

  it('fails when the target was killed and reported no code', () => {
    const result = only({ kind: 'exit_code', equals: 0 }, { exitCode: undefined });
    assert.equal(result.passed, false);
    assert.match(result.detail, /terminated by a signal/);
  });
});

describe('model_judge', () => {
  const judged: Evaluator = {
    kind: 'model_judge',
    question: 'Did the agent explain the refund?',
    passWhen: 'yes',
    requiresModelAccess: true,
  };

  it('is skipped with the reason, and never counted as a pass', () => {
    const result = only(judged);
    assert.equal(result.skipped, true);
    assert.equal(result.passed, false);
    assert.match(result.skipReason ?? '', /deterministic/);
  });

  it('records the question that was not answered, so a reader knows what was left undecided', () => {
    assert.match(only(judged).detail ?? '', /Did the agent explain the refund\?/);
  });
});
