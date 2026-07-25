import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildGraph,
  componentDraft,
  edgeDraft,
  observedComponent,
  observedEdge,
  runtimeTopology,
  sideEffectRecord,
} from '@orchescope/testkit';
import { controlFlowCycles, entryPoints, unreachableComponents } from '../src/analysis.ts';
import { computeDelta } from '../src/delta.ts';
import { diffGraphs } from '../src/diff.ts';
import { indexGraph } from '../src/indexed-graph.ts';
import { reconcile } from '../src/reconcile.ts';

/**
 * System graph tests.
 *
 * The graph is the thing every finding points at, so the properties tested here are identity and the joins: an
 * identifier survives an edit, a component observed at runtime is matched to the one declared in source when it is the
 * same thing and reported separately when it is not, and a duplicated external effect is attributed to the operation
 * that caused it.
 */

const orchestrator = componentDraft({
  kind: 'agent',
  name: 'orchestrator',
  file: 'src/main.ts',
  line: 10,
});
const refund = componentDraft({
  kind: 'tool',
  name: 'issue_refund',
  file: 'src/tools/refund.ts',
  line: 20,
});
const inventory = componentDraft({
  kind: 'tool',
  name: 'check_inventory',
  file: 'src/tools/inventory.ts',
  line: 5,
});
const model = componentDraft({ kind: 'model', name: 'demo-small', file: 'src/models.ts', line: 3 });

describe('identity', () => {
  it('is readable and derived from kind, module and name', () => {
    const graph = buildGraph([orchestrator, refund]);
    assert.deepEqual(
      graph.components.map((component) => component.id),
      ['agent:orchestrator', 'tool:issue_refund'],
    );
  });

  it('survives a line number changing, because a line is not part of the identity', () => {
    const moved = componentDraft({
      kind: 'tool',
      name: 'issue_refund',
      file: 'src/tools/refund.ts',
      line: 200,
    });
    const before = buildGraph([refund]).components[0];
    const after = buildGraph([moved]).components[0];
    assert.equal(before?.id, after?.id);
    assert.equal(before?.fingerprint, after?.fingerprint);
    assert.notEqual(before?.sourceLocations[0]?.startLine, after?.sourceLocations[0]?.startLine);
  });

  it('separates two components with the same name in different modules', () => {
    const other = componentDraft({
      kind: 'tool',
      name: 'issue_refund',
      file: 'src/legacy/refund.ts',
    });
    const graph = buildGraph([refund, other]);
    const ids = graph.components.map((component) => component.id);
    assert.equal(new Set(ids).size, 2, `identifiers collided: ${ids.join(', ')}`);
    assert.ok(
      ids.some((id) => id.includes('~')),
      'the disambiguated identifier carries a suffix',
    );
  });

  it('is stable no matter what order components were discovered in', () => {
    const forward = buildGraph([orchestrator, refund, inventory, model]);
    const backward = buildGraph([model, inventory, refund, orchestrator]);
    assert.deepEqual(
      forward.components.map((component) => component.id).sort(),
      backward.components.map((component) => component.id).sort(),
    );
    for (const component of forward.components) {
      const other = backward.components.find((candidate) => candidate.id === component.id);
      assert.equal(other?.fingerprint, component.fingerprint);
    }
  });

  it('merges two discoveries of the same component instead of duplicating it', () => {
    const again = componentDraft({
      kind: 'tool',
      name: 'issue_refund',
      file: 'src/tools/refund.ts',
      discoveredBy: 'manifest',
    });
    const graph = buildGraph([refund, again]);
    assert.equal(graph.components.length, 1);
    assert.deepEqual(graph.components[0]?.discoveredBy.slice().sort(), ['fixture', 'manifest']);
  });
});

describe('analysis', () => {
  it('names the roots of the control flow, not every agent', () => {
    const graph = buildGraph(
      [orchestrator, refund, inventory],
      [
        edgeDraft('calls_tool', orchestrator, refund),
        edgeDraft('calls_tool', orchestrator, inventory),
      ],
    );
    const roots = entryPoints(indexGraph(graph));
    assert.deepEqual(
      roots.map((component) => component.id),
      ['agent:orchestrator'],
    );
  });

  it('reports a component that nothing reaches', () => {
    const graph = buildGraph(
      [orchestrator, refund, inventory],
      [edgeDraft('calls_tool', orchestrator, refund)],
    );
    const unreachable = unreachableComponents(indexGraph(graph));
    assert.deepEqual(
      unreachable.map((component) => component.id),
      ['tool:check_inventory'],
    );
  });

  it('finds a handoff cycle between agents', () => {
    const worker = componentDraft({ kind: 'agent', name: 'worker', file: 'src/worker.ts' });
    const graph = buildGraph(
      [orchestrator, worker],
      [
        edgeDraft('hands_off_to', orchestrator, worker),
        edgeDraft('hands_off_to', worker, orchestrator),
      ],
    );
    const cycles = controlFlowCycles(indexGraph(graph));
    assert.equal(cycles.length, 1);
    assert.equal(
      cycles[0]?.length,
      3,
      'a cycle is reported closed, starting and ending at the same component',
    );
  });

  it('does not call a containment relation control flow', () => {
    const group = componentDraft({ kind: 'agent_group', name: 'crew', file: 'src/crew.ts' });
    const graph = buildGraph([group, orchestrator], [edgeDraft('contains', group, orchestrator)]);
    assert.equal(controlFlowCycles(indexGraph(graph)).length, 0);
  });
});

describe('reconcile', () => {
  it('matches an observed component to the declared one by name and kind', () => {
    const graph = buildGraph([orchestrator, refund]);
    const result = reconcile(graph, [
      runtimeTopology({
        components: [
          observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
          observedComponent({ kind: 'tool', observedName: 'issue_refund' }),
        ],
      }),
    ]);
    assert.equal(result.matches.length, 2);
    assert.equal(result.runtimeOnlyComponentIds.length, 0);
    for (const component of result.graph.components) {
      assert.deepEqual(component.presence, { static: true, runtime: true, manifest: false });
    }
  });

  it('matches on a bare name when the runtime qualifies it with a namespace', () => {
    const graph = buildGraph([model]);
    const result = reconcile(graph, [
      runtimeTopology({
        components: [
          observedComponent({ kind: 'model', observedName: 'orchescope-demo/demo-small' }),
        ],
      }),
    ]);
    assert.equal(result.runtimeOnlyComponentIds.length, 0);
    assert.equal(result.matches[0]?.componentId, 'model:demo-small');
  });

  it('keeps a component that only the runtime saw and says so', () => {
    const graph = buildGraph([orchestrator]);
    const result = reconcile(graph, [
      runtimeTopology({
        components: [observedComponent({ kind: 'tool', observedName: 'send_email' })],
      }),
    ]);
    assert.equal(result.runtimeOnlyComponentIds.length, 1);
    const added = result.graph.components.find(
      (component) => component.displayName === 'send_email',
    );
    assert.deepEqual(added?.presence, { static: false, runtime: true, manifest: false });
    assert.equal(added?.basis, 'observed');
  });

  it('leaves a declared component that nothing exercised marked source only', () => {
    const graph = buildGraph([orchestrator, refund]);
    const result = reconcile(graph, [
      runtimeTopology({
        components: [observedComponent({ kind: 'agent', observedName: 'orchestrator' })],
      }),
    ]);
    const notRun = result.graph.components.find(
      (component) => component.id === 'tool:issue_refund',
    );
    assert.deepEqual(notRun?.presence, { static: true, runtime: false, manifest: false });
  });

  it('records an observed relation on the declared edge', () => {
    const graph = buildGraph(
      [orchestrator, refund],
      [edgeDraft('calls_tool', orchestrator, refund)],
    );
    const result = reconcile(graph, [
      runtimeTopology({
        components: [
          observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
          observedComponent({ kind: 'tool', observedName: 'issue_refund' }),
        ],
        edges: [
          observedEdge({
            kind: 'calls_tool',
            fromKind: 'agent',
            fromObservedName: 'orchestrator',
            toKind: 'tool',
            toObservedName: 'issue_refund',
            executionCount: 3,
          }),
        ],
      }),
    ]);
    const edge = result.graph.edges[0];
    assert.equal(edge?.observation?.executionCount, 3);
    assert.equal(edge?.observation?.errorCount, 0);
  });
});

describe('computeDelta', () => {
  const graph = buildGraph([orchestrator, refund], [edgeDraft('calls_tool', orchestrator, refund)]);

  const runWith = (effects: readonly ReturnType<typeof sideEffectRecord>[]) => [
    { runId: `run_${'d'.repeat(16)}`, sideEffects: effects },
  ];

  it('reports nothing duplicated when an effect happened once', () => {
    const result = computeDelta({
      graph,
      runs: runWith([sideEffectRecord({ kind: 'refund', target: 'payments/order-1' })]),
      spanToComponent: new Map(),
    });
    assert.deepEqual(result.delta.duplicateSideEffects, []);
  });

  it('reports a duplicate when the same untracked effect happened twice in one run', () => {
    const result = computeDelta({
      graph,
      runs: runWith([
        sideEffectRecord({
          kind: 'refund',
          target: 'payments/order-1',
          outcome: 'unknown',
          retryAttempt: 1,
        }),
        sideEffectRecord({ kind: 'refund', target: 'payments/order-1', retryAttempt: 2 }),
      ]),
      spanToComponent: new Map(),
    });
    assert.equal(result.delta.duplicateSideEffects.length, 1);
    const duplicate = result.delta.duplicateSideEffects[0];
    assert.equal(duplicate?.occurrences, 2);
    assert.equal(duplicate?.idempotencyKeyPresent, false);
  });

  it('does not count a failed attempt, because nothing happened outside the system', () => {
    const result = computeDelta({
      graph,
      runs: runWith([
        sideEffectRecord({ kind: 'refund', target: 'payments/order-1', outcome: 'failed' }),
        sideEffectRecord({ kind: 'refund', target: 'payments/order-1', outcome: 'succeeded' }),
      ]),
      spanToComponent: new Map(),
    });
    assert.deepEqual(result.delta.duplicateSideEffects, []);
  });

  it('treats an idempotency key as what distinguishes a repeat from a duplicate', () => {
    const result = computeDelta({
      graph,
      runs: runWith([
        sideEffectRecord({ kind: 'refund', target: 'payments/order-1', idempotencyKey: 'rfd-1' }),
        sideEffectRecord({ kind: 'refund', target: 'payments/order-1', idempotencyKey: 'rfd-1' }),
      ]),
      spanToComponent: new Map(),
    });
    assert.equal(result.delta.duplicateSideEffects.length, 1);
    assert.equal(result.delta.duplicateSideEffects[0]?.idempotencyKeyPresent, true);
  });

  it('counts the worst single run rather than the sum across runs', () => {
    const effects = [
      sideEffectRecord({ kind: 'refund', target: 'payments/order-1', outcome: 'unknown' }),
      sideEffectRecord({ kind: 'refund', target: 'payments/order-1' }),
    ];
    const result = computeDelta({
      graph,
      runs: [
        { runId: `run_${'e'.repeat(16)}`, sideEffects: effects },
        { runId: `run_${'f'.repeat(16)}`, sideEffects: effects },
      ],
      spanToComponent: new Map(),
    });
    assert.equal(result.delta.duplicateSideEffects[0]?.occurrences, 2);
    assert.equal(result.delta.duplicateSideEffects[0]?.totalOccurrences, 4);
  });

  it('attributes a duplicate to the component whose span produced it', () => {
    const result = computeDelta({
      graph,
      runs: runWith([
        sideEffectRecord({
          kind: 'refund',
          target: 'payments/order-1',
          spanId: '1'.repeat(16),
          outcome: 'unknown',
        }),
        sideEffectRecord({ kind: 'refund', target: 'payments/order-1', spanId: '2'.repeat(16) }),
      ]),
      spanToComponent: new Map([
        ['1'.repeat(16), 'tool:issue_refund'],
        ['2'.repeat(16), 'tool:issue_refund'],
      ]),
    });
    assert.equal(result.delta.duplicateSideEffects[0]?.componentId, 'tool:issue_refund');
  });

  it('reports what was declared and never exercised', () => {
    const result = computeDelta({ graph, runs: [], spanToComponent: new Map() });
    assert.ok(result.delta.declaredNotExercised.components.includes('tool:issue_refund'));
  });
});

describe('diffGraphs', () => {
  it('reports what was added, removed and kept', () => {
    const before = buildGraph([orchestrator, refund]);
    const after = buildGraph([orchestrator, inventory]);
    const delta = diffGraphs(before, after);
    assert.deepEqual(delta.addedComponents, ['tool:check_inventory']);
    assert.deepEqual(delta.removedComponents, ['tool:issue_refund']);
    assert.deepEqual(delta.changedComponents, []);
  });

  it('reports a graph compared with itself as unchanged', () => {
    const graph = buildGraph(
      [orchestrator, refund],
      [edgeDraft('calls_tool', orchestrator, refund)],
    );
    const delta = diffGraphs(graph, graph);
    assert.deepEqual(delta.addedComponents, []);
    assert.deepEqual(delta.removedComponents, []);
    assert.deepEqual(delta.addedEdges, []);
    assert.deepEqual(delta.removedEdges, []);
  });
});
