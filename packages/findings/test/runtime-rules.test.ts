import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexGraph } from '@orchescope/graph';
import type { ComponentDraft } from '@orchescope/graph';
import type { ReconciliationDelta, RunRecord } from '@orchescope/schema';
import { buildGraph, componentDraft } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import { fired, type Rule, type RuleContext } from '../src/rule.ts';
import { broadPermissionRule } from '../src/rules/static-policy.ts';
import {
  latencyConcentrationRule,
  observabilityCoverageRule,
  repeatedContextRule,
  sequentialIndependentCallsRule,
  tokenConcentrationRule,
  unreliableRelationRule,
} from '../src/rules/runtime.ts';

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
  observedRuns: withRun ? [runStub] : [],
  silentRuns: [],
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

  /*
   * It fired at medium in twenty three of twenty three repositories that had a component, which is a
   * finding carrying no information: it says the operator has not run the next step yet, and the loop
   * already says that and routes to it. Ranked beside a duplicated refund it teaches a reader to skim.
   */
  it('states an unrun system at the weight of a note, not of a defect', () => {
    const outcome = observabilityCoverageRule.evaluate(contextFor(undefined, false));
    assert.equal(outcome.drafts[0]?.severity, 'info');
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
        observedRuns: [runStub],
        silentRuns: [],
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
        observedRuns: [runStub],
        silentRuns: [],
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

  /*
   * The sentence a reader who has just traced their system needs. "No runtime evidence has been
   * collected" is true and reads as though nothing was tried; "0 percent of declared components were
   * exercised" is a measurement nobody took. The run happened, the instrumentation did not, and only
   * the second half is the reader's next problem.
   */
  it('names the empty run rather than reporting an exercise rate of zero', () => {
    const outcome = observabilityCoverageRule.evaluate({
      ...contextFor(undefined, false),
      silentRuns: [{ id: 'run_0000000000000001' } as RunRecord],
    });
    assert.equal(outcome.status, 'fired');
    const draft = outcome.drafts[0];
    assert.match(draft?.title ?? '', /1 run was recorded and produced no spans/);
    assert.equal(draft?.basis, 'discovered');
    assert.match(draft?.explanation ?? '', /unmeasured rather than zero/);
    assert.match(draft?.recommendation?.summary ?? '', /exported no telemetry/);
    /*
     * A run that was attempted and produced nothing is a fact about this repository with a remediation,
     * which is what separates it from a system nobody has run yet.
     */
    assert.equal(draft?.severity, 'medium');
  });
});

/**
 * The backstop, one layer below any rule.
 *
 * `observed` is the only basis that means a machine watched it happen, and the audit that started this
 * work minted one at 0.98 confidence from a run holding no span. Rules are where the mistake gets made
 * and the engine is where it can be caught for every rule at once, including rules written later.
 */
describe('a draft that claims an observed basis with nothing observed', () => {
  const claimsObservation: Rule = {
    id: 'fixture-claims-observation',
    category: 'observability',
    summary: 'A rule that reaches for observed without checking whether anything was observed.',
    evaluate: (context) =>
      fired([
        {
          ruleId: 'fixture-claims-observation',
          situation: 'fixture-observation',
          category: 'observability',
          polarity: 'risk',
          severity: 'medium',
          confidence: 0.98,
          basis: 'observed',
          title: 'Only 0 percent of declared components were exercised',
          explanation: 'fixture',
          impact: 'fixture',
          components: context.graph.graph.components.slice(0, 1).map((component) => component.id),
          evidence: context.graph.graph.components[0]?.evidence.slice(0, 1) ?? [],
          goalEligible: false,
          goalReason: 'fixture',
        },
      ]),
  };

  const evaluate = (observed: boolean) =>
    evaluateRules({
      scanId: 'scan_0000000000000000',
      generatedAt: '2026-01-01T00:00:00.000Z',
      graph: indexed(),
      context: {
        delta: undefined,
        observedRuns: observed ? [runStub] : [],
        silentRuns: observed ? [] : [{ id: 'run_0000000000000001' } as RunRecord],
        benchmarks: [],
        chaosReports: [],
        scenarios: [],
        evidenceById: new Map(),
      },
      rules: [claimsObservation],
    });

  it('is dropped, and the drop is recorded rather than swallowed', () => {
    const result = evaluate(false);
    assert.deepEqual(result.findingSet.findings, []);
    assert.ok(
      result.findingSet.rulesEvaluated.some(
        (rule) =>
          rule.ruleId === 'fixture-claims-observation' &&
          rule.status === 'insufficient_evidence' &&
          /no run produced a span to observe/.test(rule.detail ?? ''),
      ),
      'the drop has to be recorded, not swallowed',
    );
  });

  it('survives untouched once a run produced a span', () => {
    const result = evaluate(true);
    assert.equal(result.findingSet.findings.length, 1);
    assert.equal(result.findingSet.findings[0]?.basis, 'observed');
  });
});

/**
 * A rule that needs measurement, in a document that says a run was recorded.
 *
 * Six rules printed "no run has been recorded" beside a summary saying `runCount: 1`. The sentence
 * contradicts the page it is on, and it routes an operator to `orchescope trace` when the run already
 * landed and the instrumentation did not. Those are different next actions.
 */
describe('a rule with nothing measured to read', () => {
  const silent: RunRecord = { id: 'run_0000000000000002' } as RunRecord;

  const contextWith = (silentRuns: readonly RunRecord[]): RuleContext => ({
    graph: indexed(),
    delta: undefined,
    observedRuns: [],
    silentRuns,
    benchmarks: [],
    chaosReports: [],
    scenarios: [],
    evidenceById: new Map(),
  });

  const rules = [
    sequentialIndependentCallsRule,
    latencyConcentrationRule,
    tokenConcentrationRule,
    repeatedContextRule,
    unreliableRelationRule,
    broadPermissionRule,
  ];

  it('says no run has been recorded only when none has', () => {
    for (const rule of rules) {
      const outcome = rule.evaluate(contextWith([]));
      assert.equal(outcome.status, 'insufficient_evidence', rule.id);
      assert.match(outcome.detail ?? '', /^no run has been recorded, so /, rule.id);
    }
  });

  it('says the run produced no span when one was recorded and measured nothing', () => {
    for (const rule of rules) {
      const outcome = rule.evaluate(contextWith([silent]));
      assert.equal(outcome.status, 'insufficient_evidence', rule.id);
      assert.match(outcome.detail ?? '', /1 run produced no span/, rule.id);
      assert.doesNotMatch(
        outcome.detail ?? '',
        /no run has been recorded/,
        `${rule.id} contradicted a document that records one run`,
      );
    }
  });

  it('names what each of them could not establish, rather than only that it could not', () => {
    const subjects = rules.map((rule) => rule.evaluate(contextWith([])).detail ?? '');
    assert.equal(new Set(subjects).size, rules.length, 'two rules gave the same reason');
  });
});
