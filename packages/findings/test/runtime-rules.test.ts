import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexGraph } from '@orchescope/graph';
import type { ComponentDraft } from '@orchescope/graph';
import type { ReconciliationDelta, RunRecord } from '@orchescope/schema';
import { buildGraph, componentDraft } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import type { RuleContext } from '../src/rule.ts';
import { observabilityCoverageRule } from '../src/rules/runtime.ts';

/**
 * Coverage claims must carry evidence or refuse honestly.
 *
 * The rate branches used to fire with `evidence: []`, after which the engine dropped the draft and
 * recorded a post-hoc insufficient_evidence. That is a silent miss of a real claim. These tests lock
 * the rule to mint metric evidence and name at least one component whenever it fires a rate claim.
 */

const withPresence = (
  draft: ComponentDraft,
  presence: { readonly static: boolean; readonly runtime: boolean; readonly manifest: boolean },
): ComponentDraft => ({ ...draft, presence });

const planner = withPresence(
  componentDraft({ kind: 'agent', name: 'planner', file: 'src/planner.py' }),
  { static: true, runtime: true, manifest: false },
);
const lookup = withPresence(
  componentDraft({ kind: 'tool', name: 'lookup', file: 'src/lookup.py' }),
  { static: true, runtime: false, manifest: false },
);

const runStub = {
  run: { id: 'run_0000000000000001' } as RunRecord,
  componentMetrics: [],
};

const deltaOf = (input: {
  readonly declared: number;
  readonly exercised: number;
  readonly notExercised: readonly string[];
  readonly rate?: number;
}): ReconciliationDelta => ({
  declaredNotExercised: {
    components: [
      ...input.notExercised,
    ] as ReconciliationDelta['declaredNotExercised']['components'],
    edges: [],
    runIds: ['run_0000000000000001'],
  },
  exercisedNotDeclared: { components: [], edges: [] },
  contradictions: [],
  duplicateSideEffects: [],
  joins: { byCodeLocation: 0, byRuntimeName: 0, byKindAndName: 0, onNameAlone: [], ambiguous: [] },
  coverage: {
    declaredComponents: input.declared,
    exercisedComponents: input.exercised,
    declaredEdges: 0,
    exercisedEdges: 0,
    ...(input.rate === undefined ? {} : { componentExerciseRate: input.rate }),
  },
});

const indexed = () => indexGraph(buildGraph([planner, lookup], []));

const contextFor = (delta: ReconciliationDelta | undefined, withRun: boolean): RuleContext => ({
  graph: indexed(),
  delta,
  runs: withRun ? [runStub] : [],
  benchmarks: [],
  chaosReports: [],
  scenarios: [],
  evidenceById: new Map(),
});

describe('observability-coverage', () => {
  it('fires with discovery evidence when no run has been recorded', () => {
    const outcome = observabilityCoverageRule.evaluate(contextFor(undefined, false));
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
    const draft = outcome.drafts[0];
    assert.ok((draft?.evidence.length ?? 0) > 0);
    assert.ok((draft?.components.length ?? 0) > 0);
  });

  it('reports insufficient evidence when a rate cannot be computed', () => {
    const outcome = observabilityCoverageRule.evaluate(
      contextFor(deltaOf({ declared: 0, exercised: 0, notExercised: [] }), true),
    );
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.deepEqual(outcome.drafts, []);
  });

  it('fires a strength that survives the engine when most declared components were exercised', () => {
    const graph = indexed();
    const result = evaluateRules({
      scanId: 'scan_0000000000000000',
      generatedAt: '2026-01-01T00:00:00.000Z',
      graph,
      context: {
        delta: deltaOf({ declared: 5, exercised: 5, notExercised: [], rate: 1 }),
        runs: [runStub],
        benchmarks: [],
        chaosReports: [],
        scenarios: [],
        evidenceById: new Map(),
      },
      rules: [observabilityCoverageRule],
    });
    const finding = result.findingSet.findings.find(
      (entry) => entry.ruleId === 'observability-coverage',
    );
    assert.ok(finding !== undefined, 'strength must survive evaluateRules');
    assert.equal(finding.polarity, 'strength');
    assert.ok(finding.evidence.length > 0);
    assert.ok(finding.components.length > 0);
    assert.equal(
      result.findingSet.rulesEvaluated.some(
        (rule) =>
          rule.ruleId === 'observability-coverage' &&
          rule.status === 'insufficient_evidence' &&
          (rule.detail ?? '').includes('dropped because it carried no evidence'),
      ),
      false,
    );
  });

  it('fires a risk that survives the engine when most declared components were not exercised', () => {
    const graph = indexed();
    const unexercisedId = graph.graph.components.find(
      (component) => !component.presence.runtime,
    )?.id;
    assert.ok(unexercisedId !== undefined);
    const result = evaluateRules({
      scanId: 'scan_0000000000000000',
      generatedAt: '2026-01-01T00:00:00.000Z',
      graph,
      context: {
        delta: deltaOf({
          declared: 5,
          exercised: 1,
          notExercised: [unexercisedId],
          rate: 0.2,
        }),
        runs: [runStub],
        benchmarks: [],
        chaosReports: [],
        scenarios: [],
        evidenceById: new Map(),
      },
      rules: [observabilityCoverageRule],
    });
    const finding = result.findingSet.findings.find(
      (entry) => entry.ruleId === 'observability-coverage',
    );
    assert.ok(finding !== undefined, 'risk must survive evaluateRules');
    assert.equal(finding.polarity, 'risk');
    assert.ok(finding.evidence.length > 0);
    assert.ok(finding.components.includes(unexercisedId));
  });
});
