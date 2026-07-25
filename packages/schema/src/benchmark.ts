import { type Static, Type } from '@sinclair/typebox';
import { EvaluatorResult } from './evaluator.ts';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  NonNegativeNumber,
  PositiveInt,
  Timestamp,
} from './primitives.ts';
import { RunEnvironment, RunMetrics } from './run.ts';
import { ScenarioVariant } from './scenario.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * Benchmarking keeps its dimensions separate. Varying the agent count and the traffic concurrency in
 * the same experiment produces a number nobody can interpret, so a dimension is named explicitly.
 */
export const BenchmarkDimension = literals([
  'agent_count',
  'worker_count',
  'traffic_concurrency',
  'topology',
  'model_config',
  'prompt_version',
  'tool_config',
  'git_ref',
] as const);
export type BenchmarkDimension = Static<typeof BenchmarkDimension>;

/**
 * Sample size thresholds for reporting a quantile. Below the threshold the quantile is reported as
 * unavailable rather than computed from too few points.
 */
export const QUANTILE_MIN_SAMPLES = { p50: 3, p90: 10, p95: 20, p99: 100 } as const;

export const Distribution = Type.Object(
  {
    sampleSize: NonNegativeInt,
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
    mean: Type.Optional(Type.Number()),
    stdDev: Type.Optional(NonNegativeNumber),
    p50: Type.Optional(Type.Number()),
    p90: Type.Optional(Type.Number()),
    p95: Type.Optional(Type.Number()),
    p99: Type.Optional(Type.Number()),
    /** Quantiles withheld because the sample was too small, with the threshold that was not met. */
    withheld: Type.Array(
      Type.Object(
        { quantile: literals(['p50', 'p90', 'p95', 'p99'] as const), requiredSamples: PositiveInt },
        { additionalProperties: false },
      ),
    ),
    /** Raw values, kept so that a summary can always be recomputed or re-checked. */
    values: Type.Array(Type.Number()),
  },
  { additionalProperties: false },
);
export type Distribution = Static<typeof Distribution>;

export const VariantResult = Type.Object(
  {
    variantId: NonEmptyString(),
    variant: ScenarioVariant,
    runIds: Type.Array(NonEmptyString(), { minItems: 1 }),
    repetitions: PositiveInt,
    completedRuns: NonNegativeInt,
    failedRuns: NonNegativeInt,
    successRate: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    durationMs: Distribution,
    timeToFirstOutputMs: Type.Optional(Distribution),
    totalTokens: Distribution,
    costUsd: Type.Optional(Distribution),
    modelCalls: Distribution,
    toolCalls: Distribution,
    retries: Distribution,
    aggregateMetrics: RunMetrics,
    evaluators: Type.Array(EvaluatorResult),
  },
  { additionalProperties: false },
);
export type VariantResult = Static<typeof VariantResult>;

export const BenchmarkReport = Document(
  schemaId('benchmark'),
  SCHEMA_VERSIONS.benchmark,
  Type.Object({
    id: Type.String({ pattern: '^bench_[0-9a-f]{16}$' }),
    scenarioId: NonEmptyString(),
    scenarioVersion: NonNegativeInt,
    dimension: BenchmarkDimension,
    startedAt: Timestamp,
    finishedAt: Timestamp,
    environment: RunEnvironment,
    warmupRuns: NonNegativeInt,
    variants: Type.Array(VariantResult, { minItems: 1 }),
    /** Statements the data does not support, written down so the report cannot overclaim. */
    limitations: Type.Array(NonEmptyString()),
    metadata: Metadata,
  }),
);
export type BenchmarkReport = Static<typeof BenchmarkReport>;
