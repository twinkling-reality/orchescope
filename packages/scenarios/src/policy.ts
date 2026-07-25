import { OrchescopeError } from '@orchescope/domain';
import type { Scenario, ScenarioPermission } from '@orchescope/schema';

/**
 * Execution policy and permission enforcement.
 *
 * A scenario declares what it needs and the policy decides. A missing grant refuses the run before the
 * target is started and names the configuration key that would grant it, because a run that quietly
 * degrades to a weaker mode produces evidence nobody can trust.
 *
 * Two permissions are special. `network:loopback` has no key: the trace receiver always binds loopback and
 * never accepts a remote connection, so there is nothing to grant. `model:paid` is only required when the
 * scenario itself declares it; a `model_judge` evaluator does not require the grant, it is skipped instead.
 */

export type ScenarioPolicy = {
  readonly allowProcessSpawn: boolean;
  readonly allowOutboundNetwork: boolean;
  readonly allowPaidModels: boolean;
  readonly allowFilesystemWrites: boolean;
  readonly allowedCommands: readonly string[];
  readonly maxRunDurationMs: number;
  readonly maxCostUsd: number;
  readonly receiverHost: '127.0.0.1' | '::1';
  readonly maxSpansPerRun: number;
  readonly maxRequestBytes: number;
  readonly maxSpanAttributeBytes: number;
  readonly exportDrainMs: number;
};

type Grant = {
  readonly permission: ScenarioPermission;
  readonly granted: (policy: ScenarioPolicy) => boolean;
  readonly configKey: string;
};

const GRANTS: readonly Grant[] = [
  {
    permission: 'process:spawn',
    granted: (policy) => policy.allowProcessSpawn,
    configKey: 'policy.allowProcessSpawn',
  },
  {
    permission: 'network:outbound',
    granted: (policy) => policy.allowOutboundNetwork,
    configKey: 'policy.allowOutboundNetwork',
  },
  {
    permission: 'model:paid',
    granted: (policy) => policy.allowPaidModels,
    configKey: 'policy.allowPaidModels',
  },
  {
    permission: 'filesystem:write',
    granted: (policy) => policy.allowFilesystemWrites,
    configKey: 'policy.allowFilesystemWrites',
  },
];

const deny = (permission: string, configKey: string): never => {
  throw new OrchescopeError(
    'POLICY_DENIED',
    `This scenario requires ${permission}, which the current policy does not grant.`,
    {
      detail: { permission, configKey },
      remediation: `Set ${configKey} to true in .orchescope/config.json if you intend to allow it.`,
    },
  );
};

/**
 * Refuses the run before anything executes. Running a scenario always spawns the target, so the spawn
 * grant is required whether or not the scenario bothered to declare it.
 */
export const assertPermissions = (scenario: Scenario, policy: ScenarioPolicy): void => {
  if (!policy.allowProcessSpawn) deny('process:spawn', 'policy.allowProcessSpawn');
  for (const permission of scenario.requiredPermissions) {
    const grant = GRANTS.find((candidate) => candidate.permission === permission);
    if (grant !== undefined && !grant.granted(policy)) deny(permission, grant.configKey);
  }
};
