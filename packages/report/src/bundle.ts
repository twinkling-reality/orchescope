import { reportId as makeReportId } from '@orchescope/domain';
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
import { buildOverlays } from './overlays.ts';

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
  readonly reasons: Readonly<Record<ReportCapability['name'], string>>;
};

export type BuildBundleInput = {
  readonly graph: SystemGraph;
  readonly findings: readonly Finding[];
  readonly evidence: readonly Evidence[];
  readonly runs: readonly RunRecord[];
  readonly scenarios: readonly Scenario[];
  readonly scenarioRuns: readonly ScenarioRunSummary[];
  readonly componentMetrics: readonly ComponentRunMetrics[];
  readonly benchmarks: readonly BenchmarkReport[];
  readonly chaosReports: readonly ChaosReport[];
  readonly comparisons: readonly Comparison[];
  readonly goals: readonly Goal[];
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
  ];
  return entries.map(([name, available]) => ({
    name,
    available,
    reason: input.reasons[name],
  }));
};

const withLayout = (graph: SystemGraph): SystemGraph => {
  const layout = layoutGraph(graph);
  return {
    ...graph,
    components: graph.components.map((component) => {
      const position = layout.positions.get(component.id);
      return position === undefined
        ? component
        : {
            ...component,
            metadata: { ...component.metadata, layoutX: position.x, layoutY: position.y },
          };
    }),
    metadata: {
      ...graph.metadata,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      layoutFallback: layout.fallback,
    },
  };
};

export const buildReportBundle = (input: BuildBundleInput): ReportBundle => {
  const graph = withLayout(input.graph);
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

  const bundle: ReportBundle = {
    schemaVersion: 1,
    reportId: makeReportId({
      scanId: graph.provenance.scanId,
      generatedAt: input.generatedAt,
      runIds: input.runs.map((run) => run.id),
    }),
    generatedAt: input.generatedAt,
    projectName: graph.provenance.projectName,
    graph,
    ...(input.reconciliation === undefined ? {} : { reconciliation: input.reconciliation }),
    findings: [...input.findings],
    evidence: [...input.evidence],
    runs: [...input.runs],
    scenarios: [...input.scenarios],
    scenarioRuns: [...input.scenarioRuns],
    componentMetrics: [...input.componentMetrics],
    overlays: [...overlays],
    benchmarks: [...input.benchmarks],
    chaosReports: [...input.chaosReports],
    comparisons: [...input.comparisons],
    goals: [...input.goals],
    capabilities: [...capabilityList(input.capabilities)],
    summary: {
      componentCount: graph.components.length,
      edgeCount: graph.edges.length,
      observedComponentCount: observed.length,
      staticOnlyComponentCount: staticOnly.length,
      runtimeOnlyComponentCount: runtimeOnly.length,
      findingCountBySeverity,
      strengthCount,
      runCount: input.runs.length,
      scenarioCount: input.scenarios.length,
    },
    metadata: {
      redactions: input.redactor.totalRedactions(),
    },
  };

  // Redaction runs last so that nothing added during assembly escapes it.
  return redactDeep(bundle, input.redactor);
};
