import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexGraph } from '@orchescope/graph';
import type { ReconciliationDelta } from '@orchescope/schema';
import { buildGraph, componentDraft } from '@orchescope/testkit';
import type { RuleContext } from '../src/rule.ts';
import { exercisedNotDeclaredRule, unnamedObservationRule } from '../src/rules/reconciliation.ts';

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
  runs: [],
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
