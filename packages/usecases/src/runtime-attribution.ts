import { estimateCost, type PriceTable } from '@orchescope/domain';
import type { ReconcileResult } from '@orchescope/graph';
import type { ComponentId, ComponentRunMetrics, PricingConfig } from '@orchescope/schema';
import { componentKey, type TopologyResult } from '@orchescope/traces';

/**
 * Attribution of observed metrics to declared components.
 *
 * A trace reports a name, and a name is not an identity. Deriving a topology therefore yields per component metrics
 * keyed by the name the run used, and only reconciliation against a scanned graph can say which component that name
 * belongs to. This is the step between the two, and it runs during an audit because that is the first point at which
 * both halves exist.
 */

export type ObservedMetrics = TopologyResult['componentMetricsByName'];

/**
 * Every observed name that now has a component, whether it joined a declaration or became one.
 *
 * A match is a name that met a declared component. A runtime only component is a name that met none and was added to
 * the graph as its own component, and its display name is the name the run reported. Both are attributable, and
 * leaving the second out would drop the metrics of exactly the components a reader is most curious about.
 */
export const observedKeyToComponentId = (
  reconciled: ReconcileResult,
): ReadonlyMap<string, ComponentId> => {
  const byKey = new Map<string, ComponentId>();
  for (const match of reconciled.matches) {
    byKey.set(componentKey(match.observedKind, match.observedName), match.componentId);
  }
  const runtimeOnly = new Set<string>(reconciled.runtimeOnlyComponentIds);
  for (const component of reconciled.graph.components) {
    if (!runtimeOnly.has(component.id)) continue;
    byKey.set(componentKey(component.kind, component.displayName), component.id);
  }
  return byKey;
};

/**
 * What a component's observed tokens cost, when a configured price says.
 *
 * The provider and the model come from the spans rather than from a declaration, because a price is about what
 * actually ran. A component that reported no tokens carries no cost even when a price exists: zero is a measurement
 * and this would not be one.
 */
const costOf = (
  pricing: PricingConfig,
  provider: string | undefined,
  model: string | undefined,
  usage: { readonly inputTokens: number; readonly outputTokens: number },
): { readonly costUsd?: number } => {
  if (usage.inputTokens === 0 && usage.outputTokens === 0) return {};
  const estimate = estimateCost(pricing as PriceTable, provider, model, usage);
  return estimate.known ? { costUsd: estimate.costUsd } : {};
};

/**
 * Resolves one run's observed metrics onto component identifiers.
 *
 * A name with no component is dropped rather than stored against a placeholder: the spans behind it are already
 * counted in the run totals and in the unattributed tally the topology reports, and a metric row pointing at nothing
 * would be a number no reader could trace back to anything.
 */
export const resolveComponentMetrics = (
  observed: ObservedMetrics,
  componentIdByKey: ReadonlyMap<string, ComponentId>,
  pricing: PricingConfig = {},
): readonly ComponentRunMetrics[] => {
  const byComponent = new Map<ComponentId, ComponentRunMetrics>();
  for (const metric of observed) {
    const componentId = componentIdByKey.get(componentKey(metric.kind, metric.observedName));
    if (componentId === undefined) continue;
    const current = byComponent.get(componentId);
    const { observedName: _name, kind: _kind, provider, model, ...counters } = metric;
    const cost = costOf(pricing, provider, model, counters);
    if (current === undefined) {
      byComponent.set(componentId, { ...counters, componentId, ...cost });
      continue;
    }
    // Two observed names can resolve to one component, and then the component ran as many times as both say.
    const costUsd =
      current.costUsd === undefined && cost.costUsd === undefined
        ? undefined
        : (current.costUsd ?? 0) + (cost.costUsd ?? 0);
    byComponent.set(componentId, {
      componentId,
      executionCount: current.executionCount + counters.executionCount,
      selfDurationMs: current.selfDurationMs + counters.selfDurationMs,
      totalDurationMs: current.totalDurationMs + counters.totalDurationMs,
      inputTokens: current.inputTokens + counters.inputTokens,
      outputTokens: current.outputTokens + counters.outputTokens,
      errorCount: current.errorCount + counters.errorCount,
      retryCount: current.retryCount + counters.retryCount,
      ...(costUsd === undefined ? {} : { costUsd }),
    });
  }
  return [...byComponent.values()];
};
