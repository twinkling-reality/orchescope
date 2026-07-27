import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGraph, componentDraft } from '@orchescope/testkit';
import type { ComponentRunMetrics, SystemGraph } from '@orchescope/schema';
import { buildOverlays, type OverlayInput } from '../src/overlays.ts';

/**
 * Overlay tests.
 *
 * Every overlay a reader sees on the map is computed here, and each one is gated on evidence that has to have
 * survived the whole pipeline to arrive. An overlay that silently returns nothing when its input is empty is
 * indistinguishable from a system that did nothing, which is why the empty case is asserted as deliberately as the
 * populated one.
 */

const graph: SystemGraph = buildGraph([
  componentDraft({ kind: 'agent', name: 'orchestrator' }),
  componentDraft({ kind: 'model', name: 'gpt-4o-mini' }),
  componentDraft({ kind: 'tool', name: 'issue_refund' }),
]);

const componentId = (name: string): string => {
  const found = graph.components.find((component) => component.displayName === name);
  assert.ok(found !== undefined, `no component named ${name}`);
  return found.id;
};

const metric = (overrides: Partial<ComponentRunMetrics> & { componentId: string }) => ({
  executionCount: 1,
  selfDurationMs: 10,
  totalDurationMs: 10,
  inputTokens: 0,
  outputTokens: 0,
  errorCount: 0,
  retryCount: 0,
  ...overrides,
});

const input = (overrides: Partial<OverlayInput> = {}): OverlayInput => ({
  graph,
  componentMetrics: [],
  scenarioRuns: [],
  chaosReports: [],
  componentsByRun: new Map(),
  ...overrides,
});

const kinds = (overlays: ReturnType<typeof buildOverlays>): readonly string[] =>
  overlays.map((overlay) => overlay.kind);

describe('buildOverlays', () => {
  it('reports the declared and observed overlay from a graph alone', () => {
    const overlays = buildOverlays(input());
    assert.deepEqual(kinds(overlays), ['architecture']);
    assert.equal(overlays[0]?.values.length, graph.components.length);
  });

  it('reports nothing measured at runtime when no run metric was attributed', () => {
    const overlays = buildOverlays(input());
    for (const kind of ['runtime_frequency', 'latency', 'tokens', 'errors', 'retries', 'cost']) {
      assert.ok(!kinds(overlays).includes(kind), `${kind} was reported with no metric behind it`);
    }
  });

  it('reports what a run measured once metrics are attributed to components', () => {
    const overlays = buildOverlays(
      input({
        componentMetrics: [
          metric({
            componentId: componentId('gpt-4o-mini'),
            executionCount: 4,
            selfDurationMs: 120.4,
            inputTokens: 1379,
            outputTokens: 84,
            errorCount: 1,
            retryCount: 2,
          }),
          metric({ componentId: componentId('issue_refund'), executionCount: 2 }),
        ],
      }),
    );
    const byKind = new Map(overlays.map((overlay) => [overlay.kind, overlay]));
    assert.deepEqual(
      kinds(overlays),
      ['architecture', 'runtime_frequency', 'latency', 'tokens', 'errors', 'retries'],
      'a measured run should carry every runtime overlay and no cost overlay without a price',
    );
    assert.equal(
      byKind
        .get('runtime_frequency')
        ?.values.find((value) => value.componentId === componentId('gpt-4o-mini'))?.value,
      4,
    );
    assert.equal(
      byKind.get('tokens')?.values.find((value) => value.componentId === componentId('gpt-4o-mini'))
        ?.value,
      1463,
    );
    assert.equal(byKind.get('latency')?.basis, 'observed');
  });

  it('lists only the components a price covered, because an unpriced component is not free', () => {
    const overlays = buildOverlays(
      input({
        componentMetrics: [
          metric({
            componentId: componentId('gpt-4o-mini'),
            inputTokens: 1_000_000,
            outputTokens: 0,
            costUsd: 0.15,
          }),
          metric({ componentId: componentId('issue_refund'), executionCount: 3 }),
        ],
      }),
    );
    const cost = overlays.find((overlay) => overlay.kind === 'cost');
    assert.ok(cost !== undefined, 'a priced component should produce a cost overlay');
    assert.deepEqual(cost.values, [{ componentId: componentId('gpt-4o-mini'), value: 0.15 }]);
    assert.equal(cost.basis, 'estimated');
    assert.match(cost.caveat ?? '', /absent rather than free/);
  });

  it('reports no cost at all when no component carried a price', () => {
    const overlays = buildOverlays(
      input({
        componentMetrics: [
          metric({ componentId: componentId('gpt-4o-mini'), inputTokens: 500, outputTokens: 20 }),
        ],
      }),
    );
    assert.ok(!kinds(overlays).includes('cost'));
  });

  it('counts the runs that exercised a component', () => {
    const overlays = buildOverlays(
      input({
        componentMetrics: [metric({ componentId: componentId('orchestrator') })],
        componentsByRun: new Map([
          ['run_a', [componentId('orchestrator'), componentId('issue_refund')]],
          ['run_b', [componentId('orchestrator')]],
        ]),
      }),
    );
    const coverage = overlays.find((overlay) => overlay.kind === 'scenario_coverage');
    assert.equal(
      coverage?.values.find((value) => value.componentId === componentId('orchestrator'))?.value,
      2,
    );
    assert.equal(
      coverage?.values.find((value) => value.componentId === componentId('issue_refund'))?.value,
      1,
    );
  });
});
