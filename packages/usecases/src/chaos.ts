import { assertEnvironmentAllowed, runChaosSuite } from '@orchescope/chaos';
import { type Deadline, formatCount } from '@orchescope/domain';
import { assertAllowed, chaosEnvironmentDecision } from '@orchescope/policy';
import type { ChaosEnvironment, ChaosReport, Scenario } from '@orchescope/schema';
import type { Workspace } from '@orchescope/workspace';
import { runScenarioUseCase } from './scenario.ts';

/**
 * The chaos use case.
 *
 * The environment gate is checked twice on purpose: once against the project policy and once inside the chaos
 * package. A live run is refused unless it was explicitly allowed, because an injected fault against a real
 * dependency is an outward facing action and the default has to be no.
 */

export type RunChaosRequest = {
  readonly workspace: Workspace;
  readonly scenario: Scenario;
  readonly environment?: ChaosEnvironment;
  readonly seed?: number;
  readonly repetitions?: number;
  readonly orchescopeVersion: string;
  readonly deadline?: Deadline;
};

export const runChaosUseCase = async (request: RunChaosRequest): Promise<ChaosReport> => {
  const { workspace, scenario } = request;
  const environment = request.environment ?? 'local_deterministic';
  assertAllowed(
    chaosEnvironmentDecision(workspace.config.policy, environment),
    `A chaos run in the ${environment} environment`,
  );
  assertEnvironmentAllowed(environment, workspace.config.policy.allowedChaosEnvironments);

  const faultCount = scenario.faults.length;
  const phase = workspace.progress.phase(
    'execute',
    `Injecting ${formatCount(faultCount, 'fault')} into ${scenario.id}`,
    faultCount + 1,
  );
  let completed = 0;

  const report = await runChaosSuite({
    scenario,
    environment,
    allowedEnvironments: workspace.config.policy.allowedChaosEnvironments,
    seed: request.seed ?? scenario.seed ?? 1,
    repetitions: request.repetitions ?? 1,
    clock: workspace.clock,
    runBaseline: async () => {
      const outcome = await runScenarioUseCase({
        workspace,
        scenario,
        repetitions: request.repetitions ?? 1,
        orchescopeVersion: request.orchescopeVersion,
        ...(request.deadline === undefined ? {} : { deadline: request.deadline }),
      });
      completed += 1;
      phase.step(completed, 'baseline');
      return outcome.result;
    },
    runWithPlan: async (plan, repetitions) => {
      const outcome = await runScenarioUseCase({
        workspace,
        scenario,
        repetitions,
        faultPlan: plan,
        orchescopeVersion: request.orchescopeVersion,
        ...(request.deadline === undefined ? {} : { deadline: request.deadline }),
      });
      completed += 1;
      phase.step(completed, `fault plan ${plan.id}`);
      return outcome.result;
    },
  });

  workspace.store.saveChaosReport(report, workspace.projectId);
  const absorbed = report.outcomes.filter((outcome) => outcome.taskCompleted).length;
  phase.finish(`${absorbed} of ${formatCount(report.outcomes.length, 'fault')} absorbed`);
  return report;
};
