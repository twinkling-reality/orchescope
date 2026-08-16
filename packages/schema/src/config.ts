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
    /**
     * Whether a traced Node process is loaded with Orchescope's own instrumentation.
     *
     * The OpenTelemetry variables a traced run sets are inert unless something in the target already loads
     * an SDK, and essentially no Node project does, so without this a run collects nothing and the audit is
     * inventory. This is on by default because that is the difference between what the product claims and
     * what it delivers, and it is a setting because it puts Orchescope's code inside a process the operator
     * owns. A target that already runs OpenTelemetry is left alone whatever this says.
     */
    autoInstrument: Type.Boolean(),
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

/**
 * What Orchescope itself may do, and how much of it.
 *
 * Every setting here constrains this process. None of them constrains a process Orchescope starts, which
 * is why the two settings that decide whether one starts at all live in their own block: a reader who
 * found `allowFilesystemWrites: false` next to `allowedCommands` concluded that tracing was sandboxed,
 * and it never was. See `ExecutionConfig`.
 */
export const PolicyConfig = Type.Object(
  {
    allowOutboundNetwork: Type.Boolean(),
    allowPaidModels: Type.Boolean(),
    allowFilesystemWrites: Type.Boolean(),
    maxCostUsd: NonNegativeNumber,
    maxRunDurationMs: PositiveInt,
    maxConcurrentRuns: PositiveInt,
    maxTotalRuns: PositiveInt,
    allowedChaosEnvironments: Type.Array(ChaosEnvironment, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type PolicyConfig = Static<typeof PolicyConfig>;

/**
 * Whether Orchescope starts a process, and which one.
 *
 * Separated from `policy` because the two blocks answer different questions and the answer to this one
 * is narrower than it looks. Nothing here bounds what a started process may then do: a traced command
 * runs with the operator's full ambient privileges, writing the files it always writes and reaching the
 * network it always reaches. Orchescope adds environment variables and, for a Node target, loads its own
 * instrumentation; it takes nothing away and it is not a sandbox.
 */
export const ExecutionConfig = Type.Object(
  {
    /** Whether any process may be started at all. False keeps an audit entirely static. */
    allowProcessSpawn: Type.Boolean(),
    /**
     * Commands the runner may start, matched on `argv[0]`. Empty means every command is refused.
     *
     * A guardrail against a typo rather than a security control, and it is stated that way because it
     * reads like the second. Only the executable is checked, and the default list contains runners, so
     * `trace -- seorak` is refused while `trace -- npx seorak` runs. Checking further would not close it:
     * a runner's argument is any command, and `npm run`, `uv run` and `node -e` each take one.
     */
    allowedCommands: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type ExecutionConfig = Static<typeof ExecutionConfig>;

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

/**
 * What one million tokens of a model cost, in USD.
 *
 * Prices are configured rather than shipped. A table that ships goes stale the week a provider changes a price, and a
 * stale price turns a measurement into a wrong number reported with the authority of a measurement.
 */
export const TokenPrice = Type.Object(
  {
    inputPerMillion: NonNegativeNumber,
    outputPerMillion: NonNegativeNumber,
  },
  { additionalProperties: false },
);
export type TokenPrice = Static<typeof TokenPrice>;

/**
 * Prices keyed by `provider/model`, exactly as the run reported them, for example `openai/gpt-4o-mini`.
 *
 * A key that matches nothing observed costs nothing and is not an error: a table can carry the whole fleet while a
 * run exercises one model. A model observed with no matching key is reported without a cost rather than at zero.
 */
export const PricingConfig = Type.Record(NonEmptyString(), TokenPrice);
export type PricingConfig = Static<typeof PricingConfig>;

export const OrchescopeConfig = Document(
  schemaId('config'),
  SCHEMA_VERSIONS.config,
  Type.Object({
    projectName: Type.Optional(NonEmptyString()),
    analysis: AnalysisConfig,
    runtime: RuntimeConfig,
    report: ReportConfig,
    policy: PolicyConfig,
    execution: ExecutionConfig,
    redaction: RedactionConfig,
    pricing: PricingConfig,
  }),
);
export type OrchescopeConfig = Static<typeof OrchescopeConfig>;
