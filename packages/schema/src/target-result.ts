import { type Static, Type } from '@sinclair/typebox';
import { literals, Metadata, NonEmptyString, NonNegativeInt } from './primitives.ts';

/**
 * The target result protocol.
 *
 * A system under test reports its own outcome in one of two documented ways: it writes this JSON document
 * to the path Orchescope passes in `ORCHESCOPE_RESULT_FILE`, or it sets `orchescope.task.*` attributes on
 * its root span. The file form exists so that a target with no tracing at all can still be evaluated.
 *
 * This document arrives from a process Orchescope does not control, so it is validated before use and
 * every field is bounded.
 */
export const TargetResult = Type.Object(
  {
    success: Type.Boolean(),
    output: Type.Optional(Type.String({ maxLength: 20_000 })),
    effects: Type.Optional(
      Type.Array(
        Type.Object(
          {
            kind: NonEmptyString(),
            target: NonEmptyString(),
            idempotencyKey: Type.Optional(NonEmptyString()),
            outcome: Type.Optional(
              literals(['succeeded', 'failed', 'partial', 'unknown'] as const),
            ),
          },
          { additionalProperties: false },
        ),
        { maxItems: 500 },
      ),
    ),
    userInterventions: Type.Optional(NonNegativeInt),
    policyViolations: Type.Optional(NonNegativeInt),
    loopIterations: Type.Optional(NonNegativeInt),
    metadata: Type.Optional(Metadata),
  },
  { additionalProperties: false },
);
export type TargetResult = Static<typeof TargetResult>;

/**
 * Environment variables Orchescope passes to a target. A target that honours the variables it recognises
 * and ignores the rest is fully supported: none of them are required.
 */
export const TARGET_ENV = {
  /** OTLP endpoint of the local receiver, also exported as the standard OpenTelemetry variable. */
  endpoint: 'ORCHESCOPE_OTLP_ENDPOINT',
  /**
   * Absolute path of the repository this run is an audit of.
   *
   * Passed rather than inferred. The working directory is not this path: a scenario may name any
   * subdirectory of the repository as its own, and `NODE_OPTIONS` reaches every process the target
   * spawns, so a shim reading `process.cwd()` would answer for whichever descendant it happened to load
   * into. Absent means no answer rather than a guess.
   */
  repositoryRoot: 'ORCHESCOPE_REPOSITORY_ROOT',
  resultFile: 'ORCHESCOPE_RESULT_FILE',
  runId: 'ORCHESCOPE_RUN_ID',
  seed: 'ORCHESCOPE_SEED',
  agents: 'ORCHESCOPE_AGENTS',
  workers: 'ORCHESCOPE_WORKERS',
  concurrency: 'ORCHESCOPE_CONCURRENCY',
  topology: 'ORCHESCOPE_TOPOLOGY',
  promptVersion: 'ORCHESCOPE_PROMPT_VERSION',
  toolConfig: 'ORCHESCOPE_TOOL_CONFIG',
  modelProvider: 'ORCHESCOPE_MODEL_PROVIDER',
  model: 'ORCHESCOPE_MODEL',
  input: 'ORCHESCOPE_INPUT',
  initialState: 'ORCHESCOPE_INITIAL_STATE',
  faultPlan: 'ORCHESCOPE_FAULT_PLAN',
  scenarioId: 'ORCHESCOPE_SCENARIO_ID',
} as const;
