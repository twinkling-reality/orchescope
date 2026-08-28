import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Scenario, ScenarioRequirement } from '@orchescope/schema';
import {
  bindScenarioRequirement,
  describeScenarioRequirement,
  scenarioSatisfying,
} from '../src/scenario-requirement.ts';

/**
 * One predicate, asked by three rules and answered by one composer.
 *
 * The two static rules that used to write this out longhand disagreed about which spellings of a component
 * a fault may name: one accepted `*` and the component identifier, the other accepted neither, and nothing
 * argued for either. The cases below are what that disagreement is now settled as.
 */

const scenario = (overrides: Partial<Scenario>): Scenario => ({
  schemaVersion: 1,
  id: 'candidate',
  name: 'Candidate',
  target: { command: ['node', 'main.js'], resultSource: 'exit_code', timeoutMs: 1000 },
  evaluators: [],
  budgets: {},
  faults: [],
  requiredPermissions: [],
  tags: [],
  metadata: {},
  ...overrides,
});

const REQUIREMENT: ScenarioRequirement = {
  faultKinds: ['tool_timeout', 'side_effect_partial_success'],
  faultTargets: ['issue_refund', 'Issue refund', 'tool:issue_refund'],
  evaluatorKinds: ['no_duplicate_effects'],
  prohibitedEffects: false,
};

const fault = (target: string, kind: 'tool_timeout' | 'duplicate_response' = 'tool_timeout') => ({
  kind,
  target,
  delivery: 'cooperative' as const,
  probability: 1,
});

describe('the scenario a rule asked for', () => {
  it('accepts a fault aimed at any spelling the audit resolved', () => {
    for (const target of ['issue_refund', 'Issue refund', 'tool:issue_refund']) {
      const found = scenarioSatisfying(REQUIREMENT, [
        scenario({ faults: [fault(target)], evaluators: [{ kind: 'no_duplicate_effects' }] }),
      ]);
      assert.equal(found?.id, 'candidate', `${target} was refused`);
    }
  });

  it('accepts a fault aimed at everything, because everything includes this', () => {
    const found = scenarioSatisfying(REQUIREMENT, [
      scenario({ faults: [fault('*')], evaluators: [{ kind: 'no_duplicate_effects' }] }),
    ]);
    assert.equal(found?.id, 'candidate');
  });

  it('refuses a fault aimed at another component', () => {
    const found = scenarioSatisfying(REQUIREMENT, [
      scenario({ faults: [fault('send_email')], evaluators: [{ kind: 'no_duplicate_effects' }] }),
    ]);
    assert.equal(found, undefined);
  });

  it('refuses a fault of a kind the requirement did not name', () => {
    const found = scenarioSatisfying(REQUIREMENT, [
      scenario({
        faults: [fault('issue_refund', 'duplicate_response')],
        evaluators: [{ kind: 'no_duplicate_effects' }],
      }),
    ]);
    assert.equal(found, undefined);
  });

  it('needs every evaluator kind, not one of them', () => {
    const requirement: ScenarioRequirement = {
      ...REQUIREMENT,
      evaluatorKinds: ['no_duplicate_effects', 'exit_code'],
    };
    assert.equal(
      scenarioSatisfying(requirement, [
        scenario({
          faults: [fault('issue_refund')],
          evaluators: [{ kind: 'no_duplicate_effects' }],
        }),
      ]),
      undefined,
    );
    assert.equal(
      scenarioSatisfying(requirement, [
        scenario({
          faults: [fault('issue_refund')],
          evaluators: [{ kind: 'no_duplicate_effects' }, { kind: 'exit_code', equals: 0 }],
        }),
      ])?.id,
      'candidate',
    );
  });

  it('needs a prohibited effect where the rule asked for one', () => {
    const requirement: ScenarioRequirement = { ...REQUIREMENT, prohibitedEffects: true };
    const without = scenario({
      faults: [fault('issue_refund')],
      evaluators: [{ kind: 'no_duplicate_effects' }],
    });
    assert.equal(scenarioSatisfying(requirement, [without]), undefined);
    assert.equal(
      scenarioSatisfying(requirement, [
        { ...without, expect: { prohibitedEffects: [{ kind: 'refund', maxCount: 0 }] } },
      ])?.id,
      'candidate',
    );
  });

  /*
   * The clause a file cannot answer. A requirement about recorded work admits the scenarios the runs that
   * produced the evidence belonged to, so writing a scenario is the first half of satisfying it and
   * running one is the second.
   */
  it('admits only a scenario the recording runs belonged to', () => {
    const requirement: ScenarioRequirement = {
      faultKinds: [],
      faultTargets: [],
      evaluatorKinds: [],
      prohibitedEffects: false,
      recordedScenarioIds: ['recorded'],
    };
    assert.equal(scenarioSatisfying(requirement, [scenario({})]), undefined);
    assert.equal(scenarioSatisfying(requirement, [scenario({ id: 'recorded' })])?.id, 'recorded');
    assert.equal(
      scenarioSatisfying({ ...requirement, recordedScenarioIds: [] }, [scenario({})]),
      undefined,
    );
  });

  it('binds what the audit resolved without letting the declared kinds move', () => {
    const declared: ScenarioRequirement = {
      faultKinds: ['tool_timeout'],
      faultTargets: [],
      evaluatorKinds: ['no_duplicate_effects'],
      prohibitedEffects: false,
    };
    const bound = bindScenarioRequirement(declared, { faultTargets: ['pay'] });
    assert.deepEqual(bound.faultKinds, ['tool_timeout']);
    assert.deepEqual(bound.faultTargets, ['pay']);
    assert.equal(bound.recordedScenarioIds, undefined);
  });

  it('says what is missing in the words the reader has to type', () => {
    assert.equal(
      describeScenarioRequirement({ ...REQUIREMENT, prohibitedEffects: true }),
      'a tool_timeout or side_effect_partial_success fault aimed at issue_refund, a no_duplicate_effects evaluator and at least one entry under expect.prohibitedEffects',
    );
    assert.equal(
      describeScenarioRequirement({
        faultKinds: [],
        faultTargets: [],
        evaluatorKinds: [],
        prohibitedEffects: false,
        recordedScenarioIds: [],
      }),
      'to be a scenario the runs that recorded this belonged to, and they belonged to none',
    );
  });
});
