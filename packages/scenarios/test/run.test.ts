import assert from 'node:assert/strict';
import { basename } from 'node:path';
import process from 'node:process';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock, isOrchescopeError } from '@orchescope/domain';
import {
  MIN_READABLE_VERSIONS,
  type RunEnvironment,
  SCHEMA_VERSIONS,
  ScenarioResult,
  validateDocument,
} from '@orchescope/schema';
import { createTempWorkspace } from '@orchescope/testkit';
import { parseScenario } from '../src/parse.ts';
import type { ScenarioPolicy } from '../src/policy.ts';
import { runScenario, runScenarioWithArtifacts } from '../src/run.ts';

/**
 * A real supervised run against a tiny target.
 *
 * The target exports no telemetry on purpose: a system with no tracing at all must still be runnable and
 * evaluable through the result file protocol, and this test fails if that ever stops being true.
 */

const TARGET_SCRIPT = `import { writeFileSync } from 'node:fs';
import process from 'node:process';

const file = process.env['ORCHESCOPE_RESULT_FILE'];
const seed = process.env['ORCHESCOPE_SEED'] ?? '0';
if (file === undefined) process.exit(3);
writeFileSync(
  file,
  JSON.stringify({
    success: true,
    output: \`handled request with seed \${seed}\`,
    effects: [
      { kind: 'refund', target: 'billing', idempotencyKey: \`refund-\${seed}\`, outcome: 'succeeded' },
    ],
    userInterventions: 0,
    policyViolations: 0,
    loopIterations: 1,
    metadata: { status: 'done', seed: Number(seed) },
  }),
);
`;

const workspace = createTempWorkspace('orchescope-scenario-');
const scriptPath = workspace.write('target.mjs', TARGET_SCRIPT);

after(() => {
  workspace.dispose();
});

const environment: RunEnvironment = {
  orchescopeVersion: '0.1.0',
  platform: process.platform,
  arch: process.arch,
  cpuCount: 1,
  totalMemoryBytes: 1_000_000,
  runtimeName: 'node',
  runtimeVersion: process.versions.node,
};

const policyFor = (overrides: Partial<ScenarioPolicy> = {}): ScenarioPolicy => ({
  allowProcessSpawn: true,
  allowOutboundNetwork: false,
  allowPaidModels: false,
  allowFilesystemWrites: true,
  allowedCommands: [basename(process.execPath)],
  maxRunDurationMs: 30_000,
  maxCostUsd: 1,
  receiverHost: '127.0.0.1',
  maxSpansPerRun: 500,
  maxRequestBytes: 512 * 1024,
  maxSpanAttributeBytes: 8 * 1024,
  exportDrainMs: 25,
  /*
   * Off, because these fixtures assert what a scenario produces from its own spans. A shim in the target
   * would add outbound request spans that belong to a different test.
   */
  autoInstrument: false,
  ...overrides,
});

const scenarioText = (extra = ''): string => `
id: temp-target
name: Temporary target
seed: 7
repetitions: 3
target:
  command:
    - ${JSON.stringify(process.execPath)}
    - ${JSON.stringify(scriptPath)}
  timeoutMs: 20000
evaluators:
  - kind: output_contains_all
    values: [handled request]
  - kind: exit_code
    equals: 0
  - kind: effect_recorded
    effect:
      kind: refund
      target: billing
  - kind: no_duplicate_effects
  - kind: json_pointer_equals
    pointer: /status
    value: done
  - kind: model_judge
    question: Did the target explain the refund?
    passWhen: 'yes'
    requiresModelAccess: true
expect:
  taskSuccess: true
  requiredEffects:
    - kind: refund
      target: billing
  prohibitedEffects:
    - kind: charge
${extra}`;

const scenarioFrom = (text: string) => {
  const parsed = parseScenario(text, 'scenarios/temp.yaml');
  assert.ok(parsed.ok, `the scenario should parse: ${JSON.stringify(parsed)}`);
  return parsed.value;
};

const baseInput = () => {
  const clock = fixedClock(Date.parse('2026-01-01T00:00:00.000Z'), 1);
  const deadline = createDeadline(120_000, clock.monotonicMs);
  return {
    clock,
    deadline,
    projectRoot: workspace.root,
    projectId: 'prj_0000000000000000',
    policy: policyFor(),
    baseEnv: { PATH: process.env['PATH'] },
    orchescopeVersion: '0.1.0',
    environment,
  };
};

describe('runScenario', () => {
  it('runs every repetition, evaluates the result file and reports reliability', async () => {
    const scenario = scenarioFrom(scenarioText());
    const progress: string[] = [];
    const input = baseInput();
    try {
      const artifacts = await runScenarioWithArtifacts({
        ...input,
        scenario,
        onProgress: (event) => {
          progress.push(`${event.repetition}:${event.status}`);
        },
      });
      const result = artifacts.result;

      assert.equal(result.repetitions.length, 3);
      assert.deepEqual(
        result.repetitions.map((repetition) => repetition.status),
        ['completed', 'completed', 'completed'],
      );
      assert.deepEqual(
        result.repetitions.map((repetition) => repetition.taskSuccess),
        [true, true, true],
      );
      assert.equal(result.reliability.repetitions, 3);
      assert.equal(result.reliability.successes, 3);
      assert.deepEqual(
        result.reliability.passPowerK.map((entry) => entry.value),
        [1, 1, 1],
      );
      /*
       * Reliability and the verdict answer different questions about the same run, and this scenario is
       * where they part company. Every repetition completed, reported task success and passed every
       * evaluator that ran, so the rate is 3 of 3 and pass^k is 1: that is a true statement about how
       * the system behaves. The scenario itself did not pass, because one of the questions it asked was
       * never answered, and a verdict that ignored that would count an unmeasured expectation as a
       * success.
       */
      assert.equal(
        result.passed,
        false,
        `a judged question nothing answered is not a pass: ${JSON.stringify(result.repetitions[0]?.evaluators)}`,
      );

      // Seeds advance per repetition, so the target genuinely saw a different seed each time.
      assert.match(result.repetitions[0]?.outputExcerpt ?? '', /seed 7/);
      assert.match(result.repetitions[1]?.outputExcerpt ?? '', /seed 8/);
      assert.match(result.repetitions[2]?.outputExcerpt ?? '', /seed 9/);

      // The judged evaluator is skipped rather than failed, and it is what withheld the verdict.
      const judged = result.aggregate.evaluators.find((entry) => entry.kind === 'model_judge');
      assert.equal(judged?.skipped, true);
      assert.match(judged?.skipReason ?? '', /deterministic/);
      assert.deepEqual(
        result.repetitions[0]?.evaluators
          .filter((entry) => entry.skipped === true)
          .map((entry) => entry.kind),
        ['model_judge'],
      );

      // Nothing that did run failed, so the withheld verdict is not a failure hiding in another name.
      assert.equal(
        result.repetitions[0]?.evaluators.filter((entry) => entry.skipped !== true && !entry.passed)
          .length,
        0,
      );

      assert.ok(
        result.limitations.some((note) => note.includes('cost was not reported')),
        `expected a cost limitation: ${JSON.stringify(result.limitations)}`,
      );
      assert.ok(result.limitations.some((note) => note.includes('evaluators were skipped')));
      assert.equal(result.aggregate.variantId, 'default');
      assert.equal(result.aggregate.completedRuns, 3);
      assert.equal(result.aggregate.totalTokens.sampleSize, 3);
      assert.equal(progress.length, 6);

      const validated = validateDocument(
        ScenarioResult,
        SCHEMA_VERSIONS.scenarioResult,
        MIN_READABLE_VERSIONS.scenarioResult,
        result,
      );
      assert.ok(validated.ok, `the result should match its schema: ${JSON.stringify(validated)}`);

      assert.equal(artifacts.runs.length, 3);
      assert.deepEqual(
        artifacts.runs.map((entry) => entry.run.id),
        result.repetitions.map((repetition) => repetition.runId),
      );
      assert.equal(artifacts.runs[0]?.bundle.spans.length, 0, 'the target exports no telemetry');
      assert.equal(artifacts.runs[0]?.run.kind, 'scenario');
    } finally {
      input.deadline.dispose();
    }
  });

  it('honours an overriding repetition count', async () => {
    const scenario = scenarioFrom(scenarioText());
    const input = baseInput();
    try {
      const result = await runScenario({ ...input, scenario, repetitions: 1 });
      assert.equal(result.repetitions.length, 1);
      assert.ok(
        result.limitations.some((note) => note.includes('below the 5')),
        `expected a small sample limitation: ${JSON.stringify(result.limitations)}`,
      );
    } finally {
      input.deadline.dispose();
    }
  });

  it('refuses to start when the scenario needs a permission the policy withholds', async () => {
    const scenario = scenarioFrom(scenarioText("requiredPermissions: ['network:outbound']\n"));
    const input = baseInput();
    try {
      await assert.rejects(
        () => runScenario({ ...input, scenario }),
        (error: unknown) =>
          isOrchescopeError(error) &&
          error.code === 'POLICY_DENIED' &&
          (error.remediation ?? '').includes('policy.allowOutboundNetwork'),
      );
    } finally {
      input.deadline.dispose();
    }
  });

  it('refuses to start when process spawning is not granted', async () => {
    const scenario = scenarioFrom(scenarioText());
    const input = baseInput();
    try {
      await assert.rejects(
        () => runScenario({ ...input, scenario, policy: policyFor({ allowProcessSpawn: false }) }),
        (error: unknown) => isOrchescopeError(error) && error.code === 'POLICY_DENIED',
      );
    } finally {
      input.deadline.dispose();
    }
  });
});
