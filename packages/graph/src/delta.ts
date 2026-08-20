import {
  derivedEvidence,
  formatCount,
  partOfAuditedSystem,
  partOfDeclaredTopology,
  spanEvidence,
} from '@orchescope/domain';
import type {
  Component,
  ComponentId,
  Contradiction,
  DuplicateSideEffect,
  Edge,
  Evidence,
  EvidenceId,
  JoinSummary,
  ReconciliationDelta,
  SideEffectRecord,
  SystemGraph,
} from '@orchescope/schema';
import { isObservableKind } from './analysis.ts';
import type { ComponentMatch } from './reconcile.ts';

/**
 * The declared versus exercised delta.
 *
 * Four questions are answered here, and each one is unanswerable from either half of the evidence
 * alone: what was declared and never ran, what ran without being declared, where an observation
 * contradicts a declaration, and which side effects happened more than once for the same operation.
 */

const PRODUCER = 'delta';

export type RunSideEffects = {
  readonly runId: string;
  readonly sideEffects: readonly SideEffectRecord[];
};

/**
 * The components a run could name, restricted to the system this scan is auditing.
 *
 * Both halves matter and the second was missing. `isObservableKind` asks whether a kind can appear in a
 * trace at all, which keeps a prompt and an entry point out of a coverage fraction. `partOfAuditedSystem`
 * asks whether the repository ships the thing, which keeps out a component only a test declares and a
 * server only somebody's editor configures.
 *
 * Without the second, this delta reported a framework's own test suite as a system that had never been
 * run. On `pydantic-ai` with a run in it, 871 of the 958 components in this population are declared in a
 * test file: the exercise rate divided by 958 where the system under audit is 87, and
 * `declared-not-exercised` named some five hundred fixtures as declarations no run had reached. That is
 * the centre of this product answering with the harness rather than the system, which is the same defect
 * the static rules carried and the reason the invariant lives in one predicate.
 */
const observableComponents = (graph: SystemGraph): readonly Component[] =>
  graph.components.filter(
    (component) => isObservableKind(component.kind) && partOfAuditedSystem(component),
  );

const declaredNotExercised = (graph: SystemGraph): readonly Component[] =>
  observableComponents(graph).filter(
    (component) => component.presence.static && !component.presence.runtime,
  );

const exercisedNotDeclared = (graph: SystemGraph): readonly Component[] =>
  graph.components.filter((component) => component.presence.runtime && !component.presence.static);

/**
 * Containment is left out of both halves of the edge fraction. It says what a thing is made of rather
 * than what ran, so a group that was never "exercised" is not a gap a reader can act on.
 */
const countableDeclaredEdge = (edge: Edge): boolean =>
  partOfDeclaredTopology(edge) && edge.kind !== 'contains';

/**
 * Declared relations a run performed, which is the numerator of the fraction below.
 *
 * The same population has to stand on both sides of it. This counted every observed relation, including
 * the ones reconciliation could match against no declaration, while the denominator counted declared ones
 * only, so the two halves of the edge delta stopped adding up to the whole: on the pinned LangGraph
 * application, sixteen declared relations, sixteen of them reported as never exercised, and an answer of
 * eleven of sixteen exercised. Every entry in the corpus that carries a run overstated it, and the one
 * whose declarations a run joined none of read sixty nine percent.
 *
 * This is the defect the component fraction beside it already had and had already fixed, which is worth
 * saying: the comment there notes that edges exclude a runtime only relation from their denominator, and
 * nobody looked at the numerator.
 */
const exercisedEdges = (graph: SystemGraph): readonly Edge[] =>
  graph.edges.filter(
    (edge) =>
      countableDeclaredEdge(edge) &&
      edge.observation !== undefined &&
      edge.observation.executionCount > 0,
  );

const declaredNotExercisedEdges = (graph: SystemGraph): readonly Edge[] =>
  graph.edges.filter(
    (edge) =>
      countableDeclaredEdge(edge) &&
      (edge.observation === undefined || edge.observation.executionCount === 0),
  );

const boolMetadata = (component: Component, key: string): boolean | undefined => {
  const value = component.metadata[key];
  return typeof value === 'boolean' ? value : undefined;
};

const annotationContradictions = (
  graph: SystemGraph,
  duplicates: readonly DuplicateSideEffect[],
  collect: (record: Evidence) => EvidenceId,
): readonly Contradiction[] => {
  const results: Contradiction[] = [];
  const duplicatesByComponent = new Map<string, DuplicateSideEffect>();
  for (const duplicate of duplicates) {
    if (duplicate.componentId !== undefined)
      duplicatesByComponent.set(duplicate.componentId, duplicate);
  }

  for (const component of graph.components) {
    if (component.details?.for !== 'tool') continue;
    const performedSideEffect = boolMetadata(component, 'observedSideEffect') === true;

    if (component.details.readOnlyHint === true && performedSideEffect) {
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'contradiction:read_only_hint',
        basis: 'observed',
        inputs: component.evidence as EvidenceId[],
        note: `${component.id} declares readOnlyHint true and was observed performing a side effect`,
      });
      results.push({
        componentId: component.id,
        kind: 'read_only_hint',
        declared: 'readOnlyHint: true',
        observed: 'performed a side effect',
        evidence: [collect(record)],
      });
    }

    const duplicate = duplicatesByComponent.get(component.id);
    if (component.details.idempotentHint === true && duplicate !== undefined) {
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'contradiction:idempotent_hint',
        basis: 'observed',
        inputs: duplicate.evidence as EvidenceId[],
        note: `${component.id} declares idempotentHint true and produced ${duplicate.occurrences} occurrences of ${duplicate.key}`,
      });
      results.push({
        componentId: component.id,
        kind: 'idempotent_hint',
        declared: 'idempotentHint: true',
        observed: `${duplicate.occurrences} occurrences of the same side effect key`,
        evidence: [collect(record)],
      });
    }

    if (
      component.details.readOnlyHint === true &&
      component.sideEffect === 'non_idempotent_write'
    ) {
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'contradiction:destructive_hint',
        basis: 'discovered',
        inputs: component.evidence as EvidenceId[],
        note: `${component.id} declares readOnlyHint true but its discovered effect class is non_idempotent_write`,
      });
      results.push({
        componentId: component.id,
        kind: 'destructive_hint',
        declared: 'readOnlyHint: true',
        observed: 'discovered effect class non_idempotent_write',
        evidence: [collect(record)],
      });
    }
  }
  return results;
};

const policyContradictions = (
  graph: SystemGraph,
  collect: (record: Evidence) => EvidenceId,
): readonly Contradiction[] => {
  const results: Contradiction[] = [];
  for (const edge of graph.edges) {
    const observation = edge.observation;
    const policy = edge.policy;
    if (observation === undefined || policy === undefined) continue;

    const timeoutMs = policy.timeoutMs;
    if (timeoutMs !== undefined && (observation.maxDurationMs ?? 0) > timeoutMs) {
      const record = derivedEvidence({
        producer: PRODUCER,
        rule: 'contradiction:timeout',
        basis: 'observed',
        inputs: edge.evidence as EvidenceId[],
        note: `${edge.id} declares a ${timeoutMs} ms timeout and was observed running for ${Math.round(observation.maxDurationMs ?? 0)} ms`,
      });
      results.push({
        componentId: edge.to,
        kind: 'timeout',
        declared: `timeout ${timeoutMs} ms`,
        observed: `longest observed call ${Math.round(observation.maxDurationMs ?? 0)} ms`,
        evidence: [collect(record)],
      });
    }

    const maxAttempts = policy.retry?.maxAttempts;
    if (maxAttempts !== undefined && observation.executionCount > 0) {
      const allowedRetries = observation.executionCount * Math.max(0, maxAttempts - 1);
      if (observation.retryCount > allowedRetries) {
        const record = derivedEvidence({
          producer: PRODUCER,
          rule: 'contradiction:retry_bound',
          basis: 'observed',
          inputs: edge.evidence as EvidenceId[],
          note: `${edge.id} declares at most ${maxAttempts} attempts, which allows ${allowedRetries} retries across ${observation.executionCount} executions, and ${observation.retryCount} retries were observed`,
        });
        results.push({
          componentId: edge.to,
          kind: 'retry_bound',
          declared: `maxAttempts ${maxAttempts}`,
          observed: `${observation.retryCount} retries across ${observation.executionCount} executions`,
          evidence: [collect(record)],
        });
      }
    }

    if (policy.requiresApproval === true) {
      const approvalObserved = graph.edges.some(
        (candidate) =>
          candidate.kind === 'guarded_by' &&
          candidate.from === edge.to &&
          candidate.observation !== undefined,
      );
      if (!approvalObserved) {
        const record = derivedEvidence({
          producer: PRODUCER,
          rule: 'contradiction:approval',
          basis: 'observed',
          inputs: edge.evidence as EvidenceId[],
          note: `${edge.id} declares that approval is required and no approval was observed on any run`,
        });
        results.push({
          componentId: edge.to,
          kind: 'approval',
          declared: 'requiresApproval: true',
          observed: 'no approval observed while the operation executed',
          evidence: [collect(record)],
        });
      }
    }
  }
  return results;
};

const effectKey = (record: SideEffectRecord): string =>
  record.idempotencyKey === undefined
    ? `${record.kind}|${record.target}`
    : `${record.kind}|${record.target}|${record.idempotencyKey}`;

/**
 * An attempt that failed did not change anything outside the system, so it is not an occurrence of the effect. An
 * attempt whose outcome is unknown is counted, because a timeout that may have committed is exactly the case
 * duplication analysis exists for.
 */
const effectHappened = (record: SideEffectRecord): boolean => record.outcome !== 'failed';

type EffectBucket = {
  occurrences: number;
  maxPerRun: number;
  runIds: Set<string>;
  componentIds: Set<ComponentId>;
  idempotencyKeyPresent: boolean;
  attempts: Set<number>;
  evidence: EvidenceId[];
};

const emptyBucket = (record: SideEffectRecord): EffectBucket => ({
  occurrences: 0,
  maxPerRun: 0,
  runIds: new Set<string>(),
  componentIds: new Set<ComponentId>(),
  idempotencyKeyPresent: record.idempotencyKey !== undefined,
  attempts: new Set<number>(),
  evidence: [],
});

const foldEffect = (
  bucket: EffectBucket,
  input: {
    readonly record: SideEffectRecord;
    readonly runId: string;
    readonly spanToComponent: ReadonlyMap<string, ComponentId>;
    readonly collect: (record: Evidence) => EvidenceId;
  },
): EffectBucket => {
  const { record } = input;
  bucket.occurrences += 1;
  bucket.runIds.add(input.runId);
  if (record.retryAttempt !== undefined) bucket.attempts.add(record.retryAttempt);
  const componentId = input.spanToComponent.get(record.spanId);
  if (componentId !== undefined) bucket.componentIds.add(componentId);
  bucket.evidence.push(
    input.collect(
      spanEvidence({
        producer: PRODUCER,
        runId: input.runId,
        traceId: record.traceId,
        spanId: record.spanId,
        spanName: record.spanName,
        attribute: 'orchescope.side_effect',
        attributeValue: `${record.kind} on ${record.target}${record.idempotencyKey === undefined ? ' without an idempotency key' : ''}`,
      }),
    ),
  );
  return bucket;
};

const duplicateSideEffects = (
  runs: readonly RunSideEffects[],
  spanToComponent: ReadonlyMap<string, ComponentId>,
  collect: (record: Evidence) => EvidenceId,
): readonly DuplicateSideEffect[] => {
  const buckets = new Map<string, EffectBucket>();

  for (const run of runs) {
    const perRun = new Map<string, number>();
    for (const record of run.sideEffects) {
      if (!effectHappened(record)) continue;
      const key = effectKey(record);
      perRun.set(key, (perRun.get(key) ?? 0) + 1);
      buckets.set(
        key,
        foldEffect(buckets.get(key) ?? emptyBucket(record), {
          record,
          runId: run.runId,
          spanToComponent,
          collect,
        }),
      );
    }
    for (const [key, count] of perRun) {
      const bucket = buckets.get(key);
      if (bucket !== undefined) bucket.maxPerRun = Math.max(bucket.maxPerRun, count);
    }
  }

  const duplicates: DuplicateSideEffect[] = [];
  for (const [key, bucket] of buckets) {
    // Repeating an effect in separate runs is expected. Repetition inside a single run is a duplicate.
    if (bucket.maxPerRun <= 1) continue;
    const summary = derivedEvidence({
      producer: PRODUCER,
      rule: 'duplicate_side_effect',
      inputs: bucket.evidence,
      note: `${key} occurred ${bucket.maxPerRun} times within a single run, and ${bucket.occurrences} times across ${formatCount(bucket.runIds.size, 'run')}`,
    });
    const componentId = [...bucket.componentIds][0];
    duplicates.push({
      key,
      ...(componentId === undefined ? {} : { componentId }),
      occurrences: bucket.maxPerRun,
      totalOccurrences: bucket.occurrences,
      retryAttempts: [...bucket.attempts].sort((left, right) => left - right),
      idempotencyKeyPresent: bucket.idempotencyKeyPresent,
      runIds: [...bucket.runIds],
      evidence: [collect(summary), ...bucket.evidence],
    });
  }
  return duplicates;
};

export type DeltaInput = {
  readonly graph: SystemGraph;
  readonly runs: readonly RunSideEffects[];
  /** Span identifier to component identifier, produced by trace attribution. */
  readonly spanToComponent: ReadonlyMap<string, ComponentId>;
  /** How reconciliation joined each observed name, so the delta can say which joins are the weak ones. */
  readonly matches?: readonly ComponentMatch[];
  /** Observed names that matched more than one declaration and were joined to none. */
  readonly ambiguous?: readonly { readonly observedName: string }[];
};

const summarizeJoins = (input: DeltaInput): JoinSummary => {
  const matches = input.matches ?? [];
  const onNameAlone = matches
    .filter((match) => match.rule === 'kind_and_name')
    .map((match) => match.componentId);
  return {
    byCodeLocation: matches.filter((match) => match.rule === 'code_location').length,
    byRuntimeName: matches.filter((match) => match.rule === 'runtime_name').length,
    byKindAndName: onNameAlone.length,
    onNameAlone: [...new Set(onNameAlone)],
    ambiguous: [...new Set((input.ambiguous ?? []).map((entry) => entry.observedName))],
  };
};

export type DeltaResult = {
  readonly delta: ReconciliationDelta;
  readonly evidence: readonly Evidence[];
};

export const computeDelta = (input: DeltaInput): DeltaResult => {
  const evidence: Evidence[] = [];
  const collect = (record: Evidence): EvidenceId => {
    evidence.push(record);
    return record.id;
  };

  const duplicates = duplicateSideEffects(input.runs, input.spanToComponent, collect);
  const contradictions = [
    ...annotationContradictions(input.graph, duplicates, collect),
    ...policyContradictions(input.graph, collect),
  ];

  /*
   * Coverage describes the declared set, not every observable component a run could name.
   *
   * Undeclared (runtime-only) components belong in `exercisedNotDeclared`, not in the fraction's
   * denominator. Counting them on both sides of the pair made `15 of 22` on the demonstration
   * system include one component nothing declared, which contradicted the field name, the schema
   * comment and the four deltas. Edges already exclude `runtimeOnly` from their denominator.
   */
  const declaredObservable = observableComponents(input.graph).filter(
    (component) => component.presence.static,
  );
  const declaredComponents = declaredObservable.length;
  const exercisedComponents = declaredObservable.filter(
    (component) => component.presence.runtime,
  ).length;
  const declaredEdges = input.graph.edges.filter(countableDeclaredEdge).length;
  const exercised = exercisedEdges(input.graph).length;
  const runIds = input.graph.provenance.runIds;

  const delta: ReconciliationDelta = {
    declaredNotExercised: {
      components: declaredNotExercised(input.graph).map((component) => component.id),
      edges: declaredNotExercisedEdges(input.graph).map((edge) => edge.id),
      runIds: [...runIds],
    },
    exercisedNotDeclared: {
      components: exercisedNotDeclared(input.graph).map((component) => component.id),
      edges: input.graph.edges
        .filter((edge) => !partOfDeclaredTopology(edge))
        .map((edge) => edge.id),
    },
    contradictions: [...contradictions],
    duplicateSideEffects: [...duplicates],
    joins: summarizeJoins(input),
    coverage: {
      declaredComponents,
      exercisedComponents,
      declaredEdges,
      exercisedEdges: exercised,
      ...(runIds.length === 0 || declaredComponents === 0
        ? {}
        : { componentExerciseRate: exercisedComponents / declaredComponents }),
      ...(runIds.length === 0 || declaredEdges === 0
        ? {}
        : { edgeExerciseRate: Math.min(1, exercised / declaredEdges) }),
    },
    ...(input.graph.provenance.git === undefined ? {} : { revision: input.graph.provenance.git }),
  };

  return { delta, evidence };
};
