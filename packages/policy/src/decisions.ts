import { OrchescopeError } from '@orchescope/domain';
import type {
  ChaosEnvironment,
  ExecutionConfig,
  PolicyConfig,
  ScenarioPermission,
} from '@orchescope/schema';

/**
 * Policy decisions.
 *
 * Two rules shape everything here. A refusal is explicit and names the setting that would grant the action,
 * so a user is never left guessing. And nothing silently downgrades: if an action cannot run safely, it does
 * not run in a weaker form, because a quiet downgrade is how a tool ends up reporting that it verified
 * something it did not.
 */

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly settingToChange: string };

export const allow = (): Decision => ({ allowed: true });

export const deny = (reason: string, settingToChange: string): Decision => ({
  allowed: false,
  reason,
  settingToChange,
});

export const assertAllowed = (decision: Decision, action: string): void => {
  if (decision.allowed) return;
  throw new OrchescopeError('POLICY_DENIED', `${action} was refused: ${decision.reason}`, {
    detail: { setting: decision.settingToChange },
    remediation: `Set ${decision.settingToChange} in .orchescope/config.json if you intend to allow this.`,
  });
};

/**
 * The two blocks a permission spans.
 *
 * `policy` says what Orchescope itself may do; `execution` says whether it starts a process at all. A
 * permission may be granted by either, so a decision reads both and names the one it refused on.
 */
export type GrantingConfig = {
  readonly policy: PolicyConfig;
  readonly execution: ExecutionConfig;
};

const PERMISSION_SETTINGS: Readonly<
  Record<ScenarioPermission, (config: GrantingConfig) => { granted: boolean; setting: string }>
> = {
  'process:spawn': (config) => ({
    granted: config.execution.allowProcessSpawn,
    setting: 'execution.allowProcessSpawn',
  }),
  'network:loopback': (config) => ({
    granted: config.execution.allowProcessSpawn,
    setting: 'execution.allowProcessSpawn',
  }),
  'network:outbound': (config) => ({
    granted: config.policy.allowOutboundNetwork,
    setting: 'policy.allowOutboundNetwork',
  }),
  'model:paid': (config) => ({
    granted: config.policy.allowPaidModels,
    setting: 'policy.allowPaidModels',
  }),
  'filesystem:write': (config) => ({
    granted: config.policy.allowFilesystemWrites,
    setting: 'policy.allowFilesystemWrites',
  }),
};

export const permissionDecision = (
  config: GrantingConfig,
  permission: ScenarioPermission,
): Decision => {
  if (permission === 'network:loopback') return allow();
  const { granted, setting } = PERMISSION_SETTINGS[permission](config);
  return granted ? allow() : deny(`the scenario requires ${permission}`, setting);
};

export const permissionsDecision = (
  config: GrantingConfig,
  permissions: readonly ScenarioPermission[],
): Decision => {
  for (const permission of permissions) {
    const decision = permissionDecision(config, permission);
    if (!decision.allowed) return decision;
  }
  return allow();
};

/**
 * Whether the runner will start this command.
 *
 * A guardrail against a typo rather than a boundary: only the executable is examined, and the default
 * list contains runners that will start anything. What a started command may then do is bounded by the
 * privileges of whoever ran Orchescope and by nothing in this file.
 */
export const commandDecision = (
  execution: ExecutionConfig,
  command: readonly string[],
): Decision => {
  const executable = command[0];
  if (executable === undefined) return deny('the command was empty', 'the scenario target command');
  const name = executable.split('/').pop() ?? executable;
  if (execution.allowedCommands.length === 0) {
    return deny('no command is on the allow list', 'execution.allowedCommands');
  }
  return execution.allowedCommands.some((entry) => entry === executable || entry === name)
    ? allow()
    : deny(`${name} is not on the command allow list`, 'execution.allowedCommands');
};

export const chaosEnvironmentDecision = (
  policy: PolicyConfig,
  environment: ChaosEnvironment,
): Decision =>
  policy.allowedChaosEnvironments.includes(environment)
    ? allow()
    : deny(
        `chaos runs in the ${environment} environment are not allowed`,
        'policy.allowedChaosEnvironments',
      );

export type BudgetUsage = {
  readonly runs: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly concurrentRuns: number;
};

export const budgetDecision = (policy: PolicyConfig, usage: BudgetUsage): Decision => {
  if (usage.runs > policy.maxTotalRuns) {
    return deny(
      `the run count ${usage.runs} exceeds the ceiling of ${policy.maxTotalRuns}`,
      'policy.maxTotalRuns',
    );
  }
  if (usage.costUsd > policy.maxCostUsd) {
    return deny(
      `the estimated cost ${usage.costUsd.toFixed(2)} exceeds the ceiling of ${policy.maxCostUsd.toFixed(2)}`,
      'policy.maxCostUsd',
    );
  }
  if (usage.durationMs > policy.maxRunDurationMs) {
    return deny(
      `the run duration ${usage.durationMs} ms exceeds the ceiling of ${policy.maxRunDurationMs} ms`,
      'policy.maxRunDurationMs',
    );
  }
  if (usage.concurrentRuns > policy.maxConcurrentRuns) {
    return deny(
      `${usage.concurrentRuns} concurrent runs exceeds the ceiling of ${policy.maxConcurrentRuns}`,
      'policy.maxConcurrentRuns',
    );
  }
  return allow();
};

/** Actions that change something outside the store, and the setting that grants each one. */
export const writeActionDecision = (
  policy: PolicyConfig,
  action: 'open_browser' | 'write_file' | 'git_worktree',
): Decision => {
  if (action === 'open_browser') return allow();
  return policy.allowFilesystemWrites
    ? allow()
    : deny(`${action} writes outside the store`, 'policy.allowFilesystemWrites');
};
