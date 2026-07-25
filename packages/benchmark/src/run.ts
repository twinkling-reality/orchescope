import { benchmarkId, type Clock, OrchescopeError } from '@orchescope/domain';
import { computeReliability } from '@orchescope/scenarios';
import {
  type BenchmarkDimension,
  type BenchmarkReport,
  type RunEnvironment,
  SCHEMA_VERSIONS,
  type Scenario,
  type ScenarioResult,
  type ScenarioVariant,
  type VariantResult,
} from '@orchescope/schema';
import { limitationsFor } from './limitations.ts';
import { buildVariants } from './variants.ts';

/**
 * Benchmark execution.
 *
 * Variants run in the order they were given, one at a time, because two variants running at once would
 * measure how well the machine shares a CPU rather than how the system behaves at each setting.
 *
 * Warmup runs execute before the measured runs of each variant and are discarded entirely: a cold cache, a
 * first pass compilation or a lazily opened connection lands outside every number in the report.
 */

export type RunBenchmarkInput = {
  readonly scenario: Scenario;
  readonly dimension: BenchmarkDimension;
  readonly values: readonly (number | string)[];
  readonly repetitions: number;
  readonly warmupRuns: number;
  readonly run: (variant: ScenarioVariant, repetitions: number) => Promise<ScenarioResult>;
  readonly clock: Clock;
  readonly environment: RunEnvironment;
};

const assertCounts = (input: RunBenchmarkInput): void => {
  if (!Number.isInteger(input.repetitions) || input.repetitions < 1) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'A benchmark runs at least one repetition per variant.',
      {
        detail: { repetitions: input.repetitions },
        remediation: 'Pass a positive integer repetition count.',
      },
    );
  }
  if (!Number.isInteger(input.warmupRuns) || input.warmupRuns < 0) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'Warmup runs cannot be negative.', {
      detail: { warmupRuns: input.warmupRuns },
      remediation: 'Pass zero or more warmup runs.',
    });
  }
};

/**
 * The variant result the report keeps. The success rate is recomputed from the repetitions with the same
 * definition of success the scenario runner uses, so a report never quotes a rate derived some other way.
 */
const variantResultFrom = (variant: ScenarioVariant, result: ScenarioResult): VariantResult => {
  const reliability = computeReliability(result.repetitions);
  return {
    ...result.aggregate,
    variantId: variant.id ?? result.aggregate.variantId,
    variant,
    ...(reliability.successRate === undefined ? {} : { successRate: reliability.successRate }),
  };
};

export const runBenchmark = async (input: RunBenchmarkInput): Promise<BenchmarkReport> => {
  assertCounts(input);
  const variants = buildVariants({ dimension: input.dimension, values: input.values });
  if (variants.length === 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'A benchmark needs at least one dimension value.',
      {
        detail: { dimension: input.dimension },
        remediation: 'Pass one value per variant, for example 1,2,4.',
      },
    );
  }

  const startedAt = input.clock.now();
  const measured: VariantResult[] = [];
  for (const variant of variants) {
    if (input.warmupRuns > 0) await input.run(variant, input.warmupRuns);
    const result = await input.run(variant, input.repetitions);
    measured.push(variantResultFrom(variant, result));
  }

  return {
    schemaVersion: SCHEMA_VERSIONS.benchmark,
    id: benchmarkId({ scenarioId: input.scenario.id, dimension: input.dimension, startedAt }),
    scenarioId: input.scenario.id,
    scenarioVersion: input.scenario.schemaVersion,
    dimension: input.dimension,
    startedAt,
    finishedAt: input.clock.now(),
    environment: input.environment,
    warmupRuns: input.warmupRuns,
    variants: measured,
    limitations: [...limitationsFor(measured)],
    metadata: {},
  };
};
