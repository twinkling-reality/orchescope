import { buildVariants, runBenchmark } from '@orchescope/benchmark';
import { type Deadline, formatCount } from '@orchescope/domain';
import type { BenchmarkDimension, BenchmarkReport, Scenario } from '@orchescope/schema';
import type { Workspace } from '@orchescope/workspace';
import { currentEnvironment } from './environment.ts';
import { runScenarioUseCase } from './scenario.ts';

/**
 * Benchmarking across one named dimension.
 *
 * One dimension per run is a deliberate restriction. Varying the agent count and the traffic concurrency together
 * produces a number that cannot be attributed to either, and a report that cannot attribute its numbers is not
 * evidence.
 */

export type RunBenchmarkRequest = {
  readonly workspace: Workspace;
  readonly scenario: Scenario;
  readonly dimension: BenchmarkDimension;
  readonly values: readonly (number | string)[];
  readonly repetitions: number;
  readonly warmupRuns?: number;
  readonly orchescopeVersion: string;
  readonly deadline?: Deadline;
};

export const runBenchmarkUseCase = async (
  request: RunBenchmarkRequest,
): Promise<BenchmarkReport> => {
  const { workspace } = request;
  const variants = buildVariants({ dimension: request.dimension, values: request.values });
  const phase = workspace.progress.phase(
    'execute',
    `Benchmarking ${request.dimension} across ${formatCount(variants.length, 'variant')}`,
    variants.length,
  );

  let completed = 0;
  const report = await runBenchmark({
    scenario: request.scenario,
    dimension: request.dimension,
    values: request.values,
    repetitions: request.repetitions,
    warmupRuns: request.warmupRuns ?? 0,
    clock: workspace.clock,
    environment: currentEnvironment(request.orchescopeVersion),
    run: async (variant, repetitions) => {
      const outcome = await runScenarioUseCase({
        workspace,
        scenario: request.scenario,
        variant,
        repetitions,
        orchescopeVersion: request.orchescopeVersion,
        ...(request.deadline === undefined ? {} : { deadline: request.deadline }),
      });
      completed += 1;
      phase.step(completed, `variant ${variant.id ?? 'default'}`);
      return outcome.result;
    },
  });

  workspace.store.saveBenchmark(report, workspace.projectId);
  phase.finish(`${formatCount(report.variants.length, 'variant')} measured`);
  return report;
};
