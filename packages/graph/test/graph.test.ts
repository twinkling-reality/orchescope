import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EdgePolicy, ObservedEdge } from '@orchescope/schema';
import {
  buildGraph,
  componentDraft,
  edgeDraft,
  observedComponent,
  observedEdge,
  runtimeTopology,
  sideEffectRecord,
} from '@orchescope/testkit';
import { controlFlowCycles, degrees, entryPoints, unreachableComponents } from '../src/analysis.ts';
import { SystemGraphBuilder } from '../src/graph-builder.ts';
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

  /**
   * A fully cyclic set of agents has no member with an inbound relation to spare, so none of them
   * qualifies as a root. The answer to that used to be a fallback over the whole graph, which fired on
   * whether the repository had a root somewhere rather than on whether this part of it did.
   */
  describe('a set of agents that hand off to one another and back', () => {
    const worker = componentDraft({ kind: 'agent', name: 'worker', file: 'src/worker.ts' });
    const handler = componentDraft({
      kind: 'entrypoint',
      name: 'chat_endpoint',
      file: 'src/api.ts',
    });

    const cyclicGraph = (extra: readonly ReturnType<typeof componentDraft>[]) =>
      indexGraph(
        buildGraph(
          [orchestrator, worker, refund, ...extra],
          [
            edgeDraft('hands_off_to', orchestrator, worker),
            edgeDraft('hands_off_to', worker, orchestrator),
            edgeDraft('calls_tool', worker, refund),
          ],
        ),
      );

    it('reports a way into the cycle rather than the whole cycle as unreachable', () => {
      assert.deepEqual(
        unreachableComponents(cyclicGraph([])).map((component) => component.id),
        [],
      );
    });

    it('answers the same with an unrelated root beside it, which used to change the answer', () => {
      // The pinned customer service demonstration reported seventeen of twenty two components
      // unreachable because three Flask routes no adapter joins to its agents were roots. Deleting the
      // routes would have reported none. An answer about one agent cannot turn on an HTTP handler.
      const withHandler = cyclicGraph([handler]);
      assert.deepEqual(
        unreachableComponents(withHandler).map((component) => component.id),
        [],
      );
      assert.ok(
        entryPoints(withHandler)
          .map((component) => component.id)
          .includes('entrypoint:chat_endpoint'),
      );
    });

    it('still reports a tool the cycle never calls, which is a kind that cannot be a root', () => {
      assert.deepEqual(
        unreachableComponents(cyclicGraph([inventory])).map((component) => component.id),
        ['tool:check_inventory'],
      );
    });

    it('promotes one way in rather than every candidate the roots do not reach', () => {
      // Promoting the unreached set together would call the far end of a chain an entry point while
      // the near end hands off to it.
      const trailing = componentDraft({ kind: 'agent', name: 'reporter', file: 'src/report.ts' });
      const graph = indexGraph(
        buildGraph(
          [orchestrator, worker, trailing],
          [
            edgeDraft('hands_off_to', orchestrator, worker),
            edgeDraft('hands_off_to', worker, orchestrator),
            edgeDraft('hands_off_to', worker, trailing),
          ],
        ),
      );
      assert.equal(
        entryPoints(graph).some((component) => component.id === 'agent:reporter'),
        false,
      );
      assert.equal(entryPoints(graph).length, 1);
    });
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

  /**
   * A relation only a run produced is not part of the declared topology, and every question in this
   * module is about that topology. Each case reconciles a real run rather than setting the flag by hand,
   * because reconciliation is what produces these relations and the point is that they arrive from there.
   */
  describe('a relation that only a run produced', () => {
    const runReaching = (fromKind: string, fromName: string, toKind: string, toName: string) =>
      runtimeTopology({
        components: [
          observedComponent({ kind: fromKind, observedName: fromName }),
          observedComponent({ kind: toKind, observedName: toName }),
        ],
        edges: [
          observedEdge({
            kind: 'calls_tool',
            fromKind,
            fromObservedName: fromName,
            toKind,
            toObservedName: toName,
          }),
        ],
      });

    it('leaves a component an entry point when nothing declared points at it', () => {
      // The case this was found on: an instrumentation's own span pointed at an application's agents, so
      // none of them was a root any more, and the wrapper reached the whole graph in their place.
      const worker = componentDraft({ kind: 'agent', name: 'worker', file: 'src/worker.ts' });
      const graph = buildGraph([orchestrator, worker]);
      const reconciled = reconcile(graph, [
        runtimeTopology({
          components: [
            observedComponent({ kind: 'agent', observedName: 'worker' }),
            observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
          ],
          edges: [
            observedEdge({
              kind: 'hands_off_to',
              fromKind: 'agent',
              fromObservedName: 'worker',
              toKind: 'agent',
              toObservedName: 'orchestrator',
            }),
          ],
        }),
      ]);
      assert.deepEqual(
        entryPoints(indexGraph(reconciled.graph))
          .map((component) => component.id)
          .sort(),
        ['agent:orchestrator', 'agent:worker'],
      );
    });

    it('does not reach a declared component that no declared relation reaches', () => {
      const graph = buildGraph([orchestrator, refund]);
      const reconciled = reconcile(graph, [
        runReaching('agent', 'orchestrator', 'tool', 'issue_refund'),
      ]);
      assert.deepEqual(
        unreachableComponents(indexGraph(reconciled.graph)).map((component) => component.id),
        ['tool:issue_refund'],
      );
    });

    it('does not close a cycle in the declared control flow', () => {
      const worker = componentDraft({ kind: 'agent', name: 'worker', file: 'src/worker.ts' });
      const graph = buildGraph(
        [orchestrator, worker],
        [edgeDraft('hands_off_to', orchestrator, worker)],
      );
      const reconciled = reconcile(graph, [
        runtimeTopology({
          components: [
            observedComponent({ kind: 'agent', observedName: 'worker' }),
            observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
          ],
          edges: [
            observedEdge({
              kind: 'hands_off_to',
              fromKind: 'agent',
              fromObservedName: 'worker',
              toKind: 'agent',
              toObservedName: 'orchestrator',
            }),
          ],
        }),
      ]);
      assert.equal(controlFlowCycles(indexGraph(reconciled.graph)).length, 0);
    });

    it('does not count towards what an agent is declared to coordinate', () => {
      const graph = buildGraph(
        [orchestrator, refund],
        [edgeDraft('calls_tool', orchestrator, refund)],
      );
      const reconciled = reconcile(graph, [
        runReaching('agent', 'orchestrator', 'tool', 'check_inventory'),
      ]);
      const stats = degrees(indexGraph(reconciled.graph));
      assert.equal(
        stats.find((entry) => entry.componentId === 'agent:orchestrator')?.controlFlowOutDegree,
        1,
      );
    });
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

  /*
   * Coverage is the declared set. An undeclared observation belongs in exercisedNotDeclared, not in
   * both halves of the fraction. The old pair counted every observable component a run could name,
   * which made the demonstration system's "15 of 22" include one component nothing declared.
   */
  it('counts coverage over declared components only', () => {
    const base = buildGraph([orchestrator, refund, inventory]);
    const reconciled = reconcile(base, [
      runtimeTopology({
        components: [
          observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
          observedComponent({ kind: 'tool', observedName: 'mystery_tool' }),
        ],
      }),
    ]);
    const result = computeDelta({
      graph: reconciled.graph,
      runs: [{ runId: `run_${'c'.repeat(16)}`, sideEffects: [] }],
      spanToComponent: new Map(),
      matches: reconciled.matches,
      ambiguous: reconciled.ambiguous,
    });
    assert.equal(result.delta.coverage.declaredComponents, 3);
    assert.equal(result.delta.coverage.exercisedComponents, 1);
    assert.equal(result.delta.exercisedNotDeclared.components.length, 1);
    assert.equal(result.delta.coverage.componentExerciseRate, 1 / 3);
  });

  /*
   * The same fraction for relations, which had the same defect and kept it. The numerator counted every
   * observed relation and the denominator counted declared ones, so the two halves of the edge delta
   * stopped adding up: on the pinned LangGraph application, sixteen declared, sixteen never exercised,
   * and an answer of eleven of sixteen exercised.
   */
  it('counts coverage over declared relations only', () => {
    const base = buildGraph(
      [orchestrator, refund, inventory],
      [edgeDraft('calls_tool', orchestrator, refund)],
    );
    const reconciled = reconcile(base, [
      runtimeTopology({
        components: [
          observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
          observedComponent({ kind: 'tool', observedName: 'issue_refund' }),
          observedComponent({ kind: 'tool', observedName: 'mystery_tool' }),
        ],
        edges: [
          observedEdge({
            kind: 'calls_tool',
            fromKind: 'agent',
            fromObservedName: 'orchestrator',
            toKind: 'tool',
            toObservedName: 'issue_refund',
          }),
          observedEdge({
            kind: 'calls_tool',
            fromKind: 'agent',
            fromObservedName: 'orchestrator',
            toKind: 'tool',
            toObservedName: 'mystery_tool',
          }),
        ],
      }),
    ]);
    const result = computeDelta({
      graph: reconciled.graph,
      runs: [{ runId: `run_${'c'.repeat(16)}`, sideEffects: [] }],
      spanToComponent: new Map(),
      matches: reconciled.matches,
      ambiguous: reconciled.ambiguous,
    });
    assert.equal(result.delta.coverage.declaredEdges, 1);
    assert.equal(result.delta.coverage.exercisedEdges, 1);
    assert.equal(result.delta.coverage.edgeExerciseRate, 1);
    // The relation to a tool nothing declared is the one the numerator used to count twice over.
    assert.equal(result.delta.exercisedNotDeclared.edges.length, 1);
  });

  it('keeps the two halves of the relation delta adding up to what was declared', () => {
    const base = buildGraph(
      [orchestrator, refund, inventory],
      [
        edgeDraft('calls_tool', orchestrator, refund),
        edgeDraft('calls_tool', orchestrator, inventory),
      ],
    );
    const reconciled = reconcile(base, [
      runtimeTopology({
        components: [
          observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
          observedComponent({ kind: 'tool', observedName: 'mystery_tool' }),
        ],
        edges: [
          observedEdge({
            kind: 'calls_tool',
            fromKind: 'agent',
            fromObservedName: 'orchestrator',
            toKind: 'tool',
            toObservedName: 'mystery_tool',
          }),
        ],
      }),
    ]);
    const result = computeDelta({
      graph: reconciled.graph,
      runs: [{ runId: `run_${'c'.repeat(16)}`, sideEffects: [] }],
      spanToComponent: new Map(),
      matches: reconciled.matches,
      ambiguous: reconciled.ambiguous,
    });
    const { declaredEdges, exercisedEdges } = result.delta.coverage;
    assert.equal(exercisedEdges + result.delta.declaredNotExercised.edges.length, declaredEdges);
    assert.equal(exercisedEdges, 0);
    assert.equal(result.delta.coverage.edgeExerciseRate, 0);
  });
});

/**
 * A declaration contradicted by an observation.
 *
 * The Model Context Protocol requires a client to treat a tool annotation as untrusted, so `readOnlyHint` is a claim
 * and not a fact, and the same is true of a declared timeout, retry ceiling or approval requirement. Each test here
 * declares one thing and then observes the opposite, because a delta that only ever repeats the declaration back is
 * indistinguishable from one that never checked.
 */
describe('a declaration contradicted by an observation', () => {
  const reader = componentDraft({
    kind: 'tool',
    name: 'lookup_order',
    file: 'src/tools/lookup.ts',
    details: { for: 'tool', readOnlyHint: true },
  });
  const idempotent = componentDraft({
    kind: 'tool',
    name: 'issue_refund',
    file: 'src/tools/refund.ts',
    details: { for: 'tool', idempotentHint: true },
  });
  const writer = componentDraft({
    kind: 'tool',
    name: 'purge_records',
    file: 'src/tools/purge.ts',
    details: { for: 'tool', readOnlyHint: true },
    sideEffect: 'non_idempotent_write',
  });
  const approval = componentDraft({
    kind: 'approval_boundary',
    name: 'refund_approval',
    file: 'src/approval.ts',
  });

  const observedTool = (performedSideEffect: boolean) =>
    computeDelta({
      graph: reconcile(buildGraph([orchestrator, reader]), [
        runtimeTopology({
          components: [
            observedComponent({ kind: 'tool', observedName: 'lookup_order', performedSideEffect }),
          ],
        }),
      ]).graph,
      runs: [],
      spanToComponent: new Map(),
    }).delta.contradictions;

  it('reports a tool that declares readOnlyHint and was observed causing an effect', () => {
    const contradictions = observedTool(true);
    assert.equal(contradictions.length, 1);
    assert.equal(contradictions[0]?.kind, 'read_only_hint');
    assert.equal(contradictions[0]?.componentId, 'tool:lookup_order');
    assert.equal(contradictions[0]?.declared, 'readOnlyHint: true');
    assert.equal(contradictions[0]?.evidence.length, 1, 'a contradiction has to cite evidence');
  });

  it('stays quiet when the same declaration was observed and honoured', () => {
    assert.deepEqual(observedTool(false), []);
  });

  it('reports a tool that declares idempotentHint and repeated one effect inside a run', () => {
    const result = computeDelta({
      graph: buildGraph([orchestrator, idempotent]),
      runs: [
        {
          runId: `run_${'d'.repeat(16)}`,
          sideEffects: [
            sideEffectRecord({
              kind: 'refund',
              target: 'payments/order-1',
              spanId: '1'.repeat(16),
              outcome: 'unknown',
            }),
            sideEffectRecord({
              kind: 'refund',
              target: 'payments/order-1',
              spanId: '2'.repeat(16),
            }),
          ],
        },
      ],
      // The duplicate is only a contradiction once it is attributed to the component that declared the hint.
      spanToComponent: new Map([
        ['1'.repeat(16), 'tool:issue_refund'],
        ['2'.repeat(16), 'tool:issue_refund'],
      ]),
    });
    assert.equal(result.delta.contradictions.length, 1);
    assert.equal(result.delta.contradictions[0]?.kind, 'idempotent_hint');
    assert.equal(result.delta.contradictions[0]?.componentId, 'tool:issue_refund');
    assert.match(result.delta.contradictions[0]?.observed ?? '', /^2 occurrences/);
  });

  it('leaves an unattributed duplicate out of the contradictions', () => {
    const result = computeDelta({
      graph: buildGraph([orchestrator, idempotent]),
      runs: [
        {
          runId: `run_${'d'.repeat(16)}`,
          sideEffects: [
            sideEffectRecord({ kind: 'refund', target: 'payments/order-1', outcome: 'unknown' }),
            sideEffectRecord({ kind: 'refund', target: 'payments/order-1' }),
          ],
        },
      ],
      spanToComponent: new Map(),
    });
    assert.equal(result.delta.duplicateSideEffects.length, 1);
    assert.deepEqual(result.delta.contradictions, []);
  });

  it('reports a tool that declares readOnlyHint and was discovered writing', () => {
    const result = computeDelta({
      graph: buildGraph([orchestrator, writer]),
      runs: [],
      spanToComponent: new Map(),
    });
    assert.equal(result.delta.contradictions.length, 1);
    assert.equal(result.delta.contradictions[0]?.kind, 'destructive_hint');
    assert.equal(result.delta.contradictions[0]?.componentId, 'tool:purge_records');
  });

  const exercisedCall = (policy: EdgePolicy, observation: Partial<ObservedEdge> = {}) =>
    computeDelta({
      graph: reconcile(
        buildGraph(
          [orchestrator, idempotent],
          [edgeDraft('calls_tool', orchestrator, idempotent, { policy })],
        ),
        [
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
                ...observation,
              }),
            ],
          }),
        ],
      ).graph,
      runs: [],
      spanToComponent: new Map(),
    }).delta.contradictions;

  it('reports a call that ran longer than the timeout it declares', () => {
    const contradictions = exercisedCall({ timeoutMs: 200 }, { durationsMs: [40, 900] });
    assert.equal(contradictions.length, 1);
    assert.equal(contradictions[0]?.kind, 'timeout');
    assert.equal(contradictions[0]?.componentId, 'tool:issue_refund');
    assert.equal(contradictions[0]?.observed, 'longest observed call 900 ms');
  });

  it('stays quiet when every observed call finished inside the declared timeout', () => {
    assert.deepEqual(exercisedCall({ timeoutMs: 200 }, { durationsMs: [40, 190] }), []);
  });

  it('reports more retries than the declared attempt ceiling allows', () => {
    const contradictions = exercisedCall(
      { retry: { maxAttempts: 2, bounded: true, backoff: 'exponential', idempotency: 'absent' } },
      { executionCount: 1, retryCount: 3 },
    );
    assert.equal(contradictions.length, 1);
    assert.equal(contradictions[0]?.kind, 'retry_bound');
    assert.equal(contradictions[0]?.declared, 'maxAttempts 2');
    assert.equal(contradictions[0]?.observed, '3 retries across 1 executions');
  });

  /* The ceiling is per execution, so two executions of a two attempt call may carry two retries between them. */
  it('spends the attempt ceiling once per execution rather than once per run', () => {
    assert.deepEqual(
      exercisedCall(
        { retry: { maxAttempts: 2, bounded: true, backoff: 'exponential', idempotency: 'absent' } },
        { executionCount: 2, retryCount: 2 },
      ),
      [],
    );
  });

  it('reports an operation that requires approval and ran without one being observed', () => {
    const contradictions = exercisedCall({ requiresApproval: true });
    assert.equal(contradictions.length, 1);
    assert.equal(contradictions[0]?.kind, 'approval');
    assert.equal(contradictions[0]?.componentId, 'tool:issue_refund');
  });

  it('stays quiet when the approval the operation requires was observed', () => {
    const result = computeDelta({
      graph: reconcile(
        buildGraph(
          [orchestrator, idempotent, approval],
          [
            edgeDraft('calls_tool', orchestrator, idempotent, {
              policy: { requiresApproval: true },
            }),
          ],
        ),
        [
          runtimeTopology({
            components: [
              observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
              observedComponent({ kind: 'tool', observedName: 'issue_refund' }),
              observedComponent({ kind: 'approval_boundary', observedName: 'refund_approval' }),
            ],
            edges: [
              observedEdge({
                kind: 'calls_tool',
                fromKind: 'agent',
                fromObservedName: 'orchestrator',
                toKind: 'tool',
                toObservedName: 'issue_refund',
              }),
              // The guard runs inside the operation it guards, which is the direction the topology reports.
              observedEdge({
                kind: 'guarded_by',
                fromKind: 'tool',
                fromObservedName: 'issue_refund',
                toKind: 'approval_boundary',
                toObservedName: 'refund_approval',
              }),
            ],
          }),
        ],
      ).graph,
      runs: [],
      spanToComponent: new Map(),
    });
    assert.deepEqual(result.delta.contradictions, []);
  });

  it('reports every contradiction a single declaration produces, not the first one', () => {
    const contradictions = exercisedCall(
      {
        timeoutMs: 200,
        retry: { maxAttempts: 1, bounded: true, backoff: 'none', idempotency: 'absent' },
        requiresApproval: true,
      },
      { executionCount: 1, retryCount: 2, durationsMs: [900] },
    );
    assert.deepEqual(
      contradictions.map((contradiction) => contradiction.kind),
      ['timeout', 'retry_bound', 'approval'],
    );
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

/**
 * A relation an adapter could not justify.
 *
 * The graph must never contain an edge to a component that does not exist, and for a while it enforced that by
 * refusing to build at all. One defective relation then ended the audit of an eight hundred file repository,
 * which is how a real open source project produced an internal error instead of a report.
 */
describe('a relation whose endpoint was never added', () => {
  const provenance = {
    orchescopeVersion: '0.1.0',
    scanId: 'scan_0000000000000001',
    projectId: 'prj_0000000000000001',
    projectName: 'fixture',
    generatedAt: '2026-07-25T00:00:00.000Z',
    projectPathHash: 'a'.repeat(64) as never,
  };
  const coverage = {
    filesDiscovered: 1,
    filesParsed: 1,
    bytesParsed: 10,
    skipped: [],
    languages: [],
    adapters: [],
    unsupported: [],
    durationMs: 1,
    truncated: false,
  };

  const built = () => {
    const builder = new SystemGraphBuilder();
    const present = componentDraft({ kind: 'agent', name: 'triage', file: 'src/main.ts' });
    const absent = componentDraft({ kind: 'tool', name: 'ghost', file: 'src/main.ts' });
    builder.addComponent(present);
    builder.addEdge(edgeDraft('calls_tool', present, absent));
    return builder.build({ provenance, coverage });
  };

  it('is discarded rather than ending the scan', () => {
    const result = built();
    assert.equal(result.graph.components.length, 1);
    assert.equal(result.graph.edges.length, 0, 'an unbuildable relation must not reach the graph');
  });

  it('is reported with the adapter that produced it, so the defect is not silent', () => {
    const result = built();
    assert.equal(result.discardedEdges.length, 1);
    assert.equal(result.discardedEdges[0]?.kind, 'calls_tool');
    assert.ok(
      (result.discardedEdges[0]?.discoveredBy ?? []).length > 0,
      'a discarded relation has to name who reported it',
    );
  });

  it('reports nothing when every endpoint exists', () => {
    const builder = new SystemGraphBuilder();
    const agent = componentDraft({ kind: 'agent', name: 'triage', file: 'src/main.ts' });
    const tool = componentDraft({ kind: 'tool', name: 'refund', file: 'src/main.ts' });
    builder.addComponent(agent);
    builder.addComponent(tool);
    builder.addEdge(edgeDraft('calls_tool', agent, tool));
    const result = builder.build({ provenance, coverage });
    assert.deepEqual(result.discardedEdges, []);
    assert.equal(result.graph.edges.length, 1);
  });
});

describe('how a join was made', () => {
  /**
   * A join by name is correct whenever a name means one thing in a repository, and wrong when two modules use the
   * same word. The first join on third party code hit exactly that: a model observed as `test` met a declaration in
   * an unrelated test file. Nothing can decide from a span which module was meant, so the delta reports which joins
   * rest on a name alone rather than presenting every join as equally established.
   */
  const model = componentDraft({ kind: 'model', name: 'test', file: 'tests/fixtures/models.py' });
  const agent = componentDraft({ kind: 'agent', name: 'support_agent', file: 'src/support.py' });

  it('says which components were joined on a name alone', () => {
    const graph = buildGraph([model, agent]);
    const reconciled = reconcile(graph, [
      runtimeTopology({
        components: [observedComponent({ kind: 'model', observedName: 'test' })],
      }),
    ]);
    const result = computeDelta({
      graph: reconciled.graph,
      runs: [],
      spanToComponent: new Map(),
      matches: reconciled.matches,
      ambiguous: reconciled.ambiguous,
    });
    assert.equal(result.delta.joins.byKindAndName, 1);
    assert.deepEqual(result.delta.joins.onNameAlone, ['model:test']);
    assert.equal(result.delta.joins.byCodeLocation, 0);
  });

  it('reports an observed name that matched more than one declaration and joined none', () => {
    const graph = buildGraph([
      componentDraft({ kind: 'tool', name: 'search', file: 'src/a.ts' }),
      componentDraft({ kind: 'tool', name: 'search', file: 'src/b.ts' }),
    ]);
    const reconciled = reconcile(graph, [
      runtimeTopology({
        components: [observedComponent({ kind: 'tool', observedName: 'search' })],
      }),
    ]);
    const result = computeDelta({
      graph: reconciled.graph,
      runs: [],
      spanToComponent: new Map(),
      matches: reconciled.matches,
      ambiguous: reconciled.ambiguous,
    });
    assert.deepEqual(result.delta.joins.ambiguous, ['search']);
    assert.deepEqual(result.delta.joins.onNameAlone, []);
  });

  it('reports no joins at all when nothing was reconciled', () => {
    const result = computeDelta({
      graph: buildGraph([agent]),
      runs: [],
      spanToComponent: new Map(),
    });
    assert.deepEqual(result.delta.joins, {
      byCodeLocation: 0,
      byRuntimeName: 0,
      byKindAndName: 0,
      onNameAlone: [],
      ambiguous: [],
    });
  });

  it('carries the exact missing span attribute into coverage', () => {
    const graph = buildGraph([agent]);
    const reconciled = reconcile(graph, [
      runtimeTopology({
        coverage: {
          missingSpanAttributes: [
            {
              attribute: 'code.file.path',
              purpose: 'code_location',
              observedComponents: 1,
            },
          ],
        },
      }),
    ]);
    const result = computeDelta({
      graph: reconciled.graph,
      runs: [],
      spanToComponent: new Map(),
      missingSpanAttributes: reconciled.missingSpanAttributes,
    });
    assert.deepEqual(result.delta.coverage.missingSpanAttributes, [
      {
        attribute: 'code.file.path',
        purpose: 'code_location',
        observedComponents: 1,
      },
    ]);
  });
});

describe('an observed relation that a declaration can exactly rederive', () => {
  const worker = componentDraft({ kind: 'agent', name: 'worker', file: 'src/worker.ts' });
  const declared = buildGraph(
    [orchestrator, worker],
    [edgeDraft('hands_off_to', orchestrator, worker)],
  );
  const components = [
    observedComponent({ kind: 'agent', observedName: 'orchestrator' }),
    observedComponent({ kind: 'agent', observedName: 'worker' }),
  ];

  it('does not count an endpoint attribute as runtime evidence for the declared relation', () => {
    const reconciled = reconcile(declared, [
      runtimeTopology({
        components,
        edges: [
          observedEdge({
            kind: 'hands_off_to',
            fromKind: 'agent',
            fromObservedName: 'orchestrator',
            toKind: 'agent',
            toObservedName: 'worker',
            provenance: {
              relation: { attributes: ['graph.node.parent_id'], spanFields: [] },
              from: { attributes: ['graph.node.parent_id'], spanFields: [] },
              to: { attributes: ['graph.node.id'], spanFields: [] },
            },
          }),
        ],
      }),
    ]);
    assert.equal(reconciled.graph.edges[0]?.observation, undefined);
  });

  it('keeps the same declared relation when span nesting is what reported it', () => {
    const reconciled = reconcile(declared, [
      runtimeTopology({
        components,
        edges: [
          observedEdge({
            kind: 'hands_off_to',
            fromKind: 'agent',
            fromObservedName: 'orchestrator',
            toKind: 'agent',
            toObservedName: 'worker',
          }),
        ],
      }),
    ]);
    assert.equal(reconciled.graph.edges[0]?.observation?.executionCount, 1);
  });
});
