import { type Static, Type } from '@sinclair/typebox';
import { ChaosEnvironment } from './chaos.ts';
import {
  Document,
  literals,
  NonEmptyString,
  NonNegativeNumber,
  PositiveInt,
} from './primitives.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * Typed configuration, read from `.orchescope/config.json`.
 *
 * Configuration is resolved once at the edge of the process and passed inward as a value. Nothing in
 * the domain or core packages reads a file or an environment variable.
 *
 * Orchescope contains no telemetry, so there is no setting to disable it.
 */

const port = Type.Integer({
  minimum: 0,
  maximum: 65535,
  description: 'Zero asks the operating system for an unused port.',
});

export const AnalysisConfig = Type.Object(
  {
    include: Type.Array(NonEmptyString()),
    exclude: Type.Array(NonEmptyString()),
    maxFileBytes: PositiveInt,
    maxFiles: PositiveInt,
    /** Parser concurrency. Bounded so a scan cannot exhaust the machine. */
    concurrency: PositiveInt,
    followSymlinks: Type.Boolean(),
    /** Deadline for one static scan. A scan that hits it reports `truncated`. */
    timeoutMs: PositiveInt,
  },
  { additionalProperties: false },
);
export type AnalysisConfig = Static<typeof AnalysisConfig>;

export const RuntimeConfig = Type.Object(
  {
    receiverHost: literals(['127.0.0.1', '::1'] as const),
    receiverPort: port,
    maxSpansPerRun: PositiveInt,
    maxSpanAttributeBytes: PositiveInt,
    maxRequestBytes: PositiveInt,
    /** Grace period after the wrapped process exits, for in flight span exports to arrive. */
    exportDrainMs: PositiveInt,
  },
  { additionalProperties: false },
);
export type RuntimeConfig = Static<typeof RuntimeConfig>;

export const ReportConfig = Type.Object(
  {
    host: literals(['127.0.0.1', '::1'] as const),
    port,
    /** Opening a browser is an action, so it happens only when asked for. */
    openByDefault: Type.Boolean(),
    retainReports: PositiveInt,
  },
  { additionalProperties: false },
);
export type ReportConfig = Static<typeof ReportConfig>;

export const PolicyConfig = Type.Object(
  {
    allowProcessSpawn: Type.Boolean(),
    allowOutboundNetwork: Type.Boolean(),
    allowPaidModels: Type.Boolean(),
    allowFilesystemWrites: Type.Boolean(),
    maxCostUsd: NonNegativeNumber,
    maxRunDurationMs: PositiveInt,
    maxConcurrentRuns: PositiveInt,
    maxTotalRuns: PositiveInt,
    allowedChaosEnvironments: Type.Array(ChaosEnvironment, { minItems: 1 }),
    /** Commands the runner may execute, matched on argv[0]. Empty means every command is refused. */
    allowedCommands: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type PolicyConfig = Static<typeof PolicyConfig>;

export const RedactionConfig = Type.Object(
  {
    /** Extra regular expressions applied to every string that leaves the process. */
    extraPatterns: Type.Array(NonEmptyString()),
    /** Environment variable name fragments whose values are always masked. */
    sensitiveEnvFragments: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type RedactionConfig = Static<typeof RedactionConfig>;

export const OrchescopeConfig = Document(
  schemaId('config'),
  SCHEMA_VERSIONS.config,
  Type.Object({
    projectName: Type.Optional(NonEmptyString()),
    analysis: AnalysisConfig,
    runtime: RuntimeConfig,
    report: ReportConfig,
    policy: PolicyConfig,
    redaction: RedactionConfig,
  }),
);
export type OrchescopeConfig = Static<typeof OrchescopeConfig>;
