import type {
  ChaosReport,
  ComponentRunMetrics,
  Overlay,
  ScenarioRunSummary,
  SystemGraph,
} from '@orchescope/schema';

/**
 * Overlay computation.
 *
 * Overlays are computed once here rather than in the browser, so the numbers in the graph, in the tables and in
 * the CLI summary cannot disagree. Each overlay carries its basis and, where the value is derived rather than
 * measured, a caveat that the interface shows next to the legend.
 *
 * A component with no data is absent from the values list rather than present with a zero. Zero is a
 * measurement, and absence is not the same thing.
 */

export type OverlayInput = {
  readonly graph: SystemGraph;
  readonly componentMetrics: readonly ComponentRunMetrics[];
  readonly scenarioRuns: readonly ScenarioRunSummary[];
  readonly chaosReports: readonly ChaosReport[];
  /** Component identifiers observed per run, used for the coverage overlay. */
  readonly componentsByRun: ReadonlyMap<string, readonly string[]>;
};

const sumByComponent = (
  metrics: readonly ComponentRunMetrics[],
  pick: (metric: ComponentRunMetrics) => number,
): ReadonlyMap<string, number> => {
  const totals = new Map<string, number>();
  for (const metric of metrics) {
    totals.set(metric.componentId, (totals.get(metric.componentId) ?? 0) + pick(metric));
  }
  return totals;
};

const toValues = (totals: ReadonlyMap<string, number>): Overlay['values'] =>
  [...totals]
    .sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([componentId, value]) => ({ componentId, value }));

const architectureOverlay = (input: OverlayInput): Overlay => ({
  kind: 'architecture',
  label: 'Declared and observed',
  values: input.graph.components.map((component) => ({
    componentId: component.id,
    value:
      component.presence.static && component.presence.runtime
        ? 2
        : component.presence.runtime
          ? 1
          : 0,
  })),
  basis: 'discovered',
  caveat: 'Two means declared and exercised, one means exercised only, zero means declared only.',
});

/**
 * Overlays derived from per component metrics.
 *
 * Cost is summed only over the components a price actually covered. A component that ran without a configured price
 * has no cost rather than a cost of zero, and putting it in the list at zero would read as free.
 */
const metricOverlays = (input: OverlayInput): readonly Overlay[] => {
  if (input.componentMetrics.length === 0) return [];
  const priced = input.componentMetrics.filter((metric) => metric.costUsd !== undefined);
  const costTotals = sumByComponent(priced, (metric) => metric.costUsd ?? 0);
  const overlays: Overlay[] = [
    {
      kind: 'runtime_frequency',
      label: 'Executions',
      unit: 'count',
      values: toValues(sumByComponent(input.componentMetrics, (metric) => metric.executionCount)),
      basis: 'observed',
    },
    {
      kind: 'latency',
      label: 'Self time',
      unit: 'ms',
      values: toValues(
        sumByComponent(input.componentMetrics, (metric) => Math.round(metric.selfDurationMs)),
      ),
      basis: 'observed',
      caveat: 'Self time excludes time spent inside child operations.',
    },
    {
      kind: 'tokens',
      label: 'Tokens',
      unit: 'tokens',
      values: toValues(
        sumByComponent(
          input.componentMetrics,
          (metric) => metric.inputTokens + metric.outputTokens,
        ),
      ),
      basis: 'observed',
    },
    {
      kind: 'errors',
      label: 'Errors',
      unit: 'count',
      values: toValues(sumByComponent(input.componentMetrics, (metric) => metric.errorCount)),
      basis: 'observed',
    },
    {
      kind: 'retries',
      label: 'Retries',
      unit: 'count',
      values: toValues(sumByComponent(input.componentMetrics, (metric) => metric.retryCount)),
      basis: 'observed',
    },
  ];
  if (costTotals.size > 0) {
    overlays.push({
      kind: 'cost',
      label: 'Cost',
      unit: 'usd',
      values: toValues(costTotals),
      basis: 'estimated',
      caveat:
        'Cost is derived from observed token counts and the price table this project configures. The generative AI conventions carry no cost attribute, so no cost here was measured, and a component whose model has no configured price is absent rather than free.',
    });
  }
  return overlays;
};

const permissionOverlay = (input: OverlayInput): readonly Overlay[] => {
  const totals = new Map<string, number>();
  for (const component of input.graph.components) {
    if (component.permissions.length === 0) continue;
    totals.set(
      component.id,
      component.permissions.filter((permission) => permission.mode !== 'read').length,
    );
  }
  if (totals.size === 0) return [];
  return [
    {
      kind: 'permissions',
      label: 'Write permissions',
      unit: 'count',
      values: toValues(totals),
      basis: 'discovered',
      caveat: 'Counted from declared permissions, not from what the component was observed doing.',
    },
  ];
};

/**
 * Behaviour under injected faults, worst outcome per component.
 *
 * The fault target is a name rather than an identifier, so it is matched against display names, and a component that
 * behaved well under one fault and badly under another keeps the worse score: resilience is the weakest case.
 */
const resilienceOverlay = (input: OverlayInput): readonly Overlay[] => {
  if (input.chaosReports.length === 0) return [];
  const resilience = new Map<string, number>();
  for (const report of input.chaosReports) {
    for (const outcome of report.outcomes) {
      const match = input.graph.components.find(
        (component) =>
          component.displayName === outcome.target ||
          component.identity.localName === outcome.target,
      );
      if (match === undefined) continue;
      const score = outcome.taskCompleted ? (outcome.duplicateSideEffects > 0 ? 1 : 2) : 0;
      const current = resilience.get(match.id);
      resilience.set(match.id, current === undefined ? score : Math.min(current, score));
    }
  }
  if (resilience.size === 0) return [];
  return [
    {
      kind: 'resilience',
      label: 'Behaviour under injected faults',
      values: toValues(resilience),
      basis: 'simulated',
      caveat:
        'Two means the task completed cleanly under the fault, one means it completed with a duplicated effect, zero means it did not complete.',
    },
  ];
};

const coverageOverlay = (input: OverlayInput): readonly Overlay[] => {
  if (input.componentsByRun.size === 0) return [];
  const coverage = new Map<string, number>();
  for (const componentIds of input.componentsByRun.values()) {
    for (const componentId of componentIds) {
      coverage.set(componentId, (coverage.get(componentId) ?? 0) + 1);
    }
  }
  return [
    {
      kind: 'scenario_coverage',
      label: 'Runs that exercised the component',
      unit: 'runs',
      values: toValues(coverage),
      basis: 'observed',
    },
  ];
};

export const buildOverlays = (input: OverlayInput): readonly Overlay[] => [
  architectureOverlay(input),
  ...metricOverlays(input),
  ...permissionOverlay(input),
  ...resilienceOverlay(input),
  ...coverageOverlay(input),
];
