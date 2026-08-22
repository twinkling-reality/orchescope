import { quantile, sha256Hex, stableJson } from '@orchescope/domain';
import type {
  EdgeKind,
  EdgeObservation,
  Evidence,
  FederatedComponentJoin,
  FederatedComponentReference,
  FederatedRelation,
  FederatedRepository,
  FederationRefusal,
  FederationRefusalReason,
  FederationRefusalSample,
  FederationReport,
  MissingSpanAttribute,
  ObservedEdge,
  ObservedSource,
  RepositoryCoordinate,
  RuntimeTopology,
  SystemGraph,
} from '@orchescope/schema';
import { EDGE_KINDS } from '@orchescope/schema';
import { createSourceMatcher, type SourceMatcher } from './source-match.ts';

export type FederationGraphInput = {
  readonly graph: SystemGraph;
  readonly evidence: readonly Evidence[];
};

export type FederateInput = {
  readonly repositories: readonly FederationGraphInput[];
  readonly topologies: readonly RuntimeTopology[];
  readonly runtimeEvidence: readonly Evidence[];
  readonly orchescopeVersion: string;
  readonly generatedAt: string;
};

type EligibleRepository = FederatedRepository & { readonly matcher: SourceMatcher };

type RefusalAccumulator = {
  readonly scope: FederationRefusal['scope'];
  readonly reason: FederationRefusalReason;
  readonly attribute?: string;
  count: number;
  readonly samples: FederationRefusalSample[];
};

type Endpoint = {
  readonly observedKind: string;
  readonly observedName: string;
  readonly observedSource?: ObservedSource;
  readonly runIds: readonly string[];
};

type ResolvedEndpoint = {
  readonly reference: FederatedComponentReference;
  readonly source: ObservedSource;
};

const coordinateKey = (coordinate: RepositoryCoordinate): string =>
  `${coordinate.repositoryUrl}|${coordinate.revision}`;

const sourceKey = (source: ObservedSource): string => stableJson(source.identity);

const sampleKey = (sample: FederationRefusalSample): string => stableJson(sample);

const mergeEvidence = (records: readonly Evidence[]): Evidence[] => [
  ...new Map(records.map((record) => [record.id, record])).values(),
];

const canonicalRepositoryUrl = (value: string): string | undefined => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    if (parsed.username.length > 0 || parsed.password.length > 0) return undefined;
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\.git$/, '').replace(/\/$/, '');
    parsed.search = '';
    parsed.hash = '';
    if (parsed.pathname.length <= 1) return undefined;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

const edgeKind = (value: string): EdgeKind | undefined =>
  EDGE_KINDS.includes(value as EdgeKind) ? (value as EdgeKind) : undefined;

const observationFrom = (observed: ObservedEdge, runIds: readonly string[]): EdgeObservation => {
  const sorted = [...observed.durationsMs].sort((left, right) => left - right);
  const p50 = quantile(sorted, 0.5);
  const p95 = sorted.length >= 20 ? quantile(sorted, 0.95) : undefined;
  return {
    executionCount: observed.executionCount,
    errorCount: observed.errorCount,
    retryCount: observed.retryCount,
    parallelCount: observed.parallelCount,
    totalDurationMs: observed.totalDurationMs,
    ...(p50 === undefined ? {} : { p50DurationMs: p50 }),
    ...(p95 === undefined ? {} : { p95DurationMs: p95 }),
    ...(sorted.length === 0 ? {} : { maxDurationMs: sorted[sorted.length - 1] }),
    inputTokens: observed.inputTokens,
    outputTokens: observed.outputTokens,
    runIds: [...runIds],
  };
};

const aggregateSourceCoverage = (
  topologies: readonly RuntimeTopology[],
): MissingSpanAttribute[] => {
  const aggregated = new Map<string, MissingSpanAttribute>();
  for (const missing of topologies.flatMap((topology) => topology.coverage.missingSpanAttributes)) {
    const key = `${missing.purpose}|${missing.attribute}|${missing.reason ?? ''}`;
    const previous = aggregated.get(key);
    aggregated.set(key, {
      ...missing,
      observedComponents: (previous?.observedComponents ?? 0) + missing.observedComponents,
    });
  }
  return [...aggregated.values()].sort((left, right) => {
    const leftKey = `${left.purpose}|${left.attribute}|${left.reason ?? ''}`;
    const rightKey = `${right.purpose}|${right.attribute}|${right.reason ?? ''}`;
    return leftKey.localeCompare(rightKey);
  });
};

const repositoryCoordinate = (
  graph: SystemGraph,
):
  | { readonly coordinate: RepositoryCoordinate }
  | {
      readonly refusal: {
        readonly reason: FederationRefusalReason;
        readonly attribute: string;
        readonly sample: FederationRefusalSample;
      };
    } => {
  const git = graph.provenance.git;
  if (git?.repositoryUrl === undefined) {
    return {
      refusal: {
        reason: 'missing',
        attribute: 'provenance.git.repositoryUrl',
        sample: {},
      },
    };
  }
  const canonical = canonicalRepositoryUrl(git.repositoryUrl);
  if (canonical === undefined || canonical !== git.repositoryUrl) {
    return {
      refusal: {
        reason: 'invalid_path',
        attribute: 'provenance.git.repositoryUrl',
        sample: { repositoryUrl: git.repositoryUrl },
      },
    };
  }
  if (git.commit === undefined || !/^[0-9a-f]{40}$/.test(git.commit)) {
    return {
      refusal: {
        reason: 'missing',
        attribute: 'provenance.git.commit',
        sample: { repositoryUrl: canonical },
      },
    };
  }
  if (git.dirty) {
    return {
      refusal: {
        reason: 'repository_dirty',
        attribute: 'provenance.git.dirty',
        sample: { repositoryUrl: canonical, revision: git.commit },
      },
    };
  }
  return { coordinate: { repositoryUrl: canonical, revision: git.commit } };
};

const addRefusal = (
  refusals: Map<string, RefusalAccumulator>,
  input: {
    readonly scope: FederationRefusal['scope'];
    readonly reason: FederationRefusalReason;
    readonly attribute?: string;
    readonly count?: number;
    readonly sample?: FederationRefusalSample;
  },
): void => {
  const key = `${input.scope}|${input.reason}|${input.attribute ?? ''}`;
  const existing = refusals.get(key) ?? {
    scope: input.scope,
    reason: input.reason,
    ...(input.attribute === undefined ? {} : { attribute: input.attribute }),
    count: 0,
    samples: [],
  };
  existing.count += input.count ?? 1;
  if (
    input.sample !== undefined &&
    existing.samples.length < 10 &&
    !existing.samples.some(
      (sample) => sampleKey(sample) === sampleKey(input.sample as FederationRefusalSample),
    )
  ) {
    existing.samples.push(input.sample);
  }
  refusals.set(key, existing);
};

const eligibleRepositories = (
  inputs: readonly FederationGraphInput[],
  refusals: Map<string, RefusalAccumulator>,
): EligibleRepository[] => {
  const candidates: EligibleRepository[] = [];
  for (const input of inputs) {
    const resolved = repositoryCoordinate(input.graph);
    if ('refusal' in resolved) {
      addRefusal(refusals, {
        scope: 'repository',
        reason: resolved.refusal.reason,
        attribute: resolved.refusal.attribute,
        sample: resolved.refusal.sample,
      });
      continue;
    }
    candidates.push({
      coordinate: resolved.coordinate,
      graph: input.graph,
      matcher: createSourceMatcher(input.graph),
    });
  }

  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = coordinateKey(candidate.coordinate);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return candidates.filter((candidate) => {
    if (counts.get(coordinateKey(candidate.coordinate)) === 1) return true;
    addRefusal(refusals, {
      scope: 'repository',
      reason: 'ambiguous_source_mapping',
      attribute: 'repositoryCoordinate',
      sample: {
        repositoryUrl: candidate.coordinate.repositoryUrl,
        revision: candidate.coordinate.revision,
      },
    });
    return false;
  });
};

const endpointSample = (endpoint: Endpoint): FederationRefusalSample => ({
  ...(endpoint.runIds[0] === undefined ? {} : { runId: endpoint.runIds[0] }),
  observedKind: endpoint.observedKind,
  observedName: endpoint.observedName,
  ...(endpoint.observedSource === undefined
    ? {}
    : {
        repositoryUrl: endpoint.observedSource.identity.repositoryUrl,
        revision: endpoint.observedSource.identity.revision,
      }),
});

const resolveEndpoint = (
  repositories: readonly EligibleRepository[],
  endpoint: Endpoint,
  scope: FederationRefusal['scope'],
  refusals: Map<string, RefusalAccumulator>,
): ResolvedEndpoint | undefined => {
  const source = endpoint.observedSource;
  if (source === undefined) {
    addRefusal(refusals, {
      scope,
      reason: 'missing',
      attribute: 'observedSource',
      sample: endpointSample(endpoint),
    });
    return undefined;
  }

  const exact = repositories.find(
    (repository) =>
      repository.coordinate.repositoryUrl === source.identity.repositoryUrl &&
      repository.coordinate.revision === source.identity.revision,
  );
  if (exact === undefined) {
    const repositoryPresent = repositories.some(
      (repository) => repository.coordinate.repositoryUrl === source.identity.repositoryUrl,
    );
    addRefusal(refusals, {
      scope,
      reason: repositoryPresent ? 'revision_mismatch' : 'repository_mismatch',
      attribute: repositoryPresent ? 'vcs.ref.head.revision' : 'vcs.repository.url.full',
      sample: endpointSample(endpoint),
    });
    return undefined;
  }

  const matched = exact.matcher.match({
    observedKind: endpoint.observedKind,
    observedName: endpoint.observedName,
    observedSource: source,
  });
  if (matched.kind !== 'matched') {
    addRefusal(refusals, {
      scope,
      reason: matched.refusal.reason,
      attribute: matched.refusal.attribute,
      sample: endpointSample(endpoint),
    });
    return undefined;
  }
  return {
    reference: { repository: exact.coordinate, componentId: matched.component.id },
    source,
  };
};

const projectRefusals = (refusals: ReadonlyMap<string, RefusalAccumulator>): FederationRefusal[] =>
  [...refusals.values()]
    .map((refusal) => ({
      scope: refusal.scope,
      reason: refusal.reason,
      ...(refusal.attribute === undefined ? {} : { attribute: refusal.attribute }),
      count: refusal.count,
      samples: refusal.samples,
    }))
    .sort((left, right) => {
      const leftKey = `${left.scope}|${left.reason}|${left.attribute ?? ''}`;
      const rightKey = `${right.scope}|${right.reason}|${right.attribute ?? ''}`;
      return leftKey.localeCompare(rightKey);
    });

const addComponentJoin = (
  joins: Map<string, FederatedComponentJoin>,
  endpoint: Endpoint & { readonly observedSource: ObservedSource },
  resolved: ResolvedEndpoint,
  evidence: readonly string[],
): void => {
  const key = `${coordinateKey(resolved.reference.repository)}|${resolved.reference.componentId}|${sourceKey(resolved.source)}`;
  const previous = joins.get(key);
  joins.set(key, {
    component: resolved.reference,
    observedKind: endpoint.observedKind,
    observedName: endpoint.observedName,
    observedSource: resolved.source,
    rule: 'code_location',
    runIds: [...new Set([...(previous?.runIds ?? []), ...endpoint.runIds])],
    evidence: [...new Set([...(previous?.evidence ?? []), ...evidence])],
  });
};

const hasIndependentRelationEvidence = (edge: ObservedEdge): boolean =>
  edge.provenance.relation.spanFields.includes('parentSpanId');

type FederationState = {
  readonly repositories: readonly EligibleRepository[];
  readonly refusals: Map<string, RefusalAccumulator>;
  readonly componentJoins: Map<string, FederatedComponentJoin>;
  readonly relations: FederatedRelation[];
  observedComponents: number;
  observedRelations: number;
  withinRepositoryRelations: number;
};

const observedEndpoint = (input: {
  readonly kind: string;
  readonly name: string;
  readonly source: ObservedSource | undefined;
  readonly runIds: readonly string[];
}): Endpoint => ({
  observedKind: input.kind,
  observedName: input.name,
  ...(input.source === undefined ? {} : { observedSource: input.source }),
  runIds: input.runIds,
});

const visitComponent = (
  state: FederationState,
  topology: RuntimeTopology,
  component: RuntimeTopology['components'][number],
): void => {
  state.observedComponents += 1;
  const endpoint = observedEndpoint({
    kind: component.kind,
    name: component.observedName,
    source: component.observedSource,
    runIds: topology.runIds,
  });
  const resolved = resolveEndpoint(state.repositories, endpoint, 'component', state.refusals);
  if (resolved === undefined || component.observedSource === undefined) return;
  addComponentJoin(
    state.componentJoins,
    { ...endpoint, observedSource: component.observedSource },
    resolved,
    component.evidence,
  );
};

const relationSample = (topology: RuntimeTopology, observed: ObservedEdge) => ({
  ...(topology.runIds[0] === undefined ? {} : { runId: topology.runIds[0] }),
  relationKind: observed.kind,
});

const resolvedRelation = (
  state: FederationState,
  topology: RuntimeTopology,
  observed: ObservedEdge,
  from: ResolvedEndpoint,
  to: ResolvedEndpoint,
): FederatedRelation | undefined => {
  if (coordinateKey(from.reference.repository) === coordinateKey(to.reference.repository)) {
    state.withinRepositoryRelations += 1;
    return undefined;
  }
  if (!hasIndependentRelationEvidence(observed)) {
    addRefusal(state.refusals, {
      scope: 'relation',
      reason: 'relation_evidence_missing',
      attribute: 'parentSpanId',
      sample: relationSample(topology, observed),
    });
    return undefined;
  }
  const kind = edgeKind(observed.kind);
  if (kind === undefined) {
    addRefusal(state.refusals, {
      scope: 'relation',
      reason: 'source_not_declared',
      attribute: 'kind',
      sample: relationSample(topology, observed),
    });
    return undefined;
  }
  return {
    kind,
    from: from.reference,
    to: to.reference,
    fromObservedSource: from.source,
    toObservedSource: to.source,
    observation: observationFrom(observed, topology.runIds),
    evidence: observed.evidence,
    provenance: observed.provenance,
  };
};

const visitRelation = (
  state: FederationState,
  topology: RuntimeTopology,
  observed: ObservedEdge,
): void => {
  state.observedRelations += 1;
  const fromEndpoint = observedEndpoint({
    kind: observed.fromKind,
    name: observed.fromObservedName,
    source: observed.fromObservedSource,
    runIds: topology.runIds,
  });
  const toEndpoint = observedEndpoint({
    kind: observed.toKind,
    name: observed.toObservedName,
    source: observed.toObservedSource,
    runIds: topology.runIds,
  });
  const from = resolveEndpoint(state.repositories, fromEndpoint, 'relation', state.refusals);
  const to = resolveEndpoint(state.repositories, toEndpoint, 'relation', state.refusals);
  if (from === undefined || to === undefined) {
    addRefusal(state.refusals, {
      scope: 'relation',
      reason: 'endpoint_refused',
      attribute: 'endpoints',
      sample: relationSample(topology, observed),
    });
    return;
  }
  const relation = resolvedRelation(state, topology, observed, from, to);
  if (relation !== undefined) state.relations.push(relation);
};

/**
 * Federates separately scanned graphs against runtime topologies without weakening source reconciliation.
 *
 * The repository list selects what may be considered. Only the observed source on each endpoint selects
 * what actually participated, and only independent parent context establishes a cross-repository edge.
 */
export const federate = (input: FederateInput): FederationReport => {
  const refusalState = new Map<string, RefusalAccumulator>();
  const repositories = eligibleRepositories(input.repositories, refusalState);
  const state: FederationState = {
    repositories,
    refusals: refusalState,
    componentJoins: new Map(),
    relations: [],
    observedComponents: 0,
    observedRelations: 0,
    withinRepositoryRelations: 0,
  };

  for (const topology of input.topologies) {
    for (const component of topology.components) visitComponent(state, topology, component);
    for (const observed of topology.edges) visitRelation(state, topology, observed);
  }

  const projectedRepositories = repositories
    .map(({ coordinate, graph }) => ({ coordinate, graph }))
    .sort((left, right) =>
      coordinateKey(left.coordinate).localeCompare(coordinateKey(right.coordinate)),
    );
  const projectedJoins = [...state.componentJoins.values()].sort((left, right) => {
    const leftKey = `${coordinateKey(left.component.repository)}|${left.component.componentId}`;
    const rightKey = `${coordinateKey(right.component.repository)}|${right.component.componentId}`;
    return leftKey.localeCompare(rightKey);
  });
  state.relations.sort((left, right) => {
    const leftKey = `${left.kind}|${coordinateKey(left.from.repository)}|${left.from.componentId}|${coordinateKey(left.to.repository)}|${left.to.componentId}`;
    const rightKey = `${right.kind}|${coordinateKey(right.from.repository)}|${right.from.componentId}|${coordinateKey(right.to.repository)}|${right.to.componentId}`;
    return leftKey.localeCompare(rightKey);
  });
  const runIds = [...new Set(input.topologies.flatMap((topology) => topology.runIds))].sort();
  const federationId = `fed_${sha256Hex(
    stableJson({
      repositories: projectedRepositories.map((repository) => repository.coordinate),
      runIds,
    }),
  ).slice(0, 16)}`;

  return {
    schemaVersion: 1,
    federationId,
    generatedAt: input.generatedAt,
    orchescopeVersion: input.orchescopeVersion,
    repositories: projectedRepositories,
    componentJoins: projectedJoins,
    relations: state.relations,
    evidence: mergeEvidence([
      ...input.repositories.flatMap((repository) => repository.evidence),
      ...input.runtimeEvidence,
    ]),
    coverage: {
      repositoriesSupplied: input.repositories.length,
      eligibleRepositories: projectedRepositories.length,
      observedComponents: state.observedComponents,
      joinedComponents: projectedJoins.length,
      observedRelations: state.observedRelations,
      withinRepositoryRelations: state.withinRepositoryRelations,
      joinedCrossRepositoryRelations: state.relations.length,
      sourceIdentity: aggregateSourceCoverage(input.topologies),
      refusals: projectRefusals(refusalState),
    },
    metadata: { runIds },
  };
};
