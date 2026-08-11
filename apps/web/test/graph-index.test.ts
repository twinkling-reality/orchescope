/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Edge, Evidence, ReportBundle, RunRecord } from '@orchescope/schema';
import {
  buildGraphIndex,
  componentLabel,
  describeComponent,
  resolveEvidence,
} from '../src/presentation/graph-index.ts';
import { MAP_LAYOUT_KEYS, positionsFor } from '../src/presentation/layout.ts';
import { bundle, component, finding, metrics } from './fixture.ts';

function edge(overrides: Partial<Edge> & Pick<Edge, 'id' | 'from' | 'to'>): Edge {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'calls_tool',
    from: overrides.from,
    to: overrides.to,
    basis: overrides.basis ?? 'discovered',
    confidence: overrides.confidence ?? 1,
    discoveredBy: overrides.discoveredBy ?? ['adapter:test'],
    sourceLocations: [],
    configLocations: [],
    evidence: [],
    runtimeOnly: overrides.runtimeOnly ?? false,
    metadata: {},
    ...(overrides.observation === undefined ? {} : { observation: overrides.observation }),
    ...(overrides.policy === undefined ? {} : { policy: overrides.policy }),
  };
}

function spanEvidence(id: string, runId: string): Evidence {
  return {
    id,
    basis: 'observed',
    producer: 'adapter:otlp',
    kind: 'span',
    runId,
    traceId: '0'.repeat(32),
    spanId: '1'.repeat(16),
    spanName: 'tool.refund',
  };
}

function run(id: string, scenarioId: string): RunRecord {
  return {
    id,
    kind: 'scenario',
    label: 'scenario run',
    status: 'completed',
    startedAt: '2026-07-24T00:00:00.000Z',
    scenarioId,
    environment: {
      orchescopeVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      cpuCount: 8,
      totalMemoryBytes: 1,
      runtimeName: 'node',
      runtimeVersion: '24.0.0',
    },
    metrics: {
      durationMs: 1,
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
      maxObservedConcurrency: 0,
      loopIterations: 0,
    },
    componentMetrics: [],
    metadata: {},
  };
}

function withGraph(overrides: Partial<ReportBundle>): ReportBundle {
  return bundle(overrides);
}

describe('buildGraphIndex', () => {
  it('indexes components, edges and both adjacency directions', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [component({ id: 'agent:a' }), component({ id: 'tool:t', kind: 'tool' })],
          edges: [edge({ id: 'calls_tool:0000000000000001', from: 'agent:a', to: 'tool:t' })],
        },
      }),
    );
    assert.equal(index.componentsById.size, 2);
    assert.equal(index.edgesById.size, 1);
    assert.equal(index.outgoing.get('agent:a')?.length, 1);
    assert.equal(index.incoming.get('tool:t')?.length, 1);
    assert.equal(index.outgoing.get('tool:t'), undefined);
    assert.deepEqual(index.componentKinds, ['agent', 'tool']);
    assert.deepEqual(index.edgeKinds, ['calls_tool']);
  });

  it('merges several metric rows for the same component and keeps the highest quantile', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: { ...base.graph, components: [component({ id: 'agent:a' })] },
        componentMetrics: [
          metrics({
            componentId: 'agent:a',
            executionCount: 2,
            selfDurationMs: 10,
            p95DurationMs: 30,
            costUsd: 0.1,
          }),
          metrics({
            componentId: 'agent:a',
            executionCount: 3,
            selfDurationMs: 5,
            p95DurationMs: 50,
            costUsd: 0.2,
          }),
        ],
      }),
    );
    const merged = index.metricsByComponent.get('agent:a');
    assert.equal(merged?.executionCount, 5);
    assert.equal(merged?.selfDurationMs, 15);
    assert.equal(merged?.p95DurationMs, 50);
    assert.ok(Math.abs((merged?.costUsd ?? 0) - 0.3) < 1e-9);
  });

  it('leaves an unmeasured quantile absent rather than defaulting it to zero', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: { ...base.graph, components: [component({ id: 'agent:a' })] },
        componentMetrics: [metrics({ componentId: 'agent:a' })],
      }),
    );
    assert.equal(index.metricsByComponent.get('agent:a')?.p95DurationMs, undefined);
    assert.equal(index.metricsByComponent.get('agent:a')?.costUsd, undefined);
  });

  it('indexes findings by every component they name', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [component({ id: 'agent:a' }), component({ id: 'tool:t', kind: 'tool' })],
        },
        findings: [finding({ id: 'OSC-PERF-0001', components: ['agent:a', 'tool:t'] })],
      }),
    );
    assert.equal(index.findingsByComponent.get('agent:a')?.length, 1);
    assert.equal(index.findingsByComponent.get('tool:t')?.length, 1);
  });

  it('classifies runtime only components', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [
            component({
              id: 'agent:ghost',
              presence: { static: false, runtime: true, manifest: false },
            }),
            component({
              id: 'agent:declared',
              presence: { static: true, runtime: true, manifest: false },
            }),
          ],
        },
      }),
    );
    assert.deepEqual([...index.runtimeOnly], ['agent:ghost']);
  });

  it('says nothing about exercise when the report has no runs', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({ graph: { ...base.graph, components: [component({ id: 'agent:a' })] } }),
    );
    assert.equal(index.hasRuntimeEvidence, false);
    assert.equal(index.neverExercised.size, 0);
  });

  it('prefers the reconciliation delta over its own inference for never exercised components', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [component({ id: 'agent:a' }), component({ id: 'agent:b' })],
        },
        runs: [run('run_0000000000000001', 'happy')],
        reconciliation: {
          declaredNotExercised: {
            components: ['agent:b'],
            edges: [],
            runIds: ['run_0000000000000001'],
          },
          exercisedNotDeclared: { components: [], edges: [] },
          contradictions: [],
          duplicateSideEffects: [],
          joins: {
            byCodeLocation: 0,
            byRuntimeName: 0,
            byKindAndName: 0,
            onNameAlone: [],
            ambiguous: [],
          },
          coverage: {
            declaredComponents: 2,
            exercisedComponents: 1,
            declaredEdges: 0,
            exercisedEdges: 0,
          },
        },
      }),
    );
    assert.deepEqual([...index.neverExercised], ['agent:b']);
  });

  it('infers never exercised from presence when there is no reconciliation delta', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [
            component({
              id: 'agent:a',
              presence: { static: true, runtime: true, manifest: false },
            }),
            component({
              id: 'agent:b',
              presence: { static: true, runtime: false, manifest: false },
            }),
          ],
        },
        runs: [run('run_0000000000000001', 'happy')],
      }),
    );
    assert.deepEqual([...index.neverExercised], ['agent:b']);
  });

  it('derives the scenarios a component appeared in from the runs its evidence names', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [
            component({ id: 'tool:t', kind: 'tool', evidence: ['ev_0000000000000001'] }),
          ],
        },
        evidence: [spanEvidence('ev_0000000000000001', 'run_0000000000000001')],
        runs: [run('run_0000000000000001', 'refund-happy-path')],
      }),
    );
    assert.deepEqual(index.scenarioIdsByComponent.get('tool:t'), ['refund-happy-path']);
  });

  it('also derives scenarios from the runs an incident relation observed', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [component({ id: 'agent:a' }), component({ id: 'tool:t', kind: 'tool' })],
          edges: [
            edge({
              id: 'calls_tool:0000000000000001',
              from: 'agent:a',
              to: 'tool:t',
              observation: {
                executionCount: 1,
                errorCount: 0,
                retryCount: 0,
                parallelCount: 0,
                totalDurationMs: 1,
                inputTokens: 0,
                outputTokens: 0,
                runIds: ['run_0000000000000001'],
              },
            }),
          ],
        },
        runs: [run('run_0000000000000001', 'refund-happy-path')],
      }),
    );
    assert.deepEqual(index.scenarioIdsByComponent.get('tool:t'), ['refund-happy-path']);
  });

  it('reads stored layout coordinates and reports the ones it had to place itself', () => {
    const ringKeys = MAP_LAYOUT_KEYS[0];
    assert.ok(ringKeys !== undefined);
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [
            component({
              id: 'agent:a',
              metadata: { [ringKeys.x]: 1, [ringKeys.y]: 2 },
            }),
            component({ id: 'agent:b' }),
          ],
        },
      }),
    );
    assert.deepEqual(positionsFor(index.layout, 'concentric').get('agent:a'), { x: 1, y: 2 });
    assert.deepEqual(index.layout.unplacedIds, ['agent:b']);
    assert.equal(index.layout.placedIds.has('agent:b'), false);
  });

  /**
   * The map draws the busiest component at its centre and is hidden from assistive technology, so the
   * same ordering has to be answerable from the components table. A self relation counts once, because
   * it is one relation.
   */
  it('counts how many relations touch each component, in both directions', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [
            component({ id: 'agent:hub' }),
            component({ id: 'tool:one' }),
            component({ id: 'tool:two' }),
          ],
          edges: [
            edge({ id: 'edge:1', from: 'agent:hub', to: 'tool:one' }),
            edge({ id: 'edge:2', from: 'agent:hub', to: 'tool:two' }),
            edge({ id: 'edge:3', from: 'agent:hub', to: 'agent:hub' }),
          ],
        },
      }),
    );
    assert.equal(index.degreeByComponent.get('agent:hub'), 3);
    assert.equal(index.degreeByComponent.get('tool:one'), 1);
    assert.equal(index.degreeByComponent.get('tool:two'), 1);
  });
});

describe('describeComponent', () => {
  it('describes a component that is present', () => {
    const base = bundle();
    const index = buildGraphIndex(
      withGraph({
        graph: {
          ...base.graph,
          components: [component({ id: 'tool:t', kind: 'tool', displayName: 'Refund' })],
        },
      }),
    );
    assert.deepEqual(describeComponent(index, 'tool:t'), { displayName: 'Refund', kind: 'tool' });
    assert.equal(componentLabel(index, 'tool:t'), 'Refund');
  });

  it('falls back to the identifier for a component the bundle does not carry', () => {
    const index = buildGraphIndex(bundle());
    assert.deepEqual(describeComponent(index, 'tool:missing'), {
      displayName: 'tool:missing',
      kind: 'unknown',
    });
  });
});

describe('resolveEvidence', () => {
  it('separates resolved records from references the bundle does not carry', () => {
    const index = buildGraphIndex(
      bundle({ evidence: [spanEvidence('ev_0000000000000001', 'run_0000000000000001')] }),
    );
    const result = resolveEvidence(index, ['ev_0000000000000001', 'ev_0000000000000002']);
    assert.equal(result.resolved.length, 1);
    assert.deepEqual(result.missing, ['ev_0000000000000002']);
  });
});
