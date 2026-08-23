import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Evidence } from '@orchescope/schema';
import { metricEvidence } from '../src/evidence.ts';

const common = {
  producer: 'test:metric',
  metric: 'latency',
  value: 12,
  unit: 'ms',
  sampleSize: 3,
};

describe('metricEvidence', () => {
  it('canonicalises an exact aggregate run population independently of input order', () => {
    const first = metricEvidence({
      ...common,
      runIds: ['run_two', 'run_one', 'run_two'],
    });
    const second = metricEvidence({
      ...common,
      runIds: ['run_one', 'run_two'],
    });

    assert.equal(first.kind, 'metric');
    if (first.kind === 'metric' && 'runIds' in first) {
      assert.deepEqual(first.runIds, ['run_one', 'run_two']);
    }
    assert.equal(first.id, second.id);
  });

  it('refuses neither and both run identity shapes at the builder boundary', () => {
    const build = metricEvidence as (input: Record<string, unknown>) => Evidence;
    assert.throws(() => build(common), /exactly one/);
    assert.throws(() => build({ ...common, runId: 'run_one', runIds: ['run_one'] }), /exactly one/);
  });
});
