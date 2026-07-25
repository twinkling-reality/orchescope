/**
 * Derived indices over one report bundle.
 *
 * Nothing here invents a fact. Every relation is a lookup or a documented derivation, and where a
 * derivation is used the section that shows it says so, because a number whose provenance cannot be
 * stated is not worth showing.
 */

import type {
  Component,
  ComponentRunMetrics,
  Edge,
  Evidence,
  Finding,
  ReportBundle,
  RunRecord,
  Scenario,
  ScenarioRunSummary,
} from '@orchescope/schema';
import { type LayoutResult, resolveLayout } from './layout.ts';

export interface ComponentDescriptor {
  readonly displayName: string;
  readonly kind: string;
}

export interface GraphIndex {
  readonly componentsById: ReadonlyMap<string, Component>;
  readonly edgesById: ReadonlyMap<string, Edge>;
  readonly outgoing: ReadonlyMap<string, readonly Edge[]>;
  readonly incoming: ReadonlyMap<string, readonly Edge[]>;
  readonly metricsByComponent: ReadonlyMap<string, ComponentRunMetrics>;
  readonly findingsByComponent: ReadonlyMap<string, readonly Finding[]>;
  readonly evidenceById: ReadonlyMap<string, Evidence>;
  readonly runsById: ReadonlyMap<string, RunRecord>;
  readonly scenariosById: ReadonlyMap<string, Scenario>;
  readonly scenarioRunsByRunId: ReadonlyMap<string, ScenarioRunSummary>;
  /** Scenario identifiers whose runs produced evidence naming this component. Derived, not declared. */
  readonly scenarioIdsByComponent: ReadonlyMap<string, readonly string[]>;
  readonly runtimeOnly: ReadonlySet<string>;
  readonly neverExercised: ReadonlySet<string>;
  /** True when the report has runs, so absence of runtime evidence carries meaning. */
  readonly hasRuntimeEvidence: boolean;
  readonly componentKinds: readonly string[];
  readonly edgeKinds: readonly string[];
  readonly layout: LayoutResult;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const bucket = map.get(key);
  if (bucket === undefined) {
    map.set(key, [value]);
  } else {
    bucket.push(value);
  }
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function maxDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.max(left, right);
}

function sumDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return left + right;
}

/** Several runs can contribute rows for one component; counters add and the quantile takes the peak. */
function mergeMetrics(left: ComponentRunMetrics, right: ComponentRunMetrics): ComponentRunMetrics {
  const p95 = maxDefined(left.p95DurationMs, right.p95DurationMs);
  const cost = sumDefined(left.costUsd, right.costUsd);
  return {
    componentId: left.componentId,
    executionCount: left.executionCount + right.executionCount,
    selfDurationMs: left.selfDurationMs + right.selfDurationMs,
    totalDurationMs: left.totalDurationMs + right.totalDurationMs,
    ...(p95 === undefined ? {} : { p95DurationMs: p95 }),
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...(cost === undefined ? {} : { costUsd: cost }),
    errorCount: left.errorCount + right.errorCount,
    retryCount: left.retryCount + right.retryCount,
  };
}

function indexMetrics(
  rows: readonly ComponentRunMetrics[],
): ReadonlyMap<string, ComponentRunMetrics> {
  const merged = new Map<string, ComponentRunMetrics>();
  for (const row of rows) {
    const existing = merged.get(row.componentId);
    merged.set(row.componentId, existing === undefined ? row : mergeMetrics(existing, row));
  }
  return merged;
}

interface RunReference {
  readonly runIds: readonly string[];
  readonly scenarioIds: readonly string[];
}

function referencesOf(evidence: Evidence): RunReference {
  switch (evidence.kind) {
    case 'span':
    case 'metric':
    case 'fault_injection':
      return { runIds: [evidence.runId], scenarioIds: [] };
    case 'scenario_outcome':
      return { runIds: [evidence.runId], scenarioIds: [evidence.scenarioId] };
    default:
      return { runIds: [], scenarioIds: [] };
  }
}

interface ScenarioResolver {
  readonly evidenceById: ReadonlyMap<string, Evidence>;
  readonly runsById: ReadonlyMap<string, RunRecord>;
  readonly scenarioRunsByRunId: ReadonlyMap<string, ScenarioRunSummary>;
}

function scenarioIdsForRun(resolver: ScenarioResolver, runId: string): readonly string[] {
  const ids: string[] = [];
  const run = resolver.runsById.get(runId);
  if (run?.scenarioId !== undefined) {
    ids.push(run.scenarioId);
  }
  const scenarioRun = resolver.scenarioRunsByRunId.get(runId);
  if (scenarioRun !== undefined) {
    ids.push(scenarioRun.scenarioId);
  }
  return ids;
}

function scenarioIdsForComponent(
  resolver: ScenarioResolver,
  component: Component,
  incidentEdges: readonly Edge[],
): readonly string[] {
  const scenarioIds: string[] = [];
  const runIds: string[] = [];
  for (const evidenceId of component.evidence) {
    const evidence = resolver.evidenceById.get(evidenceId);
    if (evidence === undefined) {
      continue;
    }
    const reference = referencesOf(evidence);
    runIds.push(...reference.runIds);
    scenarioIds.push(...reference.scenarioIds);
  }
  for (const edge of incidentEdges) {
    runIds.push(...(edge.observation?.runIds ?? []));
  }
  for (const runId of sortedUnique(runIds)) {
    scenarioIds.push(...scenarioIdsForRun(resolver, runId));
  }
  return sortedUnique(scenarioIds);
}

function classifyPresence(
  components: readonly Component[],
  declaredNotExercised: readonly string[] | null,
  hasRuntimeEvidence: boolean,
): { runtimeOnly: ReadonlySet<string>; neverExercised: ReadonlySet<string> } {
  const runtimeOnly = new Set<string>();
  const neverExercised = new Set<string>();
  for (const component of components) {
    const { presence } = component;
    if (presence.runtime && !presence.static && !presence.manifest) {
      runtimeOnly.add(component.id);
    }
    if (declaredNotExercised === null && hasRuntimeEvidence && !presence.runtime) {
      neverExercised.add(component.id);
    }
  }
  if (declaredNotExercised !== null) {
    for (const id of declaredNotExercised) {
      neverExercised.add(id);
    }
  }
  return { runtimeOnly, neverExercised };
}

export function buildGraphIndex(bundle: ReportBundle): GraphIndex {
  const { components, edges } = bundle.graph;

  const componentsById = new Map(components.map((component) => [component.id, component]));
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const edge of edges) {
    push(outgoing, edge.from, edge);
    push(incoming, edge.to, edge);
  }

  const findingsByComponent = new Map<string, Finding[]>();
  for (const finding of bundle.findings) {
    for (const componentId of finding.components) {
      push(findingsByComponent, componentId, finding);
    }
  }

  const evidenceById = new Map(bundle.evidence.map((record) => [record.id, record]));
  const runsById = new Map(bundle.runs.map((run) => [run.id, run]));
  const scenariosById = new Map(bundle.scenarios.map((scenario) => [scenario.id, scenario]));
  const scenarioRunsByRunId = new Map(bundle.scenarioRuns.map((run) => [run.runId, run]));

  const resolver: ScenarioResolver = { evidenceById, runsById, scenarioRunsByRunId };
  const scenarioIdsByComponent = new Map<string, readonly string[]>();
  for (const component of components) {
    const incident = [...(outgoing.get(component.id) ?? []), ...(incoming.get(component.id) ?? [])];
    const ids = scenarioIdsForComponent(resolver, component, incident);
    if (ids.length > 0) {
      scenarioIdsByComponent.set(component.id, ids);
    }
  }

  const hasRuntimeEvidence = bundle.runs.length > 0 || bundle.scenarioRuns.length > 0;
  const declaredNotExercised = bundle.reconciliation?.declaredNotExercised.components ?? null;
  const { runtimeOnly, neverExercised } = classifyPresence(
    components,
    declaredNotExercised,
    hasRuntimeEvidence,
  );

  return {
    componentsById,
    edgesById,
    outgoing,
    incoming,
    metricsByComponent: indexMetrics(bundle.componentMetrics),
    findingsByComponent,
    evidenceById,
    runsById,
    scenariosById,
    scenarioRunsByRunId,
    scenarioIdsByComponent,
    runtimeOnly,
    neverExercised,
    hasRuntimeEvidence,
    componentKinds: sortedUnique(components.map((component) => component.kind)),
    edgeKinds: sortedUnique(edges.map((edge) => edge.kind)),
    layout: resolveLayout(components.map(({ id, metadata }) => ({ id, metadata }))),
  };
}

/** Falls back to the identifier when a reference points at a component the bundle does not carry. */
export function describeComponent(index: GraphIndex, componentId: string): ComponentDescriptor {
  const component = index.componentsById.get(componentId);
  if (component === undefined) {
    return { displayName: componentId, kind: 'unknown' };
  }
  return { displayName: component.displayName, kind: component.kind };
}

export function componentLabel(index: GraphIndex, componentId: string): string {
  return describeComponent(index, componentId).displayName;
}

export function resolveEvidence(
  index: GraphIndex,
  ids: readonly string[],
): { readonly resolved: readonly Evidence[]; readonly missing: readonly string[] } {
  const resolved: Evidence[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const record = index.evidenceById.get(id);
    if (record === undefined) {
      missing.push(id);
    } else {
      resolved.push(record);
    }
  }
  return { resolved, missing };
}
