import { OrchescopeError } from '@orchescope/domain';
import type {
  ChaosEnvironment,
  PolicyConfig,
  ScenarioPermission,
  SemanticAnalysisConfig,
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

const PERMISSION_SETTINGS: Readonly<Record<ScenarioPermission, keyof PolicyConfig>> = {
  'process:spawn': 'allowProcessSpawn',
  'network:loopback': 'allowProcessSpawn',
  'network:outbound': 'allowOutboundNetwork',
  'model:paid': 'allowPaidModels',
  'filesystem:write': 'allowFilesystemWrites',
};

export const permissionDecision = (
  policy: PolicyConfig,
  permission: ScenarioPermission,
): Decision => {
  if (permission === 'network:loopback') return allow();
  const setting = PERMISSION_SETTINGS[permission];
  const granted = policy[setting];
  return granted === true
    ? allow()
    : deny(`the scenario requires ${permission}`, `policy.${String(setting)}`);
};

export const permissionsDecision = (
  policy: PolicyConfig,
  permissions: readonly ScenarioPermission[],
): Decision => {
  for (const permission of permissions) {
    const decision = permissionDecision(policy, permission);
    if (!decision.allowed) return decision;
  }
  return allow();
};

export const commandDecision = (policy: PolicyConfig, command: readonly string[]): Decision => {
  const executable = command[0];
  if (executable === undefined) return deny('the command was empty', 'the scenario target command');
  const name = executable.split('/').pop() ?? executable;
  if (policy.allowedCommands.length === 0) {
    return deny('no command is on the allow list', 'policy.allowedCommands');
  }
  return policy.allowedCommands.some((entry) => entry === executable || entry === name)
    ? allow()
    : deny(`${name} is not on the command allow list`, 'policy.allowedCommands');
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
    return deny(`the run count ${usage.runs} exceeds the ceiling of ${policy.maxTotalRuns}`, 'policy.maxTotalRuns');
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

/**
 * Model based analysis is optional in every mode. It is refused unless it was enabled, a provider was chosen
 * and the credential variable is actually present in the environment, so a configured but unusable provider
 * produces a clear refusal instead of a failed request in the middle of an audit.
 */
export const semanticAnalysisDecision = (
  config: SemanticAnalysisConfig,
  policy: PolicyConfig,
  environmentKeys: ReadonlySet<string>,
): Decision => {
  if (!config.enabled) {
    return deny('model based analysis is disabled', 'semanticAnalysis.enabled');
  }
  if (config.provider === 'none') {
    return deny('no model provider is configured', 'semanticAnalysis.provider');
  }
  if (!policy.allowOutboundNetwork) {
    return deny('model based analysis needs outbound network access', 'policy.allowOutboundNetwork');
  }
  if (!policy.allowPaidModels) {
    return deny('model based analysis may incur cost', 'policy.allowPaidModels');
  }
  if (config.apiKeyEnv === undefined) {
    return deny('no credential variable name is configured', 'semanticAnalysis.apiKeyEnv');
  }
  if (!environmentKeys.has(config.apiKeyEnv)) {
    return deny(`the environment variable ${config.apiKeyEnv} is not set`, config.apiKeyEnv);
  }
  if (config.maxTasks <= 0) {
    return deny('the task budget is zero', 'semanticAnalysis.maxTasks');
  }
  return allow();
};

/** Actions that change something outside the store, and the setting that grants each one. */
export const writeActionDecision = (policy: PolicyConfig, action: 'open_browser' | 'write_file' | 'git_worktree'): Decision => {
  if (action === 'open_browser') return allow();
  return policy.allowFilesystemWrites
    ? allow()
    : deny(`${action} writes outside the store`, 'policy.allowFilesystemWrites');
};
