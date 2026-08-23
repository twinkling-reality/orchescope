import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CONFIDENCE_BANDS,
  derivedEvidence,
  sourceSpanEvidence,
  spanEvidence,
} from '@orchescope/domain';
import { indexGraph } from '@orchescope/graph';
import type { Contradiction, ReconciliationDelta, RunRecord } from '@orchescope/schema';
import { buildGraph, componentDraft } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import type { RuleContext } from '../src/rule.ts';
import {
  ambiguousObservationRule,
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

const exactRuntimeContext = (
  displayName = 'planner',
  attributeValue = displayName,
  includeDerivation = true,
  observedCoordinateName: string | null = displayName,
): RuleContext => {
  const kind = displayName.includes('smollm2') ? ('model' as const) : ('agent' as const);
  const span = spanEvidence({
    producer: 'fixture:trace',
    runId: 'run_0000000000000001',
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    spanName: `invoke ${displayName}`,
    ...(observedCoordinateName === null
      ? {}
      : { observedComponent: { kind, observedName: observedCoordinateName } }),
    attribute: kind === 'model' ? 'llm.model_name' : 'agent.name',
    attributeValue,
  });
  const runtimeOnly = derivedEvidence({
    producer: 'reconciler',
    rule: 'runtime_only_component',
    inputs: [span.id],
  });
  const base = buildGraph([
    declared,
    componentDraft({ kind, name: displayName, file: `runtime/${displayName}.ts` }),
  ]);
  const runtimeId = base.components.find((component) => component.displayName === displayName)?.id;
  const graph = {
    ...base,
    components: base.components.map((component) =>
      component.id !== runtimeId
        ? component
        : {
            ...component,
            presence: { static: false, runtime: true, manifest: false },
            basis: 'observed' as const,
            evidence: [span.id, ...(includeDerivation ? [runtimeOnly.id] : [])],
          },
    ),
  };
  return {
    ...contextFor([]),
    graph: indexGraph(graph),
    delta: deltaWith([runtimeId as string]),
    observedRuns: [
      {
        run: { id: 'run_0000000000000001' } as RunRecord,
        componentMetrics: [],
      },
    ],
    evidenceById: new Map([
      [span.id, span],
      ...(includeDerivation ? ([[runtimeOnly.id, runtimeOnly]] as const) : []),
    ]),
  };
};

/** The same run, with the reconciler having matched some of those names to more than one declaration. */
const contested = (observed: readonly string[], ambiguous: readonly string[]): RuleContext => {
  const context = contextFor(observed);
  return {
    ...context,
    delta: {
      ...deltaWith(observed),
      joins: { ...deltaWith(observed).joins, ambiguous: [...ambiguous] },
    },
  };
};

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
    const context = exactRuntimeContext();
    const outcome = exercisedNotDeclaredRule.evaluate(context);
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
    assert.match(outcome.drafts[0]?.title ?? '', /^planner ran without an exact matching/);
    assert.match(outcome.drafts[0]?.explanation ?? '', /does not establish/);
    assert.equal(outcome.drafts[0]?.newEvidence?.[0]?.kind, 'absence');
    const claimText = [
      outcome.drafts[0]?.title,
      outcome.drafts[0]?.explanation,
      outcome.drafts[0]?.impact,
      outcome.drafts[0]?.recommendation?.summary,
      ...(outcome.drafts[0]?.recommendation?.steps ?? []),
    ]
      .filter((value) => value !== undefined)
      .join(' ');
    assert.doesNotMatch(
      claimText,
      /anywhere|nobody|never declared|path unseen/i,
      'the finding must not expand an exact-match refusal into a repository-wide absence',
    );

    const result = evaluateRules({
      scanId: 'scan_exact_runtime_identity',
      generatedAt: '2026-08-22T12:00:00.000Z',
      graph: context.graph,
      context: {
        delta: context.delta,
        observedRuns: context.observedRuns,
        silentRuns: context.silentRuns,
        benchmarks: context.benchmarks,
        chaosReports: context.chaosReports,
        scenarios: context.scenarios,
        evidenceById: context.evidenceById,
      },
      rules: [exercisedNotDeclaredRule],
    });
    const finding = result.findingSet.findings[0];
    assert.ok(finding !== undefined);
    const records = new Map([
      ...context.evidenceById,
      ...result.evidence.map((record) => [record.id, record] as const),
    ]);
    assert.ok(finding.evidence.some((id) => records.get(id)?.kind === 'span'));
    assert.ok(
      finding.evidence.some(
        (id) =>
          records.get(id)?.kind === 'derived' &&
          (records.get(id) as { rule?: string }).rule === 'runtime_only_component',
      ),
    );
    assert.ok(finding.evidence.some((id) => records.get(id)?.kind === 'absence'));
  });

  it('requires the reconciler derivation in addition to an exact identity-bearing span', () => {
    const outcome = exercisedNotDeclaredRule.evaluate(
      exactRuntimeContext('planner', 'planner', false),
    );
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.deepEqual(outcome.drafts, []);
  });

  it('requires the exact composite provider and model coordinate', () => {
    const exact = exercisedNotDeclaredRule.evaluate(
      exactRuntimeContext('ollama/smollm2:135m', 'smollm2:135m'),
    );
    assert.equal(exact.status, 'fired');
    const outcome = exercisedNotDeclaredRule.evaluate(
      exactRuntimeContext('ollama/smollm2:135m', 'smollm2:135m', true, 'smollm2:135m'),
    );
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.deepEqual(outcome.drafts, []);
  });

  it('refuses a legacy span record that carries no exact observed component coordinate', () => {
    const outcome = exercisedNotDeclaredRule.evaluate(
      exactRuntimeContext('planner', 'planner', true, null),
    );
    assert.equal(outcome.status, 'insufficient_evidence');
    assert.deepEqual(outcome.drafts, []);
  });

  /**
   * Nor was it undeclared when several declarations carried its name. The reconciler found more than one and
   * refused, and saying static discovery found none is the opposite fact about the same repository.
   */
  it('does not call a component undeclared when more than one declaration carries its name', () => {
    const outcome = exercisedNotDeclaredRule.evaluate(contested(['agent:planner'], ['planner']));
    assert.deepEqual(outcome.drafts, []);
    assert.match(outcome.detail ?? '', /observed-name-matches-many-declarations/);
  });

  it('names both diverted populations when a run produced one of each', () => {
    const outcome = exercisedNotDeclaredRule.evaluate(
      contested(['agent:agent', 'agent:planner'], ['planner']),
    );
    assert.deepEqual(outcome.drafts, []);
    assert.match(outcome.detail ?? '', /observed-name-carries-no-identity/);
    assert.match(outcome.detail ?? '', /observed-name-matches-many-declarations/);
  });
});

/**
 * The join is by name, and a name that means several things stops it as surely as a name that means nothing.
 *
 * `exercised-not-declared` said static discovery had found no matching declaration for a name the repository
 * declares three times. It found three and declined to pick, which is a refusal worth reading and not an
 * absence. The sentence had shipped for `supervisor` on the pinned deep research run since that entry was
 * pinned, and reading the packaged CrewAI agents document made it a second entry.
 */
describe('observed-name-matches-many-declarations', () => {
  it('fires for an observation the reconciler matched to more than one declaration', () => {
    const outcome = ambiguousObservationRule.evaluate(contested(['agent:planner'], ['planner']));
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
    const draft = outcome.drafts[0];
    assert.equal(draft?.category, 'observability');
    assert.equal(draft?.basis, 'observed');
    assert.match(draft?.title ?? '', /declared in more than one place/);
    assert.equal(
      draft?.goalEligible,
      false,
      'which declaration gives up the name is a decision this build has no evidence for',
    );
  });

  /*
   * The reconciler writes the observed name as the run reported it, and a CrewAI role arrives with the
   * newline that ended its folded block still on it. The component minted for it is named by the slug, so a
   * comparison that is not normalised matches neither.
   */
  it('fires on a name the run reported with the whitespace its instrumentation left on it', () => {
    const outcome = ambiguousObservationRule.evaluate(contested(['agent:planner'], ['Planner\n']));
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
  });

  it('stays quiet when the reconciler refused nothing', () => {
    const outcome = ambiguousObservationRule.evaluate(contextFor(['agent:planner']));
    assert.equal(outcome.status, 'clear');
    assert.deepEqual(outcome.drafts, []);
  });

  it('stays quiet for an observation that was refused for a different reason', () => {
    const outcome = ambiguousObservationRule.evaluate(contested(['agent:agent'], ['planner']));
    assert.equal(outcome.status, 'clear');
    assert.deepEqual(outcome.drafts, []);
  });

  /*
   * A name that is only the word for a kind matches every declaration of that kind, so it is ambiguous as
   * well as anonymous. It belongs to the rule that owns the bounded edit, and one observation gets one
   * finding: this is the shape the pinned Pydantic AI run reports, where the observed name is `agent`.
   */
  it('leaves a name that is only its kind to the rule that can offer a fix for it', () => {
    const outcome = ambiguousObservationRule.evaluate(contested(['agent:agent'], ['agent']));
    assert.equal(outcome.status, 'clear');
    assert.deepEqual(outcome.drafts, []);
    const owner = unnamedObservationRule.evaluate(contested(['agent:agent'], ['agent']));
    assert.equal(owner.status, 'fired');
    assert.equal(owner.drafts.length, 1);
  });

  it('reports nothing at all before a run has been reconciled', () => {
    const outcome = ambiguousObservationRule.evaluate({
      ...contextFor([]),
      delta: undefined,
    });
    assert.equal(outcome.status, 'insufficient_evidence');
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
    assert.deepEqual(
      draft?.claimEvidence.conclusion,
      annotation.evidence,
      'the finding cites the delta evidence',
    );
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
