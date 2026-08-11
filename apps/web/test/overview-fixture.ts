import type { ReconciliationDelta, ReportBundle } from '@orchescope/schema';
import { bundle, component } from './fixture.ts';

export const delta = (overrides: Partial<ReconciliationDelta> = {}): ReconciliationDelta => ({
  declaredNotExercised: {
    components: ['agent:idle'],
    edges: [],
    runIds: ['run_0000000000000001'],
  },
  exercisedNotDeclared: { components: [], edges: [] },
  contradictions: [],
  duplicateSideEffects: [],
  joins: {
    byCodeLocation: 1,
    byRuntimeName: 0,
    byKindAndName: 0,
    onNameAlone: [],
    ambiguous: [],
  },
  coverage: {
    declaredComponents: 2,
    exercisedComponents: 1,
    declaredEdges: 0,
    exercisedEdges: 0,
    componentExerciseRate: 0.5,
    edgeExerciseRate: 0,
  },
  ...overrides,
});

export const reportWithRun = (overrides: Partial<ReportBundle> = {}): ReportBundle => {
  const report = bundle({
    graph: {
      ...bundle().graph,
      components: [
        component({
          id: 'agent:active',
          presence: { static: true, runtime: true, manifest: false },
        }),
        component({ id: 'agent:idle' }),
      ],
    },
    reconciliation: delta(),
    // A run record as well as a run count. `buildGraphIndex` decides whether runtime evidence exists
    // from the runs the bundle carries, not from the summary, so a fixture with a count and no run
    // reports every component as `no run to compare`.
    scenarioRuns: [
      {
        runId: 'run_0000000000000001',
        scenarioId: 'scenario-a',
        scenarioName: 'Scenario A',
        status: 'passed',
        durationMs: 10,
        evaluators: [],
        faultsApplied: [],
      },
    ],
    ...overrides,
  });
  return {
    ...report,
    summary: {
      ...report.summary,
      componentCount: report.graph.components.length,
      observedComponentCount: report.graph.components.filter(
        (candidate) => candidate.presence.runtime,
      ).length,
      staticOnlyComponentCount: report.graph.components.filter(
        (candidate) => candidate.presence.static && !candidate.presence.runtime,
      ).length,
      runtimeOnlyComponentCount: report.graph.components.filter(
        (candidate) => candidate.presence.runtime && !candidate.presence.static,
      ).length,
      runCount: 1,
      ...(overrides.summary ?? {}),
    },
  };
};
