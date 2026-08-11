import type { CapabilityInput } from '@orchescope/report';
import type { ReportCapability } from '@orchescope/schema';
import type { Workspace } from '@orchescope/workspace';

/**
 * Capability resolution.
 *
 * Capabilities describe what the CLI and MCP can do under the current policy. They travel in the
 * report bundle so an agent (or a CI reader of `--json`) can see what is available without guessing.
 * There is no browser workspace to drive these flags.
 */

export type CapabilityContext = {
  readonly workspace: Workspace;
  readonly scenarioCount: number;
  readonly runCount: number;
  readonly hasEligibleFindings: boolean;
  /** Whether any ingested run reported tokens, which is what a price would be applied to. */
  readonly tokensObserved: boolean;
};

/**
 * Why cost is or is not on this report.
 *
 * Cost needs two halves and a run only supplies one: a span reports tokens and no convention reports a price.
 * Saying which half is missing is the difference between a reader concluding the run was free and a reader knowing
 * what to configure.
 */
const costReason = (pricedModels: number, tokensObserved: boolean): string => {
  if (pricedModels === 0) {
    return 'no price is configured, so tokens are reported and cost is not. Add prices under pricing in .orchescope/config.json, keyed by provider/model';
  }
  if (!tokensObserved) {
    return `${pricedModels} model price(s) are configured, and no ingested run reported any token usage to apply them to`;
  }
  return `cost is estimated from observed tokens and the ${pricedModels} configured model price(s)`;
};

export const resolveCapabilities = (context: CapabilityContext): CapabilityInput => {
  const { policy, pricing } = context.workspace.config;
  const pricedModels = Object.keys(pricing).length;

  const reasons: Record<ReportCapability['name'], string> = {
    create_goal: context.hasEligibleFindings
      ? 'a finding in this report is eligible to become a goal'
      : 'no finding in this report is eligible to become a goal',
    rerun_scenario:
      context.scenarioCount === 0
        ? 'no scenario is defined in this project'
        : !policy.allowProcessSpawn
          ? 'running a scenario needs policy.allowProcessSpawn'
          : 'a scenario can be rerun with orchescope test, or over MCP',
    run_benchmark:
      context.scenarioCount === 0
        ? 'no scenario is defined in this project'
        : !policy.allowProcessSpawn
          ? 'running a benchmark needs policy.allowProcessSpawn'
          : 'a benchmark can be started with orchescope benchmark, or over MCP',
    run_chaos:
      context.scenarioCount === 0
        ? 'no scenario is defined in this project'
        : policy.allowedChaosEnvironments.length === 0
          ? 'no chaos environment is allowed by policy.allowedChaosEnvironments'
          : 'a chaos suite can be started with orchescope chaos, or over MCP',
    compare_runs:
      context.runCount < 2
        ? 'at least two runs are needed before a comparison is meaningful'
        : 'two runs can be compared with orchescope compare, or over MCP',
    open_source_location:
      'there is no browser report; open the path named on the finding in your own editor',
    export_standalone: 'there is no standalone HTML report; export json, mermaid or sarif instead',
    cost_estimate: costReason(pricedModels, context.tokensObserved),
    /*
     * Permanently unavailable, and answered rather than dropped: a reader who has seen an older version of this
     * product deserves the reason rather than silence.
     */
    model_interpretation:
      'analysis in this build is deterministic, so nothing in it interprets a repository with a model',
  };

  return {
    costEstimateAvailable: pricedModels > 0 && context.tokensObserved,
    canCreateGoal: context.hasEligibleFindings,
    canRerunScenario: context.scenarioCount > 0 && policy.allowProcessSpawn,
    canRunBenchmark: context.scenarioCount > 0 && policy.allowProcessSpawn,
    canRunChaos: context.scenarioCount > 0 && policy.allowedChaosEnvironments.length > 0,
    canCompareRuns: context.runCount >= 2,
    canOpenSourceLocation: false,
    canExportStandalone: false,
    modelInterpretationAvailable: false,
    reasons,
  };
};
