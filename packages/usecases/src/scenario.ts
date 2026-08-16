import { readFileSync } from 'node:fs';
import {
  createDeadline,
  type Deadline,
  faultPlanId,
  formatCount,
  OrchescopeError,
} from '@orchescope/domain';
import { assertAllowed, permissionsDecision } from '@orchescope/policy';
import { loadScenarios, parseScenario, runScenarioWithArtifacts } from '@orchescope/scenarios';
import type { FaultPlan, Scenario, ScenarioResult, ScenarioVariant } from '@orchescope/schema';
import { formatIssues } from '@orchescope/schema';
import { resolveInsideRoot, type Workspace } from '@orchescope/workspace';
import { currentEnvironment } from './environment.ts';
import { scenarioPolicyFrom } from './scenario-policy.ts';

/**
 * Scenario execution.
 *
 * Loading, permission checks and persistence live here; the mechanics of running and evaluating live in
 * `@orchescope/scenarios`. A scenario is refused before anything executes when it needs a permission the project
 * has not granted, and the refusal names the setting.
 */

export type LoadScenarioRequest = {
  readonly workspace: Workspace;
  /** A scenario identifier already in the store, or a repository relative path to a YAML file. */
  readonly reference: string;
};

export const loadScenario = (request: LoadScenarioRequest): Scenario => {
  const { workspace } = request;
  const stored = workspace.store.scenarioById(request.reference);
  if (stored !== undefined) return stored;

  if (request.reference.endsWith('.yaml') || request.reference.endsWith('.yml')) {
    // Resolved and normalized before it is compared: a textual prefix check accepts `<root>/../../etc/passwd`.
    const resolved = resolveInsideRoot(workspace.paths, request.reference);
    const text = readFileSync(resolved, 'utf8');
    const parsed = parseScenario(text, request.reference);
    if (!parsed.ok) {
      throw new OrchescopeError(
        'SCHEMA_INVALID',
        `${request.reference} is not a valid scenario: ${formatIssues(parsed.issues)}`,
      );
    }
    workspace.store.saveScenario(parsed.value, workspace.projectId, request.reference);
    return parsed.value;
  }

  const discovered = discoverScenarios(workspace);
  const match = discovered.find((scenario) => scenario.id === request.reference);
  if (match === undefined) {
    throw new OrchescopeError('NOT_FOUND', `No scenario named ${request.reference}.`, {
      remediation:
        discovered.length === 0
          ? 'Add a scenario file under scenarios/ in this repository.'
          : `Known scenarios: ${discovered.map((scenario) => scenario.id).join(', ')}`,
    });
  }
  return match;
};

/** Reads every scenario file in the repository and stores it, returning what was found. */
export const discoverScenarios = (workspace: Workspace): readonly Scenario[] => {
  const loaded = loadScenarios(workspace.paths.root, ['scenarios']);
  for (const entry of loaded.scenarios) {
    workspace.store.saveScenario(entry.scenario, workspace.projectId, entry.path);
  }
  for (const problem of loaded.problems) {
    workspace.logger.warning('a scenario file could not be loaded', {
      file: problem.file,
      detail: problem.detail,
    });
  }
  return loaded.scenarios.map((entry) => entry.scenario);
};

export type RunScenarioRequest = {
  readonly workspace: Workspace;
  readonly scenario: Scenario;
  readonly variant?: ScenarioVariant;
  readonly repetitions?: number;
  readonly faultPlan?: FaultPlan;
  readonly orchescopeVersion: string;
  readonly deadline?: Deadline;
};

export type RunScenarioOutcome = {
  readonly result: ScenarioResult;
  readonly runIds: readonly string[];
};

/**
 * A scenario that declares faults runs with them applied.
 *
 * `orchescope test` executes the scenario as written, which includes its fault list, because a scenario is a complete
 * description of a run. `orchescope chaos` supplies one plan per fault instead, so that an outcome can be attributed to
 * a single fault rather than to a combination.
 */
const declaredFaultPlan = (request: RunScenarioRequest): FaultPlan | undefined => {
  if (request.faultPlan !== undefined) return request.faultPlan;
  if (request.scenario.faults.length === 0) return undefined;
  const seed = request.scenario.seed ?? 1;
  return {
    id: `fp_${faultPlanId({ seed, faults: request.scenario.faults }).slice(3, 19)}`,
    seed,
    faults: [...request.scenario.faults],
  };
};

export const runScenarioUseCase = async (
  request: RunScenarioRequest,
): Promise<RunScenarioOutcome> => {
  const { workspace, scenario } = request;
  assertAllowed(
    permissionsDecision(workspace.config, scenario.requiredPermissions),
    `Scenario ${scenario.id}`,
  );

  const handle =
    request.deadline === undefined
      ? createDeadline(workspace.config.policy.maxRunDurationMs * 4, workspace.clock.monotonicMs)
      : undefined;
  const deadline = request.deadline ?? (handle as Deadline);
  const phase = workspace.progress.phase(
    'execute',
    `Running scenario ${scenario.id}`,
    request.repetitions ?? scenario.repetitions ?? 1,
  );

  const plan = declaredFaultPlan(request);

  try {
    const artifacts = await runScenarioWithArtifacts({
      scenario,
      ...(request.variant === undefined ? {} : { variant: request.variant }),
      ...(request.repetitions === undefined ? {} : { repetitions: request.repetitions }),
      ...(plan === undefined ? {} : { faultPlan: plan }),
      projectRoot: workspace.paths.root,
      projectId: workspace.projectId,
      clock: workspace.clock,
      deadline,
      policy: scenarioPolicyFrom(workspace),
      baseEnv: process.env,
      orchescopeVersion: request.orchescopeVersion,
      environment: currentEnvironment(request.orchescopeVersion),
      onProgress: (event) => phase.step(event.repetition, event.status),
    });

    for (const entry of artifacts.runs) {
      workspace.store.saveRun({
        run: entry.run,
        projectId: workspace.projectId,
        bundle: entry.bundle,
        componentMetrics: entry.run.componentMetrics,
        sideEffects: entry.bundle.sideEffects,
      });
      workspace.store.saveEvidence(entry.topology.evidence);
    }
    workspace.store.saveScenarioResult(artifacts.result, workspace.projectId);
    phase.finish(
      `${formatCount(artifacts.result.repetitions.length, 'repetition')}, ${artifacts.result.passed ? 'passed' : 'failed'}`,
    );

    return {
      result: artifacts.result,
      runIds: artifacts.runs.map((entry) => entry.run.id),
    };
  } finally {
    handle?.dispose();
  }
};
