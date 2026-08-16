import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OrchescopeError } from '@orchescope/domain';
import type { ExecutionConfig, PolicyConfig } from '@orchescope/schema';
import {
  assertAllowed,
  budgetDecision,
  chaosEnvironmentDecision,
  commandDecision,
  permissionDecision,
  permissionsDecision,
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
  allowOutboundNetwork: false,
  allowPaidModels: false,
  allowFilesystemWrites: false,
  maxCostUsd: 0,
  maxRunDurationMs: 300_000,
  maxConcurrentRuns: 4,
  maxTotalRuns: 200,
  allowedChaosEnvironments: ['local_deterministic'],
};

const policy = (overrides: Partial<PolicyConfig> = {}): PolicyConfig => ({ ...BASE, ...overrides });

const EXECUTION: ExecutionConfig = { allowProcessSpawn: false, allowedCommands: ['node'] };

const execution = (overrides: Partial<ExecutionConfig> = {}): ExecutionConfig => ({
  ...EXECUTION,
  ...overrides,
});

/*
 * The two blocks a permission spans. `policy` says what Orchescope itself may do and `execution` says
 * whether it starts a process at all, which is why a decision reads both and names the one it refused on.
 */
const granting = (
  policyOverrides: Partial<PolicyConfig> = {},
  executionOverrides: Partial<ExecutionConfig> = {},
) => ({ policy: policy(policyOverrides), execution: execution(executionOverrides) });

describe('permissionDecision', () => {
  it('allows loopback, which is how a target reports its own telemetry', () => {
    assert.equal(permissionDecision(granting(), 'network:loopback').allowed, true);
  });

  it('refuses outbound network, paid models and filesystem writes by default', () => {
    for (const permission of ['network:outbound', 'model:paid', 'filesystem:write'] as const) {
      const decision = permissionDecision(granting(), permission);
      assert.equal(decision.allowed, false, `${permission} was allowed`);
      if (!decision.allowed) {
        assert.match(decision.settingToChange, /^policy\./);
        assert.ok(decision.reason.includes(permission));
      }
    }
  });

  it('allows what the configuration grants', () => {
    assert.equal(
      permissionDecision(granting({ allowOutboundNetwork: true }), 'network:outbound').allowed,
      true,
    );
  });

  it('refuses the whole set when one member is refused, and names that one', () => {
    const decision = permissionsDecision(granting({}, { allowProcessSpawn: true }), [
      'process:spawn',
      'model:paid',
    ]);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.match(decision.reason, /model:paid/);
  });
});

describe('commandDecision', () => {
  it('accepts an allow listed executable by name or by path', () => {
    const allowed = execution({ allowedCommands: ['node'] });
    assert.equal(commandDecision(allowed, ['node', 'src/main.ts']).allowed, true);
    assert.equal(commandDecision(allowed, ['/usr/local/bin/node', 'src/main.ts']).allowed, true);
  });

  it('refuses anything not on the list', () => {
    const decision = commandDecision(execution({ allowedCommands: ['node'] }), ['bash', '-c', 'x']);
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.settingToChange, 'execution.allowedCommands');
  });

  it('refuses an empty command and an empty allow list', () => {
    assert.equal(commandDecision(execution({ allowedCommands: ['node'] }), []).allowed, false);
    assert.equal(commandDecision(execution({ allowedCommands: [] }), ['node']).allowed, false);
  });

  it('is not fooled by a path that merely ends with an allowed name', () => {
    const decision = commandDecision(execution({ allowedCommands: ['node'] }), [
      '/tmp/evil/nodejs',
    ]);
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
