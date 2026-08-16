import { type Static, Type } from '@sinclair/typebox';
import { BenchmarkReport } from './benchmark.ts';
import { ChaosReport } from './chaos.ts';
import { Comparison } from './comparison.ts';
import { EvaluatorResult } from './evaluator.ts';
import { Evidence } from './evidence.ts';
import { Finding } from './finding.ts';
import { Goal } from './goal.ts';
import { SystemGraph } from './graph.ts';
import { ComponentId } from './identity.ts';
import {
  Document,
  literals,
  Metadata,
  NonEmptyString,
  NonNegativeInt,
  Timestamp,
} from './primitives.ts';
import { ReconciliationDelta } from './reconciliation.ts';
import { ComponentRunMetrics, RunRecord } from './run.ts';
import { Scenario } from './scenario.ts';
import { SCHEMA_VERSIONS, schemaId } from './version.ts';

/**
 * The report bundle is the single document the browser workspace reads. It is self contained so a
 * machine surfaces (`--json`, MCP) agree on the same facts.
 */

export const ScenarioRunSummary = Type.Object(
  {
    runId: NonEmptyString(),
    scenarioId: NonEmptyString(),
    scenarioName: NonEmptyString(),
    variantId: Type.Optional(NonEmptyString()),
    status: NonEmptyString(),
    taskSuccess: Type.Optional(Type.Boolean()),
    durationMs: Type.Number({ minimum: 0 }),
    evaluators: Type.Array(EvaluatorResult),
    faultsApplied: Type.Array(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type ScenarioRunSummary = Static<typeof ScenarioRunSummary>;

/** Overlay values per component, precomputed so the browser does not recompute aggregates. */
export const OverlayKind = literals([
  'architecture',
  'runtime_frequency',
  'latency',
  'cost',
  'tokens',
  'errors',
  'retries',
  'permissions',
  'resilience',
  'scenario_coverage',
] as const);
export type OverlayKind = Static<typeof OverlayKind>;

export const Overlay = Type.Object(
  {
    kind: OverlayKind,
    label: NonEmptyString(),
    unit: Type.Optional(NonEmptyString()),
    /** Absent value means the overlay has no data for that component, which the UI shows as unknown. */
    values: Type.Array(
      Type.Object(
        { componentId: ComponentId, value: Type.Number() },
        { additionalProperties: false },
      ),
    ),
    basis: NonEmptyString(),
    /** Explains what the overlay cannot show, for example that cost is estimated from token counts. */
    caveat: Type.Optional(NonEmptyString()),
  },
  { additionalProperties: false },
);
export type Overlay = Static<typeof Overlay>;

/**
 * Actions the workspace may offer. A capability that is false carries the reason, so the UI can
 * disable a control and explain why instead of presenting a button that does nothing.
 */
export const ReportCapability = Type.Object(
  {
    name: literals([
      'create_goal',
      'rerun_scenario',
      'run_benchmark',
      'run_chaos',
      'compare_runs',
      'open_source_location',
      'export_standalone',
      'model_interpretation',
      'cost_estimate',
    ] as const),
    available: Type.Boolean(),
    reason: NonEmptyString(),
  },
  { additionalProperties: false },
);
export type ReportCapability = Static<typeof ReportCapability>;

/**
 * What a goal's acceptance criteria decided at the moment this report was generated.
 *
 * Judged rather than stored, and carried per report rather than on the goal, because a judgement is
 * only ever true of a particular state of the store. A copy kept on the goal document would go stale
 * the next time anything was rerun, and the report is already the artifact that is pinned to a
 * revision. A criterion the evidence could not decide is `decided: false` and is never `satisfied`.
 */
export const GoalValidationSummary = Type.Object(
  {
    goalId: Type.String({ pattern: '^OSC-GOAL-\\d{4}$' }),
    /** True only when every criterion is satisfied, so one undecided criterion blocks the claim. */
    validated: Type.Boolean(),
    satisfiedCount: NonNegativeInt,
    undecidedCount: NonNegativeInt,
    summary: NonEmptyString(),
    /** The comparison that decided the metric criteria, absent when none was attached to the goal. */
    comparisonId: Type.Optional(NonEmptyString()),
    outcomes: Type.Array(
      Type.Object(
        {
          criterionId: Type.String({ pattern: '^AC-\\d{2}$' }),
          satisfied: Type.Boolean(),
          decided: Type.Boolean(),
          detail: NonEmptyString(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type GoalValidationSummary = Static<typeof GoalValidationSummary>;

export const ReportBundle = Document(
  schemaId('report'),
  SCHEMA_VERSIONS.report,
  Type.Object({
    reportId: Type.String({ pattern: '^rpt_[0-9a-f]{16}$' }),
    generatedAt: Timestamp,
    projectName: NonEmptyString(),
    graph: SystemGraph,
    /** The declared versus exercised delta. Present once at least one run has been ingested. */
    reconciliation: Type.Optional(ReconciliationDelta),
    findings: Type.Array(Finding),
    /** Evidence records referenced by anything in this bundle, deduplicated. */
    evidence: Type.Array(Evidence),
    runs: Type.Array(RunRecord),
    scenarios: Type.Array(Scenario),
    scenarioRuns: Type.Array(ScenarioRunSummary),
    componentMetrics: Type.Array(ComponentRunMetrics),
    overlays: Type.Array(Overlay),
    benchmarks: Type.Array(BenchmarkReport),
    chaosReports: Type.Array(ChaosReport),
    comparisons: Type.Array(Comparison),
    goals: Type.Array(Goal),
    /**
     * One entry per goal this report could judge. Optional because a bundle written by a build that
     * did not judge goals carries none, and a reader must not read that silence as a verdict.
     */
    goalValidations: Type.Optional(Type.Array(GoalValidationSummary)),
    capabilities: Type.Array(ReportCapability),
    /** Counts shown on the overview, computed once so the UI cannot disagree with the CLI. */
    summary: Type.Object(
      {
        componentCount: NonNegativeInt,
        edgeCount: NonNegativeInt,
        observedComponentCount: NonNegativeInt,
        staticOnlyComponentCount: NonNegativeInt,
        runtimeOnlyComponentCount: NonNegativeInt,
        /**
         * How many components are of a kind a trace can record. Optional because bundles written
         * before this field existed carry none; a reader falls back to `componentCount` and must not
         * invent the narrower set from the page. Computed in `packages/report` from the same
         * observable-kind rule the reconciliation uses, so the workspace never re-analyses kinds.
         */
        observableComponentCount: Type.Optional(NonNegativeInt),
        findingCountBySeverity: Type.Record(Type.String(), NonNegativeInt),
        strengthCount: NonNegativeInt,
        runCount: NonNegativeInt,
        /**
         * Runs that produced at least one span, which are the only runs anything measured rests on.
         *
         * A run is a record that a command executed. It is not a record that anything was observed:
         * a target with no OpenTelemetry SDK loaded exports nothing, and reading `runCount` as though
         * it answered this question is what let an audit report an exercise rate of zero percent for
         * a system whose tools had run. Optional because bundles written before this field existed
         * carry none, and a reader must not fall back to `runCount`, which answers a different
         * question.
         */
        observedRunCount: Type.Optional(NonNegativeInt),
        /** Runs recorded that produced no span. Reported so an empty run is visible rather than silently dropped. */
        silentRunCount: Type.Optional(NonNegativeInt),
        scenarioCount: NonNegativeInt,
      },
      { additionalProperties: false },
    ),
    metadata: Metadata,
  }),
);
export type ReportBundle = Static<typeof ReportBundle>;
