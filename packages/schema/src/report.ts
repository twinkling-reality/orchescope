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
 * standalone HTML export shows exactly what the served report shows.
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
    capabilities: Type.Array(ReportCapability),
    /** Counts shown on the overview, computed once so the UI cannot disagree with the CLI. */
    summary: Type.Object(
      {
        componentCount: NonNegativeInt,
        edgeCount: NonNegativeInt,
        observedComponentCount: NonNegativeInt,
        staticOnlyComponentCount: NonNegativeInt,
        runtimeOnlyComponentCount: NonNegativeInt,
        findingCountBySeverity: Type.Record(Type.String(), NonNegativeInt),
        strengthCount: NonNegativeInt,
        runCount: NonNegativeInt,
        scenarioCount: NonNegativeInt,
      },
      { additionalProperties: false },
    ),
    metadata: Metadata,
  }),
);
export type ReportBundle = Static<typeof ReportBundle>;
