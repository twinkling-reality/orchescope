import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcile } from '@orchescope/graph';
import type { ComponentId } from '@orchescope/schema';
import {
  buildGraph,
  componentDraft,
  observedComponent,
  runtimeTopology,
} from '@orchescope/testkit';
import {
  type ObservedMetrics,
  observedKeyToComponentId,
  resolveComponentMetrics,
} from '../src/runtime-attribution.ts';

/**
 * Attribution tests.
 *
 * A trace reports names and a graph holds identities, and everything a reader sees about what a component did at
 * runtime depends on the step between the two. When that step is missing nothing fails: the overlays are empty, the
 * rules report insufficient evidence, and the product looks like it was pointed at a system that did nothing. These
 * tests exist because that is a failure no exception announces.
 */

const graph = buildGraph([
  componentDraft({ kind: 'agent', name: 'orchestrator' }),
  componentDraft({ kind: 'model', name: 'gpt-4o-mini' }),
]);

const declared = (name: string): ComponentId => {
  const found = graph.components.find((component) => component.displayName === name);
  assert.ok(found !== undefined, `no component named ${name}`);
  return found.id;
};

const observedMetric = (
  overrides: Partial<ObservedMetrics[number]> &
    Pick<ObservedMetrics[number], 'kind' | 'observedName'>,
): ObservedMetrics[number] => ({
  componentId: 'unassigned',
  provider: undefined,
  model: undefined,
  executionCount: 1,
  selfDurationMs: 5,
  totalDurationMs: 5,
  inputTokens: 0,
  outputTokens: 0,
  errorCount: 0,
  retryCount: 0,
  ...overrides,
});

const reconciled = () =>
  reconcile(graph, [
    runtimeTopology({
      components: [
        observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
        observedComponent({ kind: 'tool', observedName: 'undeclared_tool' }),
      ],
    }),
  ]);

describe('observedKeyToComponentId', () => {
  it('maps an observed name that met a declaration', () => {
    const byKey = observedKeyToComponentId(reconciled());
    assert.equal(byKey.get('agent|orchestrator'), declared('orchestrator'));
  });

  it('maps an observed name that met no declaration and became its own component', () => {
    const result = reconciled();
    const byKey = observedKeyToComponentId(result);
    const runtimeOnly = result.runtimeOnlyComponentIds[0];
    assert.ok(runtimeOnly !== undefined, 'the undeclared tool should have become a component');
    assert.equal(
      byKey.get('tool|undeclared_tool'),
      runtimeOnly,
      'a component that only exists because it ran is exactly the one a reader wants numbers for',
    );
  });
});

describe('resolveComponentMetrics', () => {
  const byKey = new Map<string, ComponentId>([
    ['agent|orchestrator', declared('orchestrator')],
    ['model|gpt-4o-mini', declared('gpt-4o-mini')],
  ]);

  it('attributes an observed name to the component reconciliation resolved it to', () => {
    const resolved = resolveComponentMetrics(
      [observedMetric({ kind: 'agent', observedName: 'orchestrator', executionCount: 3 })],
      byKey,
    );
    assert.deepEqual(
      resolved.map((metric) => [metric.componentId, metric.executionCount]),
      [[declared('orchestrator'), 3]],
    );
  });

  it('drops a name no component was resolved for rather than storing it against a placeholder', () => {
    const resolved = resolveComponentMetrics(
      [observedMetric({ kind: 'tool', observedName: 'never_reconciled' })],
      byKey,
    );
    assert.deepEqual(resolved, []);
  });

  it('adds up two observed names that resolved to one component', () => {
    const resolved = resolveComponentMetrics(
      [
        observedMetric({
          kind: 'agent',
          observedName: 'orchestrator',
          executionCount: 2,
          errorCount: 1,
        }),
        observedMetric({
          kind: 'agent',
          observedName: 'Orchestrator',
          executionCount: 5,
          errorCount: 0,
        }),
      ],
      byKey,
    );
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.executionCount, 7);
    assert.equal(resolved[0]?.errorCount, 1);
  });

  it('estimates cost from observed tokens against a configured price', () => {
    const resolved = resolveComponentMetrics(
      [
        observedMetric({
          kind: 'model',
          observedName: 'gpt-4o-mini',
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputTokens: 1_000_000,
          outputTokens: 500_000,
        }),
      ],
      byKey,
      { 'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
    );
    assert.equal(resolved[0]?.costUsd, 0.15 + 0.3);
  });

  it('reports no cost for a model the price table does not name', () => {
    const resolved = resolveComponentMetrics(
      [
        observedMetric({
          kind: 'model',
          observedName: 'gpt-4o-mini',
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputTokens: 1_000,
        }),
      ],
      byKey,
      { 'anthropic/claude-sonnet-4': { inputPerMillion: 3, outputPerMillion: 15 } },
    );
    assert.equal(resolved[0]?.costUsd, undefined);
  });

  it('reports no cost for a component that reported no tokens, rather than a cost of zero', () => {
    const resolved = resolveComponentMetrics(
      [
        observedMetric({
          kind: 'agent',
          observedName: 'orchestrator',
          provider: 'openai',
          model: 'gpt-4o-mini',
        }),
      ],
      byKey,
      { 'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
    );
    assert.equal(resolved[0]?.costUsd, undefined);
  });
});
