import { type Static, Type } from '@sinclair/typebox';
import { FaultSpec } from './chaos.ts';
import { EffectExpectation, Evaluator } from './evaluator.ts';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  NonNegativeNumber,
  PositiveInt,
  RelativePath,
} from './primitives.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * Scenario definitions are authored as YAML and validated against this schema before anything is
 * executed. A scenario describes how to run the target system once, what to vary, what must be true
 * afterwards and what the run is allowed to consume.
 */

/**
 * How the target reports its own outcome. Both mechanisms are documented protocols rather than
 * guesses: the target either writes the JSON result file whose path Orchescope passes in
 * `ORCHESCOPE_RESULT_FILE`, or annotates its root span with `orchescope.task.*` attributes.
 */
export const ResultSource = literals(['result_file', 'root_span', 'exit_code'] as const);
export type ResultSource = Static<typeof ResultSource>;

export const ScenarioTarget = Type.Object(
  {
    command: Type.Array(NonEmptyString(), {
      minItems: 1,
      description:
        'Argv of the target. Executed without a shell, so no shell metacharacters apply.',
    }),
    cwd: Type.Optional(RelativePath),
    env: Type.Optional(
      Type.Record(Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }), Type.String()),
    ),
    resultSource: ResultSource,
    /** Wall clock ceiling for one repetition. Exceeding it marks the run `timeout`. */
    timeoutMs: PositiveInt,
    /** Signal used to stop the target on timeout or cancellation before escalating to SIGKILL. */
    stopSignal: Type.Optional(literals(['SIGINT', 'SIGTERM'] as const)),
  },
  { additionalProperties: false },
);
export type ScenarioTarget = Static<typeof ScenarioTarget>;

/**
 * Dimensions a scenario or benchmark may vary. Each dimension is passed to the target as an
 * `ORCHESCOPE_*` environment variable so that a target can honour it without linking to Orchescope.
 */
export const ScenarioVariant = Type.Object(
  {
    id: Type.Optional(NonEmptyString()),
    agents: Type.Optional(PositiveInt),
    workers: Type.Optional(PositiveInt),
    concurrency: Type.Optional(PositiveInt),
    topology: Type.Optional(
      NonEmptyString({ description: 'Named topology understood by the target.' }),
    ),
    model: Type.Optional(
      Type.Object(
        {
          provider: NonEmptyString(),
          model: NonEmptyString(),
          temperature: Type.Optional(Type.Number()),
        },
        { additionalProperties: false },
      ),
    ),
    promptVersion: Type.Optional(NonEmptyString()),
    toolConfig: Type.Optional(NonEmptyString()),
    /** Extra environment entries for this variant only. */
    env: Type.Optional(
      Type.Record(Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }), Type.String()),
    ),
  },
  { additionalProperties: false },
);
export type ScenarioVariant = Static<typeof ScenarioVariant>;

export const ScenarioBudgets = Type.Object(
  {
    maxDurationMs: Type.Optional(NonNegativeNumber),
    maxCostUsd: Type.Optional(NonNegativeNumber),
    maxTokens: Type.Optional(NonNegativeInt),
    maxRetries: Type.Optional(NonNegativeInt),
    maxModelCalls: Type.Optional(NonNegativeInt),
  },
  { additionalProperties: false },
);
export type ScenarioBudgets = Static<typeof ScenarioBudgets>;

/**
 * Permissions a scenario needs. The runner refuses a scenario whose requirements exceed what the
 * user granted, and never silently downgrades to a weaker mode.
 */
export const ScenarioPermission = literals([
  'process:spawn',
  'network:loopback',
  'network:outbound',
  'model:paid',
  'filesystem:write',
] as const);
export type ScenarioPermission = Static<typeof ScenarioPermission>;

export const Scenario = Document(
  schemaId('scenario'),
  SCHEMA_VERSIONS.scenario,
  Type.Object({
    id: Type.String({ pattern: '^[a-z0-9][a-z0-9-]{1,63}$' }),
    name: NonEmptyString(),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    target: ScenarioTarget,
    input: Type.Optional(
      Type.Object(
        {
          prompt: Type.Optional(Type.String({ maxLength: 8000 })),
          data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
        },
        { additionalProperties: false },
      ),
    ),
    initialState: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    variant: Type.Optional(ScenarioVariant),
    expect: Type.Optional(
      Type.Object(
        {
          taskSuccess: Type.Optional(Type.Boolean()),
          requiredEffects: Type.Optional(Type.Array(EffectExpectation)),
          prohibitedEffects: Type.Optional(Type.Array(EffectExpectation)),
        },
        { additionalProperties: false },
      ),
    ),
    evaluators: Type.Array(Evaluator),
    budgets: ScenarioBudgets,
    faults: Type.Array(FaultSpec),
    cleanup: Type.Optional(
      Type.Object(
        { command: Type.Array(NonEmptyString(), { minItems: 1 }) },
        { additionalProperties: false },
      ),
    ),
    /** Deterministic seed handed to the target as ORCHESCOPE_SEED. */
    seed: Type.Optional(NonNegativeInt),
    repetitions: Type.Optional(PositiveInt),
    requiredPermissions: Type.Array(ScenarioPermission),
    tags: Type.Array(NonEmptyString()),
    metadata: Metadata,
  }),
);
export type Scenario = Static<typeof Scenario>;
