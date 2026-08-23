import { reportId as makeReportId } from '@orchescope/domain';
import { isObservableKind } from '@orchescope/graph';
import type { Redactor } from '@orchescope/redaction';
import { redactDeep } from '@orchescope/redaction';
import type {
  BenchmarkReport,
  ChaosReport,
  Comparison,
  ComponentRunMetrics,
  Evidence,
  Finding,
  Goal,
  GoalValidationSummary,
  ReconciliationDelta,
  ReportBundle,
  ReportCapability,
  RunRecord,
  Scenario,
  ScenarioRunSummary,
  SystemGraph,
  Timestamp,
} from '@orchescope/schema';
import { layoutGraph } from './layout.ts';
import { bakeLayouts, LAYOUT_RANK_KEY, MAP_LAYOUT_KEYS, MAP_LAYOUTS_KEY } from './layouts.ts';
import { buildOverlays } from './overlays.ts';
import { selectReportEvidence } from './evidence-selection.ts';

/**
 * Report bundle assembly.
 *
 * The bundle is the single document the browser workspace reads, so three things happen here and nowhere else:
 * layout positions are baked in, overlays are computed once so every surface agrees, and every string passes
 * through redaction on the way out. The bundle is also what the standalone export contains, which is why it has
 * to be self contained.
 */

export type CapabilityInput = {
  readonly canCreateGoal: boolean;
  readonly canRerunScenario: boolean;
  readonly canRunBenchmark: boolean;
  readonly canRunChaos: boolean;
  readonly canCompareRuns: boolean;
  readonly canOpenSourceLocation: boolean;
  readonly canExportStandalone: boolean;
  readonly modelInterpretationAvailable: boolean;
  readonly costEstimateAvailable: boolean;
  readonly reasons: Readonly<Record<ReportCapability['name'], string>>;
};

export type BuildBundleInput = {
  readonly graph: SystemGraph;
  readonly findings: readonly Finding[];
  readonly evidence: readonly Evidence[];
  /** Runs that produced at least one span. Everything measured in this bundle came from these. */
  readonly runs: readonly RunRecord[];
  /**
   * Runs that were recorded and produced no span.
   *
   * They join `runs` in the bundle, because a reader who has just traced something needs to see that
   * the run landed, and they are counted apart from it, because nothing here was measured by them.
   */
  readonly silentRuns: readonly RunRecord[];
  readonly scenarios: readonly Scenario[];
  readonly scenarioRuns: readonly ScenarioRunSummary[];
  readonly componentMetrics: readonly ComponentRunMetrics[];
  readonly benchmarks: readonly BenchmarkReport[];
  readonly chaosReports: readonly ChaosReport[];
  readonly comparisons: readonly Comparison[];
  readonly goals: readonly Goal[];
  /** What each goal's acceptance criteria decided, judged by the caller against the same store. */
  readonly goalValidations: readonly GoalValidationSummary[];
  readonly reconciliation: ReconciliationDelta | undefined;
  readonly capabilities: CapabilityInput;
  readonly generatedAt: Timestamp;
  readonly redactor: Redactor;
  readonly componentsByRun: ReadonlyMap<string, readonly string[]>;
};

const capabilityList = (input: CapabilityInput): readonly ReportCapability[] => {
  const entries: readonly (readonly [ReportCapability['name'], boolean])[] = [
    ['create_goal', input.canCreateGoal],
    ['rerun_scenario', input.canRerunScenario],
    ['run_benchmark', input.canRunBenchmark],
    ['run_chaos', input.canRunChaos],
    ['compare_runs', input.canCompareRuns],
    ['open_source_location', input.canOpenSourceLocation],
    ['export_standalone', input.canExportStandalone],
    ['model_interpretation', input.modelInterpretationAvailable],
    ['cost_estimate', input.costEstimateAvailable],
  ];
  return entries.map(([name, available]) => ({
    name,
    available,
    reason: input.reasons[name],
  }));
};

/**
 * Bakes every offered layout into the graph.
 *
 * One extra layout costs about 37 bytes for each component it positions: two keys and two coordinates.
 * At `pydantic-ai-exercised`, which positions 679 of its 1953 components, the two directional layouts
 * together are 51 KB on a 5.2 MB bundle, which is under one percent. Only positioned components pay, so
 * the reports that carry the most components are not the ones that pay the most.
 */
const withLayout = (graph: SystemGraph): SystemGraph => {
  const concentric = layoutGraph(graph);
  const baked = bakeLayouts(graph);
  return {
    ...graph,
    components: graph.components.map((component) => {
      const metadata = { ...component.metadata };
      let placed = false;
      for (const layout of baked) {
        const keys = MAP_LAYOUT_KEYS.find((candidate) => candidate.kind === layout.kind);
        const position = layout.positions.get(component.id);
        if (keys === undefined || position === undefined) continue;
        metadata[keys.x] = position.x;
        metadata[keys.y] = position.y;
        placed = true;
        const rank = layout.ranks?.get(component.id);
        if (rank !== undefined) metadata[LAYOUT_RANK_KEY] = rank;
      }
      return placed ? { ...component, metadata } : component;
    }),
    metadata: {
      ...graph.metadata,
      layoutWidth: concentric.width,
      layoutHeight: concentric.height,
      layoutFallback: concentric.fallback,
      [MAP_LAYOUTS_KEY]: baked.map((layout) => layout.kind),
    },
  };
};

export const buildReportBundle = (input: BuildBundleInput): ReportBundle => {
  const graph = withLayout(input.graph);
  const allRuns = [...input.runs, ...input.silentRuns];
  const observedRunIds = [...new Set(input.runs.map((run) => run.id))].sort();
  const silentRunIds = [...new Set(input.silentRuns.map((run) => run.id))].sort();
  const overlays = buildOverlays({
    graph,
    componentMetrics: input.componentMetrics,
    scenarioRuns: input.scenarioRuns,
    chaosReports: input.chaosReports,
    componentsByRun: input.componentsByRun,
  });

  const findingCountBySeverity: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  let strengthCount = 0;
  for (const finding of input.findings) {
    if (finding.polarity === 'strength') {
      strengthCount += 1;
      continue;
    }
    findingCountBySeverity[finding.severity] = (findingCountBySeverity[finding.severity] ?? 0) + 1;
  }

  const observed = graph.components.filter((component) => component.presence.runtime);
  const staticOnly = graph.components.filter(
    (component) => component.presence.static && !component.presence.runtime,
  );
  const runtimeOnly = graph.components.filter(
    (component) => component.presence.runtime && !component.presence.static,
  );
  const selectedEvidence = selectReportEvidence({
    evidence: input.evidence,
    graph,
    findings: input.findings,
    goals: input.goals,
    reconciliation: input.reconciliation,
  });

  const bundle: ReportBundle = {
    schemaVersion: 1,
    reportId: makeReportId({
      scanId: graph.provenance.scanId,
      generatedAt: input.generatedAt,
      runIds: allRuns.map((run) => run.id),
    }),
    generatedAt: input.generatedAt,
    projectName: graph.provenance.projectName,
    graph,
    ...(input.reconciliation === undefined ? {} : { reconciliation: input.reconciliation }),
    findings: [...input.findings],
    evidence: [...selectedEvidence.evidence],
    evidenceCoverage: selectedEvidence.coverage,
    runs: allRuns,
    runPopulations: {
      observed: {
        count: observedRunIds.length,
        runIds: observedRunIds,
      },
      silent: {
        count: silentRunIds.length,
        runIds: silentRunIds,
      },
    },
    scenarios: [...input.scenarios],
    scenarioRuns: [...input.scenarioRuns],
    componentMetrics: [...input.componentMetrics],
    overlays: [...overlays],
    benchmarks: [...input.benchmarks],
    chaosReports: [...input.chaosReports],
    comparisons: [...input.comparisons],
    goals: [...input.goals],
    goalValidations: [...input.goalValidations],
    capabilities: [...capabilityList(input.capabilities)],
    summary: {
      componentCount: graph.components.length,
      edgeCount: graph.edges.length,
      observedComponentCount: observed.length,
      staticOnlyComponentCount: staticOnly.length,
      runtimeOnlyComponentCount: runtimeOnly.length,
      observableComponentCount: graph.components.filter((component) =>
        isObservableKind(component.kind),
      ).length,
      findingCountBySeverity,
      strengthCount,
      runCount: allRuns.length,
      observedRunCount: observedRunIds.length,
      silentRunCount: silentRunIds.length,
      scenarioCount: input.scenarios.length,
    },
    metadata: {
      redactions: input.redactor.totalRedactions(),
    },
  };

  // Redaction runs last so that nothing added during assembly escapes it.
  return redactDeep(bundle, input.redactor);
};
