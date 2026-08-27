import {
  absenceEvidence,
  componentId as buildComponentId,
  edgeId as buildEdgeId,
  derivedEvidence,
  identityFingerprint,
  metricEvidence,
  normalizeLocalName,
  quantile,
  runtimeIdentity,
  strongerBasis,
} from '@orchescope/domain';
import type {
  Component,
  ComponentId,
  ComponentKind,
  Edge,
  EdgeKind,
  EdgeObservation,
  Evidence,
  EvidenceId,
  MissingSpanAttribute,
  ObservedComponent,
  ObservedEdge,
  ObservedSource,
  ObservedValueProvenance,
  RuntimeTopology,
  Sha256Hex,
  SystemGraph,
} from '@orchescope/schema';
import { createSourceMatcher, type SourceMatcher } from './source-match.ts';

/**
 * Reconciliation between the declared system and the observed system.
 *
 * This is the operation neither a tracing backend nor a source scanner can perform alone. A tracing
 * backend cannot see a component that never ran; a scanner cannot see a component that ran without
 * being declared. Reconciliation joins the two, records how each match was made, and refuses to
 * guess when a match is ambiguous.
 *
 * Match rules, strongest first:
 *  1. `code_location`  the span carried OpenTelemetry code.* attributes that resolve to the module a
 *     component was discovered in, and the names agree.
 *  2. `runtime_name`   a manifest declared the name the running system reports for this component.
 *  3. `kind_and_name`  exactly one declared component of that kind carries that normalised name.
 * Anything else stays unmatched and becomes a runtime only component, which is a finding rather than
 * a failure.
 */

export type MatchRule = 'code_location' | 'runtime_name' | 'kind_and_name';

export type ComponentMatch = {
  readonly observedName: string;
  readonly observedKind: string;
  readonly observedSource?: ObservedSource;
  readonly componentId: ComponentId;
  readonly rule: MatchRule;
};

export type AmbiguousMatch = {
  readonly observedName: string;
  readonly observedKind: string;
  readonly candidates: readonly ComponentId[];
};

export type ReconcileResult = {
  readonly graph: SystemGraph;
  readonly evidence: readonly Evidence[];
  readonly matches: readonly ComponentMatch[];
  readonly ambiguous: readonly AmbiguousMatch[];
  readonly runtimeOnlyComponentIds: readonly ComponentId[];
  readonly missingSpanAttributes: readonly MissingSpanAttribute[];
  readonly behavior: ReconcileBehavior;
};

export type RelationRefusalReason =
  | 'relation_rederived_from_endpoint_evidence'
  | 'endpoint_identity_unresolved'
  | 'no_exact_declared_relation';

export type ReconcileBehavior = {
  readonly status: 'complete' | 'incomplete';
  readonly acceptedSpans: number;
  readonly droppedSpans: number;
  readonly rejectedSpans: number;
  readonly executedComponents: number;
  readonly componentExecutions: number;
  readonly executedByKind: readonly { readonly kind: string; readonly count: number }[];
  readonly observedStructuralRelations: number;
  readonly qualifiedDeclaredRelations: number;
  readonly refusals: readonly {
    readonly reason: RelationRefusalReason;
    readonly count: number;
    readonly evidence: readonly EvidenceId[];
    readonly evidenceOmitted: number;
  }[];
  readonly noIndependentRelationObservation: boolean;
  readonly populationEvidence?: EvidenceId;
  readonly evidence: readonly EvidenceId[];
  readonly evidenceOmitted: number;
};

const PRODUCER = 'reconciler';

type StaticLookups = {
  readonly byId: Map<ComponentId, Component>;
  readonly sourceMatcher: SourceMatcher;
  readonly byKindAndName: Map<string, Component[]>;
  /**
   * Indexed by the last path segment of the name. A model is declared as `gpt-4o-mini` in one repository and reported
   * as `openai/gpt-4o-mini` at runtime, or the reverse, and both spellings mean the same model.
   */
  readonly byKindAndBareName: Map<string, Component[]>;
  readonly byRuntimeName: Map<string, Component[]>;
  readonly usedIds: Set<string>;
};

const bareName = (name: string): string => {
  const slash = name.lastIndexOf('/');
  return slash < 0 ? name : name.slice(slash + 1);
};

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [value]);
  else bucket.push(value);
};

const buildLookups = (graph: SystemGraph): StaticLookups => {
  const lookups: StaticLookups = {
    byId: new Map(),
    sourceMatcher: createSourceMatcher(graph),
    byKindAndName: new Map(),
    byKindAndBareName: new Map(),
    byRuntimeName: new Map(),
    usedIds: new Set(),
  };
  for (const component of graph.components) {
    lookups.byId.set(component.id, component);
    lookups.usedIds.add(component.id);
    const name = component.identity.localName;
    push(lookups.byKindAndName, `${component.kind}|${name}`, component);
    push(lookups.byKindAndBareName, `${component.kind}|${bareName(name)}`, component);
    const runtimeName = component.metadata['runtimeName'];
    if (typeof runtimeName === 'string' && runtimeName.length > 0) {
      push(
        lookups.byRuntimeName,
        `${component.kind}|${normalizeLocalName(runtimeName)}`,
        component,
      );
    }
  }
  return lookups;
};

const uniqueCandidate = (candidates: readonly Component[] | undefined): Component | undefined => {
  if (candidates === undefined) return undefined;
  const distinct = [...new Map(candidates.map((component) => [component.id, component])).values()];
  return distinct.length === 1 ? distinct[0] : undefined;
};

type Resolution =
  | {
      readonly kind: 'matched';
      readonly component: Component;
      readonly rule: MatchRule;
      readonly refusals: readonly MissingSpanAttribute[];
    }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly ComponentId[];
      readonly refusals: readonly MissingSpanAttribute[];
    }
  | { readonly kind: 'unmatched'; readonly refusals: readonly MissingSpanAttribute[] };

const sourceRefusal = (
  attribute: string,
  reason: NonNullable<MissingSpanAttribute['reason']>,
  evidence: readonly EvidenceId[],
): MissingSpanAttribute => ({
  attribute,
  purpose: 'source_identity',
  reason,
  observedComponents: 1,
  ...(evidence[0] === undefined ? {} : { evidence: [evidence[0]] }),
  ...(evidence[0] === undefined ? { evidenceOmitted: 1 } : {}),
});

const sourceCandidates = (
  lookups: StaticLookups,
  observed: ObservedComponent,
  name: string,
): Resolution => {
  const source = observed.observedSource;
  if (source === undefined) return { kind: 'unmatched', refusals: [] };
  const result = lookups.sourceMatcher.match({
    observedKind: observed.kind,
    observedName: name,
    observedSource: source,
  });
  if (result.kind === 'matched') {
    return {
      kind: 'matched',
      component: result.component,
      rule: 'code_location',
      // A part of the location that did not corroborate is still coverage, even where the match held.
      refusals:
        result.refusal === undefined
          ? []
          : [
              sourceRefusal(
                result.refusal.attribute,
                result.refusal.reason,
                observed.evidence as EvidenceId[],
              ),
            ],
    };
  }
  const refusals = [
    sourceRefusal(
      result.refusal.attribute,
      result.refusal.reason,
      observed.evidence as EvidenceId[],
    ),
  ];
  if (result.kind === 'ambiguous') {
    return {
      kind: 'ambiguous',
      candidates: result.candidates,
      refusals,
    };
  }
  return { kind: 'unmatched', refusals };
};

/**
 * Whether a refused source identity may still be judged by name.
 *
 * A source identity that cannot select a declaration says one of two very different things, and the
 * difference decides whether the weaker rules are allowed a turn.
 *
 * `repository_mismatch` and `revision_mismatch` say the run was about **other code**: another remote, or
 * another commit, or a working tree that had moved. Joining that to this checkout's declaration by name
 * would attribute one repository's execution to another's source, so those stay unmatched, and two tests
 * pin it by name. `ambiguous_source_mapping` says two declarations matched, which is the ambiguity the
 * location existed to break, so falling back to the name that could not break it either is no better.
 *
 * `source_not_declared` says the run was about **this** code and the location merely failed to select:
 * the file holds no declaration of that kind and name. That is the ordinary case for a call site, which
 * is where a call was made rather than where a component was declared, and refusing the name rules over
 * it would make a span carrying more evidence join to less than the same span carrying none. The refusal
 * is still recorded, so coverage says the location was read and did not settle it.
 *
 * `line_outside_declaration` is named here for completeness and does not reach this decision: the
 * matcher treats a line that eliminates every candidate as a part that did not corroborate rather than
 * as a veto, so it arrives either on a match or on an ambiguity, never on a refusal.
 */
const REFUSALS_ABOUT_OTHER_CODE: ReadonlySet<NonNullable<MissingSpanAttribute['reason']>> = new Set(
  ['repository_mismatch', 'revision_mismatch', 'ambiguous_source_mapping'],
);

const namesOtherCode = (refusals: readonly MissingSpanAttribute[]): boolean =>
  refusals.some(
    (refusal) => refusal.reason !== undefined && REFUSALS_ABOUT_OTHER_CODE.has(refusal.reason),
  );

const resolveObserved = (lookups: StaticLookups, observed: ObservedComponent): Resolution => {
  const name = normalizeLocalName(observed.observedName);

  let refusals: readonly MissingSpanAttribute[] = [];
  if (observed.observedSource !== undefined) {
    const bySource = sourceCandidates(lookups, observed, name);
    if (bySource.kind !== 'unmatched' || namesOtherCode(bySource.refusals)) return bySource;
    refusals = bySource.refusals;
  }

  const byRuntimeName = uniqueCandidate(lookups.byRuntimeName.get(`${observed.kind}|${name}`));
  if (byRuntimeName !== undefined) {
    return { kind: 'matched', component: byRuntimeName, rule: 'runtime_name', refusals };
  }

  const candidates = lookups.byKindAndName.get(`${observed.kind}|${name}`);
  const unique = uniqueCandidate(candidates);
  if (unique !== undefined) {
    return { kind: 'matched', component: unique, rule: 'kind_and_name', refusals };
  }

  // A qualified name and a bare name mean the same component when only one declaration shares the last segment.
  const bare = uniqueCandidate(lookups.byKindAndBareName.get(`${observed.kind}|${bareName(name)}`));
  if (bare !== undefined) {
    return { kind: 'matched', component: bare, rule: 'kind_and_name', refusals };
  }

  if (candidates !== undefined && candidates.length > 1) {
    return {
      kind: 'ambiguous',
      candidates: candidates.map((component) => component.id),
      refusals,
    };
  }
  return { kind: 'unmatched', refusals };
};

const observationFrom = (
  observed: Pick<
    ObservedEdge,
    | 'executionCount'
    | 'errorCount'
    | 'retryCount'
    | 'parallelCount'
    | 'totalDurationMs'
    | 'durationsMs'
    | 'inputTokens'
    | 'outputTokens'
  >,
  runIds: readonly string[],
): EdgeObservation => {
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

const mergeObservations = (
  left: EdgeObservation | undefined,
  right: EdgeObservation,
): EdgeObservation => {
  if (left === undefined) return right;
  return {
    executionCount: left.executionCount + right.executionCount,
    errorCount: left.errorCount + right.errorCount,
    retryCount: left.retryCount + right.retryCount,
    parallelCount: left.parallelCount + right.parallelCount,
    totalDurationMs: left.totalDurationMs + right.totalDurationMs,
    ...(right.p50DurationMs === undefined ? {} : { p50DurationMs: right.p50DurationMs }),
    ...(right.p95DurationMs === undefined ? {} : { p95DurationMs: right.p95DurationMs }),
    maxDurationMs: Math.max(left.maxDurationMs ?? 0, right.maxDurationMs ?? 0),
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    runIds: [...new Set([...left.runIds, ...right.runIds])],
  };
};

type Mutable = {
  readonly components: Map<ComponentId, Component>;
  readonly edges: Map<string, Edge>;
  readonly evidence: Evidence[];
  readonly matches: ComponentMatch[];
  readonly ambiguous: AmbiguousMatch[];
  readonly runtimeOnly: ComponentId[];
  readonly sourceRefusals: Map<string, MissingSpanAttribute>;
  /** observed kind + normalised name to the component it resolved to, and how it was resolved. */
  readonly resolved: Map<string, { readonly id: ComponentId; readonly rule: MatchRule }>;
  observedStructuralRelations: number;
  qualifiedDeclaredRelations: number;
  readonly relationRefusals: Map<
    RelationRefusalReason,
    { count: number; evidence: Set<EvidenceId> }
  >;
};

const addRelationRefusal = (
  state: Mutable,
  reason: RelationRefusalReason,
  evidence: readonly EvidenceId[],
): void => {
  const previous = state.relationRefusals.get(reason) ?? { count: 0, evidence: new Set() };
  previous.count += 1;
  for (const id of evidence) previous.evidence.add(id);
  state.relationRefusals.set(reason, previous);
};

const observedResolutionKey = (
  kind: string,
  name: string,
  source: ObservedSource | undefined,
): string => {
  const identity = source?.identity;
  const base = `${kind}|${normalizeLocalName(name)}`;
  if (identity === undefined) return base;
  return [
    base,
    identity.repositoryUrl,
    identity.revision,
    identity.file,
    identity.line ?? '',
    identity.function ?? '',
  ].join('|');
};

const addSourceRefusals = (state: Mutable, refusals: readonly MissingSpanAttribute[]): void => {
  for (const refusal of refusals) {
    const key = `${refusal.purpose}|${refusal.attribute}|${refusal.reason ?? ''}`;
    const previous = state.sourceRefusals.get(key);
    const observedComponents = (previous?.observedComponents ?? 0) + refusal.observedComponents;
    const evidence = [
      ...new Set([...(previous?.evidence ?? []), ...(refusal.evidence ?? [])]),
    ].sort();
    const sample = evidence.slice(0, 10) as EvidenceId[];
    state.sourceRefusals.set(key, {
      ...refusal,
      observedComponents,
      ...(sample.length === 0 ? {} : { evidence: sample }),
      evidenceOmitted: Math.max(0, observedComponents - sample.length),
    });
  }
};

const markObserved = (
  state: Mutable,
  component: Component,
  observed: ObservedComponent,
  rule: MatchRule,
  runIds: readonly string[],
): void => {
  // Derived evidence always cites at least one input. When the topology carried no span evidence the
  // component's own discovery evidence is cited, so the derivation chain never dangles.
  const inputs =
    observed.evidence.length > 0
      ? (observed.evidence as EvidenceId[])
      : ([component.evidence[0]].filter((value) => value !== undefined) as EvidenceId[]);
  const record = derivedEvidence({
    producer: PRODUCER,
    rule: `match:${rule}`,
    inputs,
    note: `observed as "${observed.observedName}" in runs ${runIds.join(', ')}`,
    basis: 'observed',
  });
  state.evidence.push(record);

  state.components.set(component.id, {
    ...component,
    ...(observed.observedSource === undefined ? {} : { observedSource: observed.observedSource }),
    presence: { ...component.presence, runtime: true },
    basis: strongerBasis(component.basis, 'observed'),
    evidence: [...new Set([...component.evidence, ...observed.evidence, record.id])],
    metadata: {
      ...component.metadata,
      observedName: observed.observedName,
      observedSpanCount: observed.spanCount,
      observedErrorCount: observed.errorCount,
      observedRetryCount: observed.retryCount,
      observedSelfDurationMs: observed.selfDurationMs,
      observedSideEffect: observed.performedSideEffect,
      ...(observed.provider === undefined ? {} : { observedProvider: observed.provider }),
      ...(observed.model === undefined ? {} : { observedModel: observed.model }),
      ...(observed.mcpServer === undefined ? {} : { observedMcpServer: observed.mcpServer }),
    },
  });
  state.matches.push({
    observedName: observed.observedName,
    observedKind: observed.kind,
    ...(observed.observedSource === undefined ? {} : { observedSource: observed.observedSource }),
    componentId: component.id,
    rule,
  });
};

const addRuntimeOnly = (
  state: Mutable,
  lookups: StaticLookups,
  observed: ObservedComponent,
  runIds: readonly string[],
): void => {
  const identity = runtimeIdentity(observed.kind as ComponentKind, observed.observedName);
  const base = buildComponentId(identity);
  const id = lookups.usedIds.has(base) ? buildComponentId(identity, true) : base;
  lookups.usedIds.add(id);

  const record = derivedEvidence({
    producer: PRODUCER,
    rule: 'runtime_only_component',
    inputs: observed.evidence as EvidenceId[],
    note: `"${observed.observedName}" appeared at runtime with no matching declaration`,
    basis: 'observed',
  });
  state.evidence.push(record);

  const component: Component = {
    id,
    identity,
    fingerprint: identityFingerprint(identity) as Sha256Hex,
    kind: observed.kind as ComponentKind,
    displayName: observed.observedName,
    presence: { static: false, runtime: true, manifest: false },
    basis: 'observed',
    confidence: 0.95,
    discoveredBy: [PRODUCER],
    sourceLocations:
      observed.codeLocation === undefined
        ? []
        : [
            {
              file: observed.codeLocation.file,
              startLine: observed.codeLocation.line ?? 1,
            },
          ],
    ...(observed.observedSource === undefined ? {} : { observedSource: observed.observedSource }),
    configLocations: [],
    evidence: [...new Set([...observed.evidence, record.id])],
    permissions: [],
    aliases: [],
    tags: ['runtime-only'],
    metadata: {
      observedSpanCount: observed.spanCount,
      observedRuns: runIds.join(','),
      ...(observed.provider === undefined ? {} : { observedProvider: observed.provider }),
      ...(observed.model === undefined ? {} : { observedModel: observed.model }),
    },
  };
  state.components.set(id, component);
  state.runtimeOnly.push(id);
};

const reconcileComponents = (
  state: Mutable,
  lookups: StaticLookups,
  topology: RuntimeTopology,
): void => {
  for (const observed of topology.components) {
    const key = observedResolutionKey(
      observed.kind,
      observed.observedName,
      observed.observedSource,
    );
    const alreadyResolved = state.resolved.get(key);
    if (alreadyResolved !== undefined) {
      const component = state.components.get(alreadyResolved.id);
      if (component !== undefined) {
        markObserved(state, component, observed, alreadyResolved.rule, topology.runIds);
        continue;
      }
    }
    const resolution = resolveObserved(lookups, observed);
    addSourceRefusals(state, resolution.refusals);
    if (resolution.kind === 'matched') {
      const current = state.components.get(resolution.component.id) ?? resolution.component;
      markObserved(state, current, observed, resolution.rule, topology.runIds);
      state.resolved.set(key, { id: resolution.component.id, rule: resolution.rule });
      continue;
    }
    if (resolution.kind === 'ambiguous') {
      state.ambiguous.push({
        observedName: observed.observedName,
        observedKind: observed.kind,
        candidates: resolution.candidates,
      });
    }
    addRuntimeOnly(state, lookups, observed, topology.runIds);
    const created = state.runtimeOnly[state.runtimeOnly.length - 1];
    if (created !== undefined) state.resolved.set(key, { id: created, rule: 'kind_and_name' });
  }
};

const reconcileEdges = (state: Mutable, topology: RuntimeTopology): void => {
  for (const observed of topology.edges) {
    state.observedStructuralRelations += 1;
    const fromResolved = state.resolved.get(
      observedResolutionKey(
        observed.fromKind,
        observed.fromObservedName,
        observed.fromObservedSource,
      ),
    );
    const toResolved = state.resolved.get(
      observedResolutionKey(observed.toKind, observed.toObservedName, observed.toObservedSource),
    );
    if (fromResolved === undefined || toResolved === undefined) {
      addRelationRefusal(state, 'endpoint_identity_unresolved', observed.evidence);
      continue;
    }
    const from = fromResolved.id;
    const to = toResolved.id;

    const kind = observed.kind as EdgeKind;
    const id = buildEdgeId(kind, from, to);
    const existing = state.edges.get(id);
    const observation = observationFrom(observed, topology.runIds);

    if (existing !== undefined) {
      const provenanceInputs = (provenance: ObservedValueProvenance): readonly string[] => [
        ...provenance.attributes.map((attribute) => `span:${attribute}`),
        ...(provenance.resourceAttributes ?? []).map((attribute) => `resource:${attribute}`),
      ];
      const endpointAttributes = new Set([
        ...provenanceInputs(observed.provenance.from),
        ...provenanceInputs(observed.provenance.to),
      ]);
      const relationAttributes = provenanceInputs(observed.provenance.relation);
      const exactlyRederived =
        observed.provenance.relation.spanFields.length === 0 &&
        relationAttributes.length > 0 &&
        relationAttributes.every((attribute) => endpointAttributes.has(attribute));
      if (exactlyRederived) {
        addRelationRefusal(state, 'relation_rederived_from_endpoint_evidence', observed.evidence);
        continue;
      }
      state.qualifiedDeclaredRelations += 1;
      state.edges.set(id, {
        ...existing,
        basis: strongerBasis(existing.basis, 'observed'),
        evidence: [...new Set([...existing.evidence, ...observed.evidence])],
        observation: mergeObservations(existing.observation, observation),
      });
      continue;
    }

    addRelationRefusal(state, 'no_exact_declared_relation', observed.evidence);

    const record = derivedEvidence({
      producer: PRODUCER,
      rule: 'runtime_only_edge',
      inputs: observed.evidence as EvidenceId[],
      note: `"${observed.fromObservedName}" to "${observed.toObservedName}" observed without a declared relation`,
      basis: 'observed',
    });
    state.evidence.push(record);

    state.edges.set(id, {
      id,
      kind,
      from,
      to,
      basis: 'observed',
      confidence: 0.95,
      discoveredBy: [PRODUCER],
      sourceLocations: [],
      configLocations: [],
      evidence: [...new Set([...observed.evidence, record.id])],
      observation,
      runtimeOnly: true,
      metadata: {},
    });
  }
};

const aggregateMissingAttributes = (
  topologies: readonly RuntimeTopology[],
  additional: readonly MissingSpanAttribute[] = [],
): readonly MissingSpanAttribute[] => {
  const counts = new Map<string, MissingSpanAttribute>();
  for (const missing of [
    ...topologies.flatMap((topology) => topology.coverage.missingSpanAttributes),
    ...additional,
  ]) {
    const key = `${missing.purpose}|${missing.attribute}|${missing.reason ?? ''}`;
    const previous = counts.get(key);
    const evidence = [
      ...new Set([...(previous?.evidence ?? []), ...(missing.evidence ?? [])]),
    ].sort();
    const sample = evidence.slice(0, 10) as EvidenceId[];
    const observedComponents = (previous?.observedComponents ?? 0) + missing.observedComponents;
    counts.set(key, {
      ...missing,
      observedComponents,
      ...(sample.length === 0 ? {} : { evidence: sample }),
      ...(observedComponents <= sample.length
        ? {}
        : { evidenceOmitted: observedComponents - sample.length }),
    });
  }
  return [...counts.values()].sort((left, right) =>
    left.attribute < right.attribute ? -1 : left.attribute > right.attribute ? 1 : 0,
  );
};

const reconcileBehavior = (
  state: Mutable,
  topologies: readonly RuntimeTopology[],
  runIds: readonly string[],
): ReconcileBehavior => {
  const acceptedValues = topologies.map((topology) => topology.coverage.acceptedSpans);
  const droppedValues = topologies.map((topology) => topology.coverage.droppedSpans);
  const rejectedValues = topologies.map((topology) => topology.coverage.rejectedSpans);
  const coverageKnown = [...acceptedValues, ...droppedValues, ...rejectedValues].every(
    (value) => value !== undefined,
  );
  const sumCoverage = (values: readonly (number | undefined)[]): number =>
    values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const acceptedSpans = sumCoverage(acceptedValues);
  const droppedSpans = sumCoverage(droppedValues);
  const rejectedSpans = sumCoverage(rejectedValues);
  const observedKeys = new Map<string, { kind: string; evidence: readonly EvidenceId[] }>();
  let componentExecutions = 0;
  for (const topology of topologies) {
    for (const component of topology.components) {
      componentExecutions += component.spanCount;
      const key = observedResolutionKey(
        component.kind,
        component.observedName,
        component.observedSource,
      );
      if (!observedKeys.has(key)) {
        observedKeys.set(key, { kind: component.kind, evidence: component.evidence });
      }
    }
  }
  const byKind = new Map<string, number>();
  for (const component of observedKeys.values()) {
    byKind.set(component.kind, (byKind.get(component.kind) ?? 0) + 1);
  }
  const componentEvidence = [...observedKeys.values()].flatMap((component) =>
    component.evidence.slice(0, 1),
  ) as EvidenceId[];
  const inputComplete = coverageKnown && droppedSpans === 0 && rejectedSpans === 0;
  const populationEvidence =
    coverageKnown && runIds.length > 0 && runIds.length <= 100
      ? metricEvidence({
          producer: PRODUCER,
          runIds,
          metric: 'runtime.accepted_spans',
          value: acceptedSpans,
          unit: 'spans',
          sampleSize: acceptedSpans,
        })
      : undefined;
  if (populationEvidence !== undefined) state.evidence.push(populationEvidence);
  const noRelationEvidence =
    inputComplete && state.observedStructuralRelations === 0 && acceptedSpans > 0
      ? absenceEvidence({
          producer: PRODUCER,
          searched: 'an independently observed structural relation',
          scope: `${acceptedSpans} accepted spans across runs ${runIds.join(', ')}`,
          inspectedCount: acceptedSpans,
        })
      : undefined;
  if (noRelationEvidence !== undefined) state.evidence.push(noRelationEvidence);
  const refusals = [...state.relationRefusals]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([reason, entry]) => {
      const evidence = [...entry.evidence].sort();
      return {
        reason,
        count: entry.count,
        evidence: evidence.slice(0, 10),
        evidenceOmitted: Math.max(0, evidence.length - 10),
      };
    });
  const behaviorEvidence = [
    ...new Set([
      ...componentEvidence,
      ...refusals.flatMap((entry) => entry.evidence),
      ...(populationEvidence === undefined ? [] : [populationEvidence.id]),
      ...(noRelationEvidence === undefined ? [] : [noRelationEvidence.id]),
    ]),
  ].sort() as EvidenceId[];
  const accountBounded = behaviorEvidence.length <= 100 && populationEvidence !== undefined;
  return {
    status: inputComplete && accountBounded ? 'complete' : 'incomplete',
    acceptedSpans,
    droppedSpans,
    rejectedSpans,
    executedComponents: observedKeys.size,
    componentExecutions,
    executedByKind: [...byKind]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([kind, count]) => ({ kind, count })),
    observedStructuralRelations: state.observedStructuralRelations,
    qualifiedDeclaredRelations: state.qualifiedDeclaredRelations,
    refusals,
    noIndependentRelationObservation:
      inputComplete && state.observedStructuralRelations === 0 && acceptedSpans > 0,
    ...(populationEvidence === undefined ? {} : { populationEvidence: populationEvidence.id }),
    evidence: behaviorEvidence.slice(0, 100),
    evidenceOmitted: Math.max(0, behaviorEvidence.length - 100),
  };
};

export const reconcile = (
  graph: SystemGraph,
  topologies: readonly RuntimeTopology[],
): ReconcileResult => {
  const lookups = buildLookups(graph);
  const state: Mutable = {
    components: new Map(graph.components.map((component) => [component.id, component])),
    edges: new Map(graph.edges.map((edge) => [edge.id, edge])),
    evidence: [],
    matches: [],
    ambiguous: [],
    runtimeOnly: [],
    sourceRefusals: new Map(),
    resolved: new Map(),
    observedStructuralRelations: 0,
    qualifiedDeclaredRelations: 0,
    relationRefusals: new Map(),
  };

  for (const topology of topologies) {
    reconcileComponents(state, lookups, topology);
    reconcileEdges(state, topology);
  }

  const runIds = [
    ...new Set([...graph.provenance.runIds, ...topologies.flatMap((topology) => topology.runIds)]),
  ];

  const components = [...state.components.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const edges = [...state.edges.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const behavior = reconcileBehavior(state, topologies, runIds);

  return {
    graph: {
      ...graph,
      provenance: { ...graph.provenance, runIds },
      components,
      edges,
    },
    evidence: state.evidence,
    matches: state.matches,
    ambiguous: state.ambiguous,
    runtimeOnlyComponentIds: state.runtimeOnly,
    missingSpanAttributes: aggregateMissingAttributes(topologies, [
      ...state.sourceRefusals.values(),
    ]),
    behavior,
  };
};
