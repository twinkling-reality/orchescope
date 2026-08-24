import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EdgeDraft } from '@orchescope/graph';
import { indexGraph } from '@orchescope/graph';
import type { SystemGraph } from '@orchescope/schema';
import { buildGraph, componentDraft, edgeDraft, TEST_TIMESTAMP } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import type { RuleContext } from '../src/rule.ts';
import { architectureShapeRule } from '../src/rules/static-policy.ts';

const agent = componentDraft({ kind: 'agent', name: 'agent', file: 'src/graph.py' });
const worker = componentDraft({ kind: 'agent', name: 'worker', file: 'src/graph.py', line: 2 });
const finish = componentDraft({ kind: 'agent', name: 'finish', file: 'src/graph.py', line: 3 });

const withTopology = (
  graph: SystemGraph,
  status: 'complete' | 'incomplete',
  unresolvedCount = status === 'complete' ? 0 : 1,
): SystemGraph => ({
  ...graph,
  coverage: {
    ...graph.coverage,
    topology: {
      status,
      producers: [
        {
          adapterId: 'adapter:fixture',
          status,
          inspectedInputs: 7,
          relationsFound: graph.edges.length,
        },
      ],
      inspectedInputs: 7,
      explicitRelations: graph.edges.length,
      conditionalConstructs: 1,
      conditionalDestinations: 2,
      entryBoundaries: 1,
      entryTargets: [agent.identity],
      terminalBoundaries: 1,
      boundaryFacts: [
        { kind: 'entry', location: { file: 'src/graph.py', startLine: 10 } },
        { kind: 'terminal', location: { file: 'src/graph.py', startLine: 20 } },
      ],
      configurationBounds: 0,
      configurationBoundFacts: [],
      unresolvedCount,
      unresolved:
        unresolvedCount === 0
          ? []
          : [
              {
                kind: 'conditional_destination',
                reason: 'router destination is dynamic',
                location: { file: 'src/graph.py', startLine: 15 },
              },
            ],
    },
  },
});

const contextFor = (graph: SystemGraph): RuleContext => ({
  graph: indexGraph(graph),
  delta: undefined,
  observedRuns: [],
  silentRuns: [],
  benchmarks: [],
  chaosReports: [],
  scenarios: [],
  evidenceById: new Map(),
});

describe('topology evidence completeness', () => {
  it('suppresses reachability and topology strengths when a conditional destination is unresolved', () => {
    const stranded = componentDraft({ kind: 'tool', name: 'stranded', file: 'src/tools.py' });
    const graph = withTopology(
      buildGraph([agent, worker, stranded], [edgeDraft('hands_off_to', agent, worker)]),
      'incomplete',
    );
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.equal(
      outcome.drafts.some((draft) => draft.tags?.includes('unreachable')),
      false,
    );
    assert.equal(
      outcome.drafts.some((draft) => draft.polarity === 'strength'),
      false,
    );
  });

  it('reports a complete acyclic graph with its inspected population and evidence', () => {
    const graph = withTopology(
      buildGraph([agent, worker], [edgeDraft('hands_off_to', agent, worker)]),
      'complete',
    );
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    const strength = outcome.drafts.find((draft) => draft.polarity === 'strength');
    assert.ok(strength);
    assert.equal(
      strength.metrics?.find((metric) => metric.name === 'topologyInputsInspected')?.sampleSize,
      7,
    );
    assert.equal(strength.newEvidence?.[0]?.kind, 'absence');
    assert.match(strength.explanation, /7 inspected topology inputs/);
  });

  it('does not let adapter completeness override a partial scan population', () => {
    const complete = withTopology(
      buildGraph([agent, worker], [edgeDraft('hands_off_to', agent, worker)]),
      'complete',
    );
    const partial: SystemGraph = {
      ...complete,
      coverage: { ...complete.coverage, truncated: true },
    };
    const outcome = architectureShapeRule.evaluate(contextFor(partial));
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.equal(
      outcome.drafts.some((draft) => draft.polarity === 'strength'),
      false,
    );
  });

  it('keeps prompt-use refusals visible without changing complete control-flow properties', () => {
    const complete = withTopology(
      buildGraph([agent, worker], [edgeDraft('hands_off_to', agent, worker)]),
      'complete',
    );
    const topology = complete.coverage.topology;
    assert.ok(topology);
    const graph: SystemGraph = {
      ...complete,
      coverage: {
        ...complete.coverage,
        topology: {
          ...topology,
          status: 'incomplete',
          producers: [
            ...topology.producers,
            {
              adapterId: 'adapter:prompts',
              scope: 'prompt_use',
              status: 'incomplete',
              inspectedInputs: 1,
              relationsFound: 0,
            },
          ],
          inspectedInputs: topology.inspectedInputs + 1,
          unresolvedCount: 11,
          controlFlowUnresolvedCount: 0,
          promptUseUnresolvedCount: 11,
          unresolved: [
            {
              kind: 'prompt_input',
              scope: 'prompt_use',
              reason: 'system_prompt is computed',
              location: { file: 'src/agent.py', startLine: 8 },
            },
          ],
        },
      },
    };
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    const strength = outcome.drafts.find((draft) => draft.polarity === 'strength');
    assert.ok(strength);
    assert.equal(
      strength.metrics?.find((metric) => metric.name === 'topologyInputsInspected')?.sampleSize,
      7,
    );
  });

  it('refuses contradictory scoped counts when the sample contains a control-flow gap', () => {
    const complete = withTopology(
      buildGraph([agent, worker], [edgeDraft('hands_off_to', agent, worker)]),
      'complete',
    );
    const topology = complete.coverage.topology;
    assert.ok(topology);
    const graph: SystemGraph = {
      ...complete,
      coverage: {
        ...complete.coverage,
        topology: {
          ...topology,
          status: 'incomplete',
          controlFlowUnresolvedCount: 0,
          promptUseUnresolvedCount: 1,
          unresolvedCount: 1,
          unresolved: [
            {
              kind: 'conditional_destination',
              reason: 'the bounded sample contradicts the claimed prompt-only population',
              location: { file: 'src/graph.py', startLine: 15 },
            },
          ],
        },
      },
    };
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.equal(
      outcome.drafts.some((draft) => draft.polarity === 'strength'),
      false,
    );
  });

  it('never falls back to legacy sampling when scoped counts are missing or mismatched', () => {
    const complete = withTopology(
      buildGraph([agent, worker], [edgeDraft('hands_off_to', agent, worker)]),
      'complete',
    );
    const topology = complete.coverage.topology;
    assert.ok(topology);
    const promptSample = [
      {
        kind: 'prompt_input' as const,
        scope: 'prompt_use' as const,
        reason: 'the sample alone cannot repair invalid full-population counts',
        location: { file: 'src/agent.py', startLine: 8 },
      },
    ];
    for (const counts of [
      { controlFlowUnresolvedCount: 0 },
      { promptUseUnresolvedCount: 1 },
      { controlFlowUnresolvedCount: 0, promptUseUnresolvedCount: 2 },
      { controlFlowUnresolvedCount: 1, promptUseUnresolvedCount: 1 },
    ]) {
      const graph: SystemGraph = {
        ...complete,
        coverage: {
          ...complete.coverage,
          topology: {
            ...topology,
            status: 'incomplete',
            unresolvedCount: 1,
            unresolved: promptSample,
            ...counts,
          },
        },
      };
      const outcome = architectureShapeRule.evaluate(contextFor(graph));
      assert.equal(outcome.status, 'insufficient_evidence');
      assert.equal(
        outcome.drafts.some((draft) => draft.polarity === 'strength'),
        false,
      );
    }
  });

  it('treats a legacy unscoped refusal as incomplete control flow', () => {
    const complete = withTopology(
      buildGraph([agent, worker], [edgeDraft('hands_off_to', agent, worker)]),
      'complete',
    );
    const topology = complete.coverage.topology;
    assert.ok(topology);
    const graph: SystemGraph = {
      ...complete,
      coverage: {
        ...complete.coverage,
        topology: {
          ...topology,
          status: 'incomplete',
          unresolvedCount: 1,
          unresolved: [
            {
              kind: 'conditional_destination',
              reason: 'legacy router destination is dynamic',
              location: { file: 'src/graph.py', startLine: 15 },
            },
          ],
        },
      },
    };
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.equal(
      outcome.drafts.some((draft) => draft.polarity === 'strength'),
      false,
    );
  });

  it('starts reachability at handled entry targets rather than promoting a disconnected cycle', () => {
    const second = componentDraft({ kind: 'agent', name: 'second', file: 'src/graph.py', line: 4 });
    const third = componentDraft({ kind: 'agent', name: 'third', file: 'src/graph.py', line: 5 });
    const graph = withTopology(
      buildGraph(
        [agent, worker, second, third],
        [
          edgeDraft('hands_off_to', agent, worker),
          edgeDraft('hands_off_to', second, third),
          edgeDraft('hands_off_to', third, second),
        ],
      ),
      'complete',
    );
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    const unreachable = outcome.drafts.filter((draft) => draft.tags?.includes('unreachable'));
    assert.deepEqual(unreachable.map((draft) => draft.components[0]).sort(), [
      'agent:second',
      'agent:third',
    ]);
  });

  it('cites every relation establishing a cycle and states a static configurable default accurately', () => {
    const cycleEdges = [
      edgeDraft('hands_off_to', agent, worker),
      edgeDraft('hands_off_to', worker, finish),
      edgeDraft('hands_off_to', finish, agent, {
        metadata: {
          conditional: true,
          conditionalBoundName: 'max_loops',
          conditionalBoundDefault: 3,
          conditionalBoundOperator: '<=',
        },
      } as Partial<EdgeDraft>),
    ];
    const graph = withTopology(buildGraph([agent, worker, finish], cycleEdges), 'complete');
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    const cycle = outcome.drafts.find((draft) => draft.tags?.includes('cycle'));
    assert.ok(cycle);
    assert.equal(cycle.edges?.length, 3);
    assert.deepEqual(
      [...cycle.claimEvidence.conclusion].sort(),
      [...new Set(graph.edges.flatMap((edge) => edge.evidence))].sort(),
    );
    assert.match(cycle.explanation, /static default is 3/);
    assert.match(cycle.explanation, /Runtime configuration can override/);
    assert.doesNotMatch(cycle.explanation, /worth an explicit iteration ceiling/);
  });

  it('states an invocation ceiling without calling it a configuration default', () => {
    const cycleEdges = [
      edgeDraft('hands_off_to', agent, worker),
      edgeDraft('hands_off_to', worker, agent, {
        metadata: {
          conditionalBoundName: 'recursion_limit',
          conditionalBoundDefault: 10,
          conditionalBoundOperator: '<=',
          conditionalBoundKind: 'invocation_ceiling',
        },
      } as Partial<EdgeDraft>),
    ];
    const graph = withTopology(buildGraph([agent, worker], cycleEdges), 'complete');
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    const cycle = outcome.drafts.find((draft) => draft.tags?.includes('cycle'));
    assert.ok(cycle);
    assert.match(cycle.explanation, /declared ceiling for that invocation/);
    assert.doesNotMatch(
      cycle.explanation,
      /static default|no deterministic source-declared ceiling/,
    );
  });

  it('keeps semantic finding identity stable when relation input order changes', () => {
    const edges = [
      edgeDraft('hands_off_to', agent, worker),
      edgeDraft('hands_off_to', worker, finish),
      edgeDraft('hands_off_to', finish, agent),
    ];
    const ids = (ordered: readonly EdgeDraft[]) => {
      const graph = withTopology(buildGraph([finish, agent, worker], ordered), 'complete');
      return evaluateRules({
        scanId: graph.provenance.scanId,
        generatedAt: TEST_TIMESTAMP,
        graph: indexGraph(graph),
        context: {
          delta: undefined,
          observedRuns: [],
          silentRuns: [],
          benchmarks: [],
          chaosReports: [],
          scenarios: [],
          evidenceById: new Map(),
        },
        rules: [architectureShapeRule],
      }).findingSet.findings.map((finding) => finding.id);
    };
    assert.deepEqual(ids(edges), ids([...edges].reverse()));
  });
});
