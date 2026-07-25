import type { CapabilityInput } from '@orchescope/report';
import type { ReportCapability } from '@orchescope/schema';
import type { Workspace } from '@orchescope/workspace';

/**
 * Capability resolution.
 *
 * The browser workspace never guesses whether an action is possible: it reads these flags and the reason behind
 * each one. That is what makes it possible to disable a control and say why, instead of showing a button that
 * fails when pressed.
 */

export type CapabilityContext = {
  readonly workspace: Workspace;
  readonly served: boolean;
  readonly scenarioCount: number;
  readonly runCount: number;
  readonly hasEligibleFindings: boolean;
};

export const resolveCapabilities = (context: CapabilityContext): CapabilityInput => {
  const { policy } = context.workspace.config;

  const reasons: Record<ReportCapability['name'], string> = {
    create_goal: context.hasEligibleFindings
      ? 'a finding in this report is eligible to become a goal'
      : 'no finding in this report is eligible to become a goal',
    rerun_scenario:
      context.scenarioCount === 0
        ? 'no scenario is defined in this project'
        : !policy.allowProcessSpawn
          ? 'running a scenario needs policy.allowProcessSpawn'
          : !context.served
            ? 'a standalone export cannot run commands'
            : 'a scenario can be rerun from this report',
    run_benchmark:
      context.scenarioCount === 0
        ? 'no scenario is defined in this project'
        : !policy.allowProcessSpawn
          ? 'running a benchmark needs policy.allowProcessSpawn'
          : !context.served
            ? 'a standalone export cannot run commands'
            : 'a benchmark can be started from this report',
    run_chaos:
      context.scenarioCount === 0
        ? 'no scenario is defined in this project'
        : policy.allowedChaosEnvironments.length === 0
          ? 'no chaos environment is allowed by policy.allowedChaosEnvironments'
          : !context.served
            ? 'a standalone export cannot run commands'
            : 'a chaos suite can be started from this report',
    compare_runs:
      context.runCount < 2
        ? 'at least two runs are needed before a comparison is meaningful'
        : 'two runs can be compared from this report',
    open_source_location: context.served
      ? 'the served report can ask the local process to open an editor'
      : 'a standalone export cannot open a local editor',
    export_standalone: 'the report can be exported as a single self contained file',
    /*
     * Permanently unavailable, and answered rather than dropped: the workspace asks about every capability it
     * knows, and a reader who has seen an older version of this product deserves the reason rather than silence.
     */
    model_interpretation:
      'analysis in this build is deterministic, so nothing in it interprets a repository with a model',
  };

  return {
    canCreateGoal: context.hasEligibleFindings,
    canRerunScenario: context.served && context.scenarioCount > 0 && policy.allowProcessSpawn,
    canRunBenchmark: context.served && context.scenarioCount > 0 && policy.allowProcessSpawn,
    canRunChaos:
      context.served && context.scenarioCount > 0 && policy.allowedChaosEnvironments.length > 0,
    canCompareRuns: context.runCount >= 2,
    canOpenSourceLocation: context.served,
    canExportStandalone: true,
    modelInterpretationAvailable: false,
    reasons,
  };
};
