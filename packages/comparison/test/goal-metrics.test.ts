import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_COMPARED_METRICS, metricsForGoal } from '../src/compare.ts';

/**
 * A goal names the metrics it will be judged on, and a comparison made for it has to carry them.
 *
 * Three of the rules a goal can be cut from name `durationMs.p95`, `durationMs.p50` or `inputTokens`,
 * and none of those is in the default set, so the criterion read "the comparison carries no relative
 * change for durationMs.p95" and stayed undecidable however many times anyone ran the plan.
 */
describe('metricsForGoal', () => {
  const goalNaming = (...metrics: readonly string[]) =>
    ({
      acceptanceCriteria: metrics.map((metric, index) => ({
        id: `AC-0${index + 1}`,
        statement: metric,
        check: { kind: 'metric_improvement', metric, comparator: 'lt' },
      })),
    }) as unknown as Parameters<typeof metricsForGoal>[0];

  it('adds the metrics a goal names to the ones every comparison carries', () => {
    const metrics = metricsForGoal(goalNaming('durationMs.p95', 'inputTokens'));
    assert.ok(metrics.includes('durationMs.p95'));
    assert.ok(metrics.includes('inputTokens'));
    for (const standard of DEFAULT_COMPARED_METRICS) assert.ok(metrics.includes(standard));
  });

  it('names a metric once however many criteria ask for it', () => {
    const metrics = metricsForGoal(goalNaming('durationMs', 'durationMs', 'successRate'));
    assert.deepEqual(metrics, [...DEFAULT_COMPARED_METRICS]);
  });

  /*
   * Not added to the default set, because the verdict counts metrics: durationMs, its median and its
   * p95 move together, and three deltas from one change in latency would read as three improvements.
   */
  it('leaves the default set free of the quantiles a goal asked for', () => {
    assert.equal(DEFAULT_COMPARED_METRICS.includes('durationMs.p95'), false);
    assert.equal(DEFAULT_COMPARED_METRICS.includes('durationMs.p50'), false);
  });
});
