import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TARGET_ENV } from '@orchescope/schema';
import { scenarioEnv } from '../src/env.ts';
import { parseScenario } from '../src/parse.ts';

/**
 * Parsing, defaulting and environment mapping. A scenario file is untrusted input, so every case here is
 * about what the parser refuses as much as what it accepts.
 */

const minimal = `
id: refund-flow
name: Refund flow
target:
  command:
    - node
    - src/main.ts
  timeoutMs: 30000
`;

const withVariant = `
id: refund-flow
name: Refund flow
seed: 7
repetitions: 4
target:
  command:
    - node
    - src/main.ts
  timeoutMs: 30000
  env:
    TARGET_MODE: batch
variant:
  id: four-agents
  agents: 4
  workers: 2
  concurrency: 3
  topology: hub
  promptVersion: v2
  toolConfig: full
  model:
    provider: openai
    model: gpt-4o-mini
  env:
    VARIANT_FLAG: enabled
input:
  prompt: refund the last charge
initialState:
  account: a-1
`;

describe('parseScenario', () => {
  it('accepts a minimal scenario and fills every default', () => {
    const parsed = parseScenario(minimal, 'scenarios/refund.yaml');
    assert.ok(parsed.ok, 'the minimal scenario should be valid');
    const scenario = parsed.value;
    assert.equal(scenario.schemaVersion, 1);
    assert.equal(scenario.id, 'refund-flow');
    assert.deepEqual(scenario.evaluators, []);
    assert.deepEqual(scenario.faults, []);
    assert.deepEqual(scenario.budgets, {});
    assert.deepEqual(scenario.requiredPermissions, []);
    assert.deepEqual(scenario.tags, []);
    assert.deepEqual(scenario.metadata, {});
    assert.equal(scenario.repetitions, 1);
    assert.equal(scenario.target.resultSource, 'result_file');
    assert.equal(scenario.target.stopSignal, 'SIGTERM');
    assert.deepEqual(scenario.target.command, ['node', 'src/main.ts']);
  });

  it('keeps values the author set instead of the defaults', () => {
    const parsed = parseScenario(
      `${minimal}repetitions: 5\ntags: [smoke]\n`,
      'scenarios/refund.yaml',
    );
    assert.ok(parsed.ok);
    assert.equal(parsed.value.repetitions, 5);
    assert.deepEqual(parsed.value.tags, ['smoke']);
  });

  it('rejects a scenario without a target command and names the path', () => {
    const parsed = parseScenario(
      `
id: no-command
name: No command
target:
  timeoutMs: 1000
`,
      'scenarios/broken.yaml',
    );
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok);
    assert.ok(
      parsed.issues.some((issue) => issue.path === '/target/command'),
      `expected an issue on /target/command, got ${JSON.stringify(parsed.issues)}`,
    );
  });

  it('rejects a working directory that climbs out of the repository', () => {
    const parsed = parseScenario(
      `
id: escaping
name: Escaping
target:
  command: [node, main.ts]
  cwd: ../outside
  timeoutMs: 1000
`,
      'scenarios/escaping.yaml',
    );
    assert.ok(!parsed.ok);
    assert.ok(parsed.issues.some((issue) => issue.path === '/target/cwd'));
  });

  it('reports unparseable YAML as an issue rather than throwing', () => {
    const parsed = parseScenario('id: [unclosed\n', 'scenarios/bad.yaml');
    assert.ok(!parsed.ok);
    assert.match(parsed.issues[0]?.message ?? '', /scenarios\/bad\.yaml is not valid YAML/);
  });

  it('rejects a document that is not a mapping', () => {
    const parsed = parseScenario('- one\n- two\n', 'scenarios/list.yaml');
    assert.ok(!parsed.ok);
    assert.match(parsed.issues[0]?.message ?? '', /does not contain a YAML mapping/);
  });
});

describe('scenarioEnv', () => {
  const scenario = (() => {
    const parsed = parseScenario(withVariant, 'scenarios/refund.yaml');
    assert.ok(parsed.ok);
    return parsed.value;
  })();

  it('maps every variant dimension onto the documented variables', () => {
    const env = scenarioEnv(scenario, scenario.variant, 0);
    assert.equal(env[TARGET_ENV.scenarioId], 'refund-flow');
    assert.equal(env[TARGET_ENV.agents], '4');
    assert.equal(env[TARGET_ENV.workers], '2');
    assert.equal(env[TARGET_ENV.concurrency], '3');
    assert.equal(env[TARGET_ENV.topology], 'hub');
    assert.equal(env[TARGET_ENV.promptVersion], 'v2');
    assert.equal(env[TARGET_ENV.toolConfig], 'full');
    assert.equal(env[TARGET_ENV.modelProvider], 'openai');
    assert.equal(env[TARGET_ENV.model], 'gpt-4o-mini');
    assert.equal(env[TARGET_ENV.input], 'refund the last charge');
    assert.equal(env[TARGET_ENV.initialState], '{"account":"a-1"}');
    assert.equal(env['TARGET_MODE'], 'batch');
    assert.equal(env['VARIANT_FLAG'], 'enabled');
  });

  it('derives a different seed per repetition from the scenario seed', () => {
    assert.equal(scenarioEnv(scenario, scenario.variant, 0)[TARGET_ENV.seed], '7');
    assert.equal(scenarioEnv(scenario, scenario.variant, 1)[TARGET_ENV.seed], '8');
    assert.equal(scenarioEnv(scenario, scenario.variant, 2)[TARGET_ENV.seed], '9');
  });

  it('omits variables the scenario says nothing about', () => {
    const parsed = parseScenario(minimal, 'scenarios/refund.yaml');
    assert.ok(parsed.ok);
    const env = scenarioEnv(parsed.value, undefined, 0);
    assert.equal(env[TARGET_ENV.agents], undefined);
    assert.equal(env[TARGET_ENV.input], undefined);
    assert.equal(env[TARGET_ENV.seed], '1');
  });
});
