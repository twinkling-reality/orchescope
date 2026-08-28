import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scenarioSatisfying } from '@orchescope/domain';
import { parseScenario } from '@orchescope/scenarios';
import type { ScenarioRequirement } from '@orchescope/schema';
import { scenarioTemplate } from '../src/scenario-template.ts';

/**
 * What the composer writes has to be what the matcher accepts.
 *
 * The two live in different packages on purpose: one writes the file and the other decides whether the
 * file is the one a rule asked for. That is exactly the pair that drifts, so the assertion here is not
 * about the text but about the round trip: compose from a requirement, parse the result with the real
 * parser, and ask the real matcher whether it satisfies the requirement it was composed from.
 */

const INJECTION: ScenarioRequirement = {
  faultKinds: ['prompt_injection_in_content'],
  faultTargets: ['lookup_order', 'tool:lookup_order'],
  evaluatorKinds: ['no_duplicate_effects'],
  prohibitedEffects: true,
};

const RETRY: ScenarioRequirement = {
  faultKinds: ['tool_timeout', 'side_effect_partial_success'],
  faultTargets: ['issue_refund'],
  evaluatorKinds: ['no_duplicate_effects'],
  prohibitedEffects: false,
};

const RECORDED: ScenarioRequirement = {
  faultKinds: [],
  faultTargets: [],
  evaluatorKinds: [],
  prohibitedEffects: false,
  recordedScenarioIds: [],
};

const composedFor = (requirements: readonly ScenarioRequirement[]) =>
  scenarioTemplate(
    [],
    requirements.map((requirement, index) => ({
      findingId: `OSC-TESTS-000${index + 1}`,
      ruleId: `rule-${index + 1}`,
      requirement,
    })),
  );

const parsed = (text: string) => {
  const result = parseScenario(text, 'scenarios/example.yaml');
  assert.ok(result.ok, `the composed file is not a scenario: ${JSON.stringify(result)}`);
  return result.value;
};

describe('the scenario a finding asked for, composed', () => {
  it('writes a file the parser accepts and the matcher agrees with', () => {
    const scenario = parsed(composedFor([INJECTION]));
    assert.equal(scenarioSatisfying(INJECTION, [scenario])?.id, 'example');
  });

  it('satisfies several requirements from one file', () => {
    const scenario = parsed(composedFor([INJECTION, RETRY]));
    assert.equal(scenarioSatisfying(INJECTION, [scenario])?.id, 'example');
    assert.equal(scenarioSatisfying(RETRY, [scenario])?.id, 'example');
  });

  /*
   * The instruction the fault injects and the effect the expectation forbids are the same word, which is
   * the whole reason the expectation means anything: an effect kind is a word the target writes, so a kind
   * read from nowhere would forbid something nothing ever records.
   */
  it('forbids exactly the effect the injected instruction asks for', () => {
    const scenario = parsed(composedFor([INJECTION]));
    const forbidden = scenario.expect?.prohibitedEffects?.[0]?.kind;
    assert.ok(forbidden !== undefined, 'nothing was forbidden');
    assert.ok(
      scenario.faults.every((fault) => fault.payload?.includes(forbidden) === true),
      `the injected instruction does not ask for ${forbidden}`,
    );
  });

  /*
   * A requirement only a run can satisfy contributes no clause and must not vanish: the finding that asked
   * would otherwise be the one thing the file says nothing about.
   */
  it('names a requirement it cannot write into the file, with what would satisfy it', () => {
    const text = composedFor([RECORDED]);
    assert.ok(
      text.includes('rule-1 needs to be a scenario the runs that recorded this belonged to'),
    );
    assert.ok(text.includes('only a recorded run satisfies that'));
    const scenario = parsed(text);
    assert.deepEqual(scenario.faults, []);
    assert.equal(scenarioSatisfying(RECORDED, [scenario]), undefined);
  });

  it('is the template it always was when nothing asked for anything', () => {
    const text = scenarioTemplate();
    assert.equal(text.includes('Composed from the last audit'), false);
    assert.ok(text.includes('faults: []'));
    assert.ok(text.includes('# expect:'));
  });
});
