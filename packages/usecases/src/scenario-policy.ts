import type { ScenarioPolicy } from '@orchescope/scenarios';
import type { Workspace } from '@orchescope/workspace';

/**
 * Projects the workspace configuration onto the narrow policy the scenario runner needs.
 *
 * The runner receives exactly the decisions it must honour and nothing else, so it cannot reach for a setting it
 * was not given, and a change to the configuration shape stays contained to this one function.
 */
export const scenarioPolicyFrom = (workspace: Workspace): ScenarioPolicy => {
  const { policy, runtime } = workspace.config;
  return {
    allowProcessSpawn: policy.allowProcessSpawn,
    allowOutboundNetwork: policy.allowOutboundNetwork,
    allowPaidModels: policy.allowPaidModels,
    allowFilesystemWrites: policy.allowFilesystemWrites,
    allowedCommands: policy.allowedCommands,
    maxRunDurationMs: policy.maxRunDurationMs,
    maxCostUsd: policy.maxCostUsd,
    receiverHost: runtime.receiverHost,
    maxSpansPerRun: runtime.maxSpansPerRun,
    maxRequestBytes: runtime.maxRequestBytes,
    maxSpanAttributeBytes: runtime.maxSpanAttributeBytes,
    exportDrainMs: runtime.exportDrainMs,
    autoInstrument: runtime.autoInstrument,
  };
};
