import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OrchescopeError } from '@orchescope/domain';
import type { PolicyConfig, SemanticAnalysisConfig } from '@orchescope/schema';
import {
  assertAllowed,
  budgetDecision,
  chaosEnvironmentDecision,
  commandDecision,
  permissionDecision,
  permissionsDecision,
  semanticAnalysisDecision,
  writeActionDecision,
} from '../src/decisions.ts';

/**
 * Policy tests.
 *
 * Every refusal is checked to name a setting, since a refusal a user cannot act on is a dead end. The values the
 * product ships with are asserted where they are defined, in the workspace configuration tests; this file is about the
 * decisions themselves, so it states its own inputs.
 */

const BASE: PolicyConfig = {
  allowProcessSpawn: false,
  allowOutboundNetwork: false,
  allowPaidModels: false,
  allowFilesystemWrites: false,
  maxCostUsd: 0,
  maxRunDurationMs: 300_000,
  maxConcurrentRuns: 4,
  maxTotalRuns: 200,
  allowedChaosEnvironments: ['local_deterministic'],
  allowedCommands: ['node'],
};

const policy = (overrides: Partial<PolicyConfig> = {}): PolicyConfig => ({ ...BASE, ...overrides });

describe('permissionDecision', () => {
  it('allows loopback, which is how a target reports its own telemetry', () => {
    assert.equal(permissionDecision(policy(), 'network:loopback').allowed, true);
  });

  it('refuses outbound network, paid models and filesystem writes by default', () => {
    for (const permission of ['network:outbound', 'model:paid', 'filesystem:write'] as const) {
      const decision = permissionDecision(policy(), permission);
      assert.equal(decision.allowed, false, `${permission} was allowed`);
      if (!decision.allowed) {
        assert.match(decision.settingToChange, /^policy\./);
        assert.ok(decision.reason.includes(permission));
      }
    }
  });

  it('allows what the configuration grants', () => {
    assert.equal(
      permissionDecision(policy({ allowOutboundNetwork: true }), 'network:outbound').allowed,
      true,
    );
  });

  it('refuses the whole set when one member is refused, and names that one', () => {
    const decision = permissionsDecision(policy({ allowProcessSpawn: true }), [
      'process:spawn',
      'model:paid',
    ]);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.match(decision.reason, /model:paid/);
  });
});

describe('commandDecision', () => {
  it('accepts an allow listed executable by name or by path', () => {
    const allowed = policy({ allowedCommands: ['node'] });
    assert.equal(commandDecision(allowed, ['node', 'src/main.ts']).allowed, true);
    assert.equal(commandDecision(allowed, ['/usr/local/bin/node', 'src/main.ts']).allowed, true);
  });

  it('refuses anything not on the list', () => {
    const decision = commandDecision(policy({ allowedCommands: ['node'] }), ['bash', '-c', 'x']);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.settingToChange, 'policy.allowedCommands');
  });

  it('refuses an empty command and an empty allow list', () => {
    assert.equal(commandDecision(policy({ allowedCommands: ['node'] }), []).allowed, false);
    assert.equal(commandDecision(policy({ allowedCommands: [] }), ['node']).allowed, false);
  });

  it('is not fooled by a path that merely ends with an allowed name', () => {
    const decision = commandDecision(policy({ allowedCommands: ['node'] }), ['/tmp/evil/nodejs']);
    assert.equal(decision.allowed, false);
  });
});

describe('chaosEnvironmentDecision', () => {
  it('allows the deterministic local environment and refuses the live ones', () => {
    assert.equal(chaosEnvironmentDecision(policy(), 'local_deterministic').allowed, true);
    for (const environment of ['declared_test', 'live'] as const) {
      const decision = chaosEnvironmentDecision(policy(), environment);
      assert.equal(decision.allowed, false);
      if (!decision.allowed) {
        assert.equal(decision.settingToChange, 'policy.allowedChaosEnvironments');
      }
    }
  });
});

describe('budgetDecision', () => {
  const usage = { runs: 1, costUsd: 0, durationMs: 10, concurrentRuns: 1 };

  it('allows usage inside every ceiling', () => {
    assert.equal(budgetDecision(policy(), usage).allowed, true);
  });

  it('refuses at the first ceiling exceeded and quotes the number', () => {
    const decision = budgetDecision(policy({ maxTotalRuns: 2 }), { ...usage, runs: 3 });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.match(decision.reason, /3/);
      assert.equal(decision.settingToChange, 'policy.maxTotalRuns');
    }
  });

  it('treats the ceiling as inclusive', () => {
    assert.equal(budgetDecision(policy({ maxTotalRuns: 3 }), { ...usage, runs: 3 }).allowed, true);
  });

  it('checks cost, duration and concurrency as well as run count', () => {
    assert.equal(
      budgetDecision(policy({ maxCostUsd: 1 }), { ...usage, costUsd: 1.5 }).allowed,
      false,
    );
    assert.equal(
      budgetDecision(policy({ maxRunDurationMs: 100 }), { ...usage, durationMs: 101 }).allowed,
      false,
    );
    assert.equal(
      budgetDecision(policy({ maxConcurrentRuns: 2 }), { ...usage, concurrentRuns: 3 }).allowed,
      false,
    );
  });
});

describe('semanticAnalysisDecision', () => {
  const config = (overrides: Partial<SemanticAnalysisConfig> = {}): SemanticAnalysisConfig => ({
    enabled: false,
    provider: 'none',
    model: 'unset',
    maxTasks: 0,
    maxTokensPerTask: 4_000,
    maxCostUsd: 0,
    requestTimeoutMs: 60_000,
    ...overrides,
  });
  const permissive = policy({ allowOutboundNetwork: true, allowPaidModels: true });

  it('is refused when disabled, which is the default', () => {
    const decision = semanticAnalysisDecision(config(), permissive, new Set());
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.settingToChange, 'semanticAnalysis.enabled');
  });

  it('is refused when the credential variable is absent from the environment', () => {
    const decision = semanticAnalysisDecision(
      config({ enabled: true, provider: 'anthropic', apiKeyEnv: 'DEMO_KEY', maxTasks: 4 }),
      permissive,
      new Set(['PATH']),
    );
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.match(decision.reason, /DEMO_KEY is not set/);
  });

  it('is refused when the network or the cost is not granted, even if it is enabled', () => {
    const enabled = config({
      enabled: true,
      provider: 'anthropic',
      apiKeyEnv: 'DEMO_KEY',
      maxTasks: 4,
    });
    const keys = new Set(['DEMO_KEY']);
    assert.equal(
      semanticAnalysisDecision(enabled, policy({ allowPaidModels: true }), keys).allowed,
      false,
    );
    assert.equal(
      semanticAnalysisDecision(enabled, policy({ allowOutboundNetwork: true }), keys).allowed,
      false,
    );
  });

  it('is allowed only when every condition holds', () => {
    const decision = semanticAnalysisDecision(
      config({ enabled: true, provider: 'anthropic', apiKeyEnv: 'DEMO_KEY', maxTasks: 4 }),
      permissive,
      new Set(['DEMO_KEY']),
    );
    assert.equal(decision.allowed, true);
  });

  it('is refused when the task budget is zero, so an enabled but useless configuration says so', () => {
    const decision = semanticAnalysisDecision(
      config({ enabled: true, provider: 'anthropic', apiKeyEnv: 'DEMO_KEY', maxTasks: 0 }),
      permissive,
      new Set(['DEMO_KEY']),
    );
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.settingToChange, 'semanticAnalysis.maxTasks');
  });
});

describe('writeActionDecision', () => {
  it('refuses a file write and a worktree by default and allows opening a browser', () => {
    assert.equal(writeActionDecision(policy(), 'open_browser').allowed, true);
    assert.equal(writeActionDecision(policy(), 'write_file').allowed, false);
    assert.equal(writeActionDecision(policy(), 'git_worktree').allowed, false);
    assert.equal(
      writeActionDecision(policy({ allowFilesystemWrites: true }), 'write_file').allowed,
      true,
    );
  });
});

describe('assertAllowed', () => {
  it('passes an allowed decision through', () => {
    assert.doesNotThrow(() => {
      assertAllowed({ allowed: true }, 'Anything');
    });
  });

  it('throws a classified error that carries the setting and a remediation', () => {
    try {
      assertAllowed(
        {
          allowed: false,
          reason: 'the scenario requires model:paid',
          settingToChange: 'policy.allowPaidModels',
        },
        'Scenario support-desk',
      );
      assert.fail('the refusal did not throw');
    } catch (error) {
      assert.ok(error instanceof OrchescopeError);
      assert.equal(error.code, 'POLICY_DENIED');
      assert.match(error.message, /Scenario support-desk was refused/);
      assert.match(error.remediation ?? '', /policy\.allowPaidModels/);
      assert.deepEqual(error.detail, { setting: 'policy.allowPaidModels' });
    }
  });
});
