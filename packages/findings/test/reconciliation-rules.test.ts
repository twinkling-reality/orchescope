import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIDENCE_BANDS, derivedEvidence, sourceSpanEvidence } from '@orchescope/domain';
import { indexGraph } from '@orchescope/graph';
import type { Contradiction, ReconciliationDelta, RunRecord } from '@orchescope/schema';
import { buildGraph, componentDraft } from '@orchescope/testkit';
import type { RuleContext } from '../src/rule.ts';
import {
  contradictedDeclarationRule,
  declaredNotExercisedRule,
  exercisedNotDeclaredRule,
  unnamedObservationRule,
} from '../src/rules/reconciliation.ts';

/**
 * The join is by name, so a name that identifies nothing is where the join stops.
 *
 * Pointing the delta at a third party repository for the first time produced exactly this: a Pydantic AI example
 * declares `support_agent` and the instrumentation reported the run as `agent`, so the declaration stayed
 * unexercised and an undeclared component appeared beside it. Neither of those is what happened.
 */

const declared = componentDraft({ kind: 'agent', name: 'support_agent', file: 'src/support.py' });
const anonymous = componentDraft({ kind: 'agent', name: 'agent', file: 'src/support.py' });
const named = componentDraft({ kind: 'agent', name: 'planner', file: 'src/planner.py' });

const deltaWith = (observed: readonly string[]): ReconciliationDelta => ({
  declaredNotExercised: { components: ['agent:support_agent'], edges: [], runIds: ['run_1'] },
  exercisedNotDeclared: {
    components: [...observed] as ReconciliationDelta['exercisedNotDeclared']['components'],
    edges: [],
  },
  contradictions: [],
  duplicateSideEffects: [],
  joins: { byCodeLocation: 0, byRuntimeName: 0, byKindAndName: 0, onNameAlone: [], ambiguous: [] },
  coverage: {
    declaredComponents: 1,
    exercisedComponents: observed.length,
    declaredEdges: 0,
    exercisedEdges: 0,
  },
});

const contextFor = (observed: readonly string[]): RuleContext => ({
  graph: indexGraph(buildGraph([declared, anonymous, named], [])),
  delta: deltaWith(observed),
  observedRuns: [],
  silentRuns: [],
  benchmarks: [],
  chaosReports: [],
  scenarios: [],
  evidenceById: new Map(),
});

describe('observed-name-carries-no-identity', () => {
  it('fires when the instrumentation reported a component under the word for its kind', () => {
    const outcome = unnamedObservationRule.evaluate(contextFor(['agent:agent']));
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
    const draft = outcome.drafts[0];
    assert.equal(draft?.category, 'observability');
    assert.equal(draft?.basis, 'observed');
    assert.equal(
      draft?.goalEligible,
      true,
      'naming a component at its definition is a bounded edit',
    );
    assert.match(draft?.title ?? '', /only its kind/);
  });

  it('stays quiet when the observed name identifies something', () => {
    const outcome = unnamedObservationRule.evaluate(contextFor(['agent:planner']));
    assert.equal(outcome.status, 'clear');
    assert.deepEqual(outcome.drafts, []);
  });

  it('reports nothing at all before a run has been reconciled', () => {
    const outcome = unnamedObservationRule.evaluate({
      ...contextFor([]),
      delta: undefined,
    });
    assert.equal(outcome.status, 'insufficient_evidence');
  });
});

/**
 * The rule that turned a silent run into six confident falsehoods.
 *
 * A traced integration suite on an uninstrumented target returned no span. The delta built from it marked
 * every declared component unexercised, and this rule reported each one as never having run, against a suite
 * whose source shows three of the tools executing repeatedly. The declaration side of the join was read
 * correctly and the observation side was empty, which is not the same as a run in which nothing happened.
 */
describe('declared-not-exercised', () => {
  const withNothingExercised = (): RuleContext => ({
    ...contextFor([]),
    delta: {
      ...deltaWith([]),
      declaredNotExercised: {
        components: ['agent:support_agent', 'agent:planner'],
        edges: [],
        runIds: ['run_0000000000000001'],
      },
    },
  });

  it('says nothing when a run was recorded and produced no span', () => {
    const outcome = declaredNotExercisedRule.evaluate({
      ...withNothingExercised(),
      silentRuns: [{ id: 'run_0000000000000001' } as RunRecord],
    });
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.deepEqual(outcome.drafts, []);
    assert.match(outcome.detail ?? '', /produced no span/);
  });

  it('still fires once a run produced something to be absent from', () => {
    const outcome = declaredNotExercisedRule.evaluate({
      ...withNothingExercised(),
      observedRuns: [{ run: { id: 'run_0000000000000001' } as RunRecord, componentMetrics: [] }],
    });
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 2);
    assert.equal(outcome.drafts[0]?.basis, 'inferred');
  });
});

describe('exercised-not-declared', () => {
  /**
   * The component was not undeclared. It arrived without a name that could match anything, and claiming the
   * repository never declared it would be an inference the evidence does not support.
   */
  it('does not call a component undeclared when its observed name is only its kind', () => {
    const outcome = exercisedNotDeclaredRule.evaluate(contextFor(['agent:agent']));
    assert.deepEqual(outcome.drafts, []);
    assert.match(outcome.detail ?? '', /observed-name-carries-no-identity/);
  });

  it('still fires for a component that arrived with a name of its own', () => {
    const outcome = exercisedNotDeclaredRule.evaluate(contextFor(['agent:planner']));
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
    assert.match(outcome.drafts[0]?.title ?? '', /^planner runs without being declared/);
  });
});

/**
 * A declaration the run disagreed with.
 *
 * A tool annotation is self declared and the Model Context Protocol requires a client to treat it as untrusted, so
 * the rule reports the disagreement rather than deciding which side is right. The split between the two shapes is
 * the point: an annotation a caller trusts before it retries is a security question, while a configured limit that
 * did not hold at runtime is a reliability one, and the two do not deserve the same severity.
 */
describe('declaration-contradicted-by-observation', () => {
  const refund = componentDraft({
    kind: 'tool',
    name: 'issue_refund',
    file: 'src/tools.py',
    details: { for: 'tool', readOnlyHint: true },
  });
  const discovery = sourceSpanEvidence({
    producer: 'fixture',
    location: { file: 'src/tools.py', startLine: 1 },
    symbol: 'issue_refund',
  });
  const contradictionEvidence = (rule: string): string =>
    derivedEvidence({ producer: 'delta', rule, inputs: [discovery.id] }).id;

  const annotation: Contradiction = {
    componentId: 'tool:issue_refund',
    kind: 'read_only_hint',
    declared: 'readOnlyHint: true',
    observed: 'performed a side effect',
    evidence: [contradictionEvidence('contradiction:read_only_hint')],
  };
  const limit: Contradiction = {
    componentId: 'tool:issue_refund',
    kind: 'timeout',
    declared: 'timeout 200 ms',
    observed: 'longest observed call 900 ms',
    evidence: [contradictionEvidence('contradiction:timeout')],
  };

  const contradictedContext = (contradictions: readonly Contradiction[]): RuleContext => ({
    ...contextFor([]),
    graph: indexGraph(buildGraph([declared, anonymous, named, refund], [])),
    delta: { ...deltaWith([]), contradictions: [...contradictions] },
  });

  it('fires on an annotation the run contradicted, and reports it as a security finding', () => {
    const outcome = contradictedDeclarationRule.evaluate(contradictedContext([annotation]));
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
    const draft = outcome.drafts[0];
    assert.equal(draft?.category, 'security');
    assert.equal(draft?.severity, 'high');
    assert.equal(draft?.basis, 'observed');
    assert.equal(draft?.confidence, CONFIDENCE_BANDS.deterministic);
    assert.deepEqual(draft?.components, ['tool:issue_refund']);
    assert.deepEqual(draft?.evidence, annotation.evidence, 'the finding cites the delta evidence');
    assert.deepEqual(draft?.taxonomy, ['owasp-asi:ASI05']);
    assert.equal(
      draft?.requiresHumanReview,
      true,
      'only a human can decide whether the annotation or the behaviour is wrong',
    );
    assert.equal(draft?.title, 'issue_refund declares readOnlyHint: true and behaves otherwise');
    assert.ok(draft?.tags?.includes('read_only_hint'));
  });

  /*
   * The one kind of contradiction no run is needed to notice. Both halves of it are read out of source,
   * so it has to say discovered: a reader who sees observed will go looking for the run that produced it
   * and there is none. The severity is unaffected, which is the point: the word is not load bearing for
   * how bad this is, only for what would have to be true for it to be right.
   */
  it('calls a contradiction that source alone produced discovered, not observed', () => {
    const fromSource: Contradiction = {
      componentId: 'tool:issue_refund',
      kind: 'destructive_hint',
      declared: 'readOnlyHint: true',
      observed: 'discovered effect class non_idempotent_write',
      evidence: [contradictionEvidence('contradiction:destructive_hint')],
    };
    const outcome = contradictedDeclarationRule.evaluate(contradictedContext([fromSource]));
    assert.equal(outcome.status, 'fired');
    const draft = outcome.drafts[0];
    assert.equal(draft?.basis, 'discovered');
    assert.equal(draft?.category, 'security', 'it is still an annotation a caller would trust');
    assert.equal(draft?.severity, 'high', 'discovered carries the same ceiling as observed');
    assert.match(draft?.explanation ?? '', /The code says/);
    assert.ok(
      !(draft?.explanation ?? '').includes('The observation says'),
      'nothing observed this, so the explanation must not claim an observation',
    );
  });

  /* A configured limit that did not hold is a reliability defect, not a claim anyone was invited to trust. */
  it('reports a contradicted policy limit as reliability at a lower severity', () => {
    const outcome = contradictedDeclarationRule.evaluate(contradictedContext([limit]));
    assert.equal(outcome.status, 'fired');
    const draft = outcome.drafts[0];
    assert.equal(draft?.category, 'reliability');
    assert.equal(draft?.severity, 'medium');
    assert.deepEqual(draft?.taxonomy, []);
    assert.equal(draft?.requiresHumanReview, false);
    assert.match(draft?.explanation ?? '', /longest observed call 900 ms/);
  });

  it('reports one draft per contradiction and groups them under one occurrence', () => {
    const outcome = contradictedDeclarationRule.evaluate(contradictedContext([annotation, limit]));
    assert.equal(outcome.drafts.length, 2);
    assert.deepEqual(
      outcome.drafts.map((draft) => draft.occurrence?.key),
      ['contradiction', 'contradiction'],
    );
  });

  it('stays quiet when no declaration was contradicted', () => {
    const outcome = contradictedDeclarationRule.evaluate(contradictedContext([]));
    assert.equal(outcome.status, 'clear');
    assert.deepEqual(outcome.drafts, []);
  });

  it('reports nothing at all before a run has been reconciled', () => {
    const outcome = contradictedDeclarationRule.evaluate({
      ...contradictedContext([]),
      delta: undefined,
    });
    assert.equal(outcome.status, 'insufficient_evidence');
  });
});
