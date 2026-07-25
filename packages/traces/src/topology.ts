import { spanEvidence } from '@orchescope/domain';
import type {
  AgentOperation,
  ComponentKind,
  ComponentRunMetrics,
  Evidence,
  EvidenceId,
  NormalizedSpan,
  ObservedComponent,
  ObservedEdge,
  RunMetrics,
  RuntimeTopology,
  SideEffectRecord,
  TraceBundle,
} from '@orchescope/schema';
import {
  CODE,
  componentKindFor,
  GEN_AI,
  MCP,
  ORCHESCOPE,
  observedNameFor,
  readBoolean,
  readNumber,
  readString,
} from './attributes.ts';

/**
 * Runtime topology derivation.
 *
 * Spans become components and relations. Three facts are computed here that a raw span list does not
 * contain and that the findings depend on:
 *
 *  - self time, so latency can be attributed to the component that actually spent it rather than to
 *    every ancestor that was waiting;
 *  - whether sibling calls overlapped in wall clock, which is the difference between "these two tools
 *    ran in parallel" and "these two tools ran one after the other";
 *  - retries, counted only when an earlier sibling with the same name ended in error, so a loop that
 *    legitimately calls the same tool three times is not reported as two retries.
 */

const PRODUCER = 'traces';

type SpanNode = {
  readonly span: NormalizedSpan;
  readonly children: SpanNode[];
  readonly startNanos: bigint;
  readonly endNanos: bigint;
};

const toBigInt = (value: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const buildForest = (
  spans: readonly NormalizedSpan[],
): {
  readonly roots: readonly SpanNode[];
  readonly byId: ReadonlyMap<string, SpanNode>;
} => {
  const byId = new Map<string, SpanNode>();
  for (const span of spans) {
    byId.set(span.spanId, {
      span,
      children: [],
      startNanos: toBigInt(span.startTimeUnixNano),
      endNanos: toBigInt(span.endTimeUnixNano),
    });
  }
  const roots: SpanNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.span.parentSpanId;
    const parent = parentId === undefined ? undefined : byId.get(parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  for (const node of byId.values()) {
    node.children.sort((left, right) => (left.startNanos < right.startNanos ? -1 : 1));
  }
  roots.sort((left, right) => (left.startNanos < right.startNanos ? -1 : 1));
  return { roots, byId };
};

const selfDurationMs = (node: SpanNode): number => {
  const childTotal = node.children.reduce((total, child) => total + child.span.durationMs, 0);
  return Math.max(0, node.span.durationMs - childTotal);
};

const overlaps = (left: SpanNode, right: SpanNode): boolean =>
  left.startNanos < right.endNanos && right.startNanos < left.endNanos;

/** Counts how many siblings of a node overlapped with it in wall clock time. */
const parallelSiblings = (parent: SpanNode | undefined, node: SpanNode): number => {
  if (parent === undefined) return 0;
  return parent.children.filter((sibling) => sibling !== node && overlaps(sibling, node)).length;
};

/**
 * Retry detection. A span is a retry when an earlier sibling with the same name failed, or when the
 * instrumentation reported an attempt number greater than one.
 */
const isRetry = (parent: SpanNode | undefined, node: SpanNode): boolean => {
  const declared = node.span.retryAttempt;
  if (declared !== undefined && declared > 1) return true;
  if (parent === undefined) return false;
  const index = parent.children.indexOf(node);
  for (let position = index - 1; position >= 0; position -= 1) {
    const earlier = parent.children[position];
    if (earlier === undefined) continue;
    if (earlier.span.name !== node.span.name) continue;
    return earlier.span.status === 'error';
  }
  return false;
};

type ComponentAccumulator = {
  kind: string;
  observedName: string;
  operation: NormalizedSpan['operation'];
  spanCount: number;
  errorCount: number;
  retryCount: number;
  selfDurationMs: number;
  totalDurationMs: number;
  durationsMs: number[];
  inputTokens: number;
  outputTokens: number;
  provider: string | undefined;
  model: string | undefined;
  codeLocation: { file: string; line?: number; function?: string } | undefined;
  mcpServer: string | undefined;
  performedSideEffect: boolean;
  evidence: Set<string>;
  attributes: Record<string, string | number | boolean>;
};

type EdgeAccumulator = {
  kind: string;
  fromKind: string;
  fromObservedName: string;
  toKind: string;
  toObservedName: string;
  executionCount: number;
  errorCount: number;
  retryCount: number;
  parallelCount: number;
  totalDurationMs: number;
  durationsMs: number[];
  inputTokens: number;
  outputTokens: number;
  evidence: Set<string>;
};

const EDGE_KIND_BY_TARGET: Readonly<Record<string, string>> = {
  model: 'invokes_model',
  tool: 'calls_tool',
  agent: 'hands_off_to',
  agent_group: 'contains',
  retrieval: 'queries_retrieval',
  memory: 'reads_memory',
  queue: 'consumes_from_queue',
  side_effect: 'performs_side_effect',
  approval_boundary: 'guarded_by',
  evaluator: 'validated_by',
  external_service: 'calls_service',
  database: 'queries_database',
  mcp_server: 'provides_tool',
};

const edgeKindFor = (fromKind: string, toKind: string, operation: string): string => {
  if (operation === 'memory_write') return 'writes_memory';
  if (fromKind === 'agent' && toKind === 'agent') return 'hands_off_to';
  return EDGE_KIND_BY_TARGET[toKind] ?? 'observed_after';
};

const codeLocationOf = (span: NormalizedSpan): ComponentAccumulator['codeLocation'] => {
  const file = readString(span.attributes, CODE.filePath, CODE.legacyFilePath);
  if (file === undefined) return undefined;
  const line = readNumber(span.attributes, CODE.lineNumber, CODE.legacyLineNumber);
  const functionName = readString(span.attributes, CODE.functionName, CODE.legacyFunction);
  return {
    file: file.replace(/^\.\//, ''),
    ...(line === undefined ? {} : { line }),
    ...(functionName === undefined ? {} : { function: functionName }),
  };
};

const componentKey = (kind: string, name: string): string => `${kind}|${name.toLowerCase()}`;

export type TopologyResult = {
  readonly topology: RuntimeTopology;
  readonly evidence: readonly Evidence[];
  readonly runMetrics: RunMetrics;
  readonly componentMetricsByName: readonly (ComponentRunMetrics & {
    readonly observedName: string;
    readonly kind: string;
  })[];
  /** Span identifier to the observed component key, used to attribute side effects. */
  readonly spanToComponentKey: ReadonlyMap<string, string>;
};

/** Which run level counter an operation contributes to. An operation absent from this table counts towards none. */
const COUNTER_BY_OPERATION: Readonly<Record<string, keyof RunCounters>> = {
  chat: 'modelCalls',
  text_completion: 'modelCalls',
  embeddings: 'modelCalls',
  execute_tool: 'toolCalls',
  invoke_agent: 'agentSteps',
  plan: 'agentSteps',
  create_agent: 'agentSteps',
  handoff: 'handoffs',
  retrieval: 'retrievalCalls',
  memory_read: 'memoryOperations',
  memory_write: 'memoryOperations',
};

const countOperation = (metrics: RunCounters, span: NormalizedSpan): void => {
  const counter = COUNTER_BY_OPERATION[span.operation];
  if (counter !== undefined) metrics[counter] += 1;
  if (span.operation === 'queue_wait') metrics.queueWaitMs += span.durationMs;
  if (readBoolean(span.attributes, ORCHESCOPE.userIntervention) === true) {
    metrics.userInterventions += 1;
  }
  if (readBoolean(span.attributes, ORCHESCOPE.policyViolation) === true) {
    metrics.policyViolations += 1;
  }
};

type RunCounters = {
  modelCalls: number;
  toolCalls: number;
  agentSteps: number;
  handoffs: number;
  retrievalCalls: number;
  memoryOperations: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
  retries: number;
  loopIterations: number;
  queueWaitMs: number;
  userInterventions: number;
  policyViolations: number;
  maxObservedConcurrency: number;
};

const emptyAccumulator = (
  kind: ComponentKind,
  observedName: string,
  operation: AgentOperation,
): ComponentAccumulator => ({
  kind,
  observedName,
  operation,
  spanCount: 0,
  errorCount: 0,
  retryCount: 0,
  selfDurationMs: 0,
  totalDurationMs: 0,
  durationsMs: [],
  inputTokens: 0,
  outputTokens: 0,
  provider: undefined,
  model: undefined,
  codeLocation: undefined,
  mcpServer: undefined,
  performedSideEffect: false,
  evidence: new Set<string>(),
  attributes: {},
});

type SpanTokens = { readonly inputTokens: number; readonly outputTokens: number };

const tokensOf = (span: NormalizedSpan): SpanTokens => ({
  inputTokens:
    readNumber(
      span.attributes,
      GEN_AI.inputTokens,
      GEN_AI.legacyPromptTokens,
      'llm.token_count.prompt',
    ) ?? 0,
  outputTokens:
    readNumber(
      span.attributes,
      GEN_AI.outputTokens,
      GEN_AI.legacyCompletionTokens,
      'llm.token_count.completion',
    ) ?? 0,
});

/**
 * Folds one span into the component it belongs to. The first value seen wins for provider, model and code location: a
 * later span that omits an attribute must not erase what an earlier one reported.
 */
const accumulateComponent = (
  accumulator: ComponentAccumulator,
  node: SpanNode,
  facts: {
    readonly tokens: SpanTokens;
    readonly retried: boolean;
    readonly evidenceId: string;
  },
): ComponentAccumulator => {
  const span = node.span;
  accumulator.spanCount += 1;
  accumulator.errorCount += span.status === 'error' ? 1 : 0;
  accumulator.retryCount += facts.retried ? 1 : 0;
  accumulator.selfDurationMs += selfDurationMs(node);
  accumulator.totalDurationMs += span.durationMs;
  accumulator.durationsMs.push(span.durationMs);
  accumulator.inputTokens += facts.tokens.inputTokens;
  accumulator.outputTokens += facts.tokens.outputTokens;
  accumulator.provider =
    accumulator.provider ??
    readString(span.attributes, GEN_AI.providerName, GEN_AI.legacySystem, 'llm.provider');
  accumulator.model =
    accumulator.model ??
    readString(span.attributes, GEN_AI.requestModel, GEN_AI.responseModel, 'llm.model_name');
  accumulator.codeLocation = accumulator.codeLocation ?? codeLocationOf(span);
  accumulator.mcpServer =
    accumulator.mcpServer ?? readString(span.attributes, MCP.serverName, MCP.methodName);
  accumulator.performedSideEffect =
    accumulator.performedSideEffect ||
    span.events.some((event) => event.name === ORCHESCOPE.sideEffectEvent);
  accumulator.evidence.add(facts.evidenceId);
  const toolType = readString(span.attributes, GEN_AI.toolType);
  if (toolType !== undefined) accumulator.attributes['toolType'] = toolType;
  return accumulator;
};

const accumulateEdge = (
  edges: Map<string, EdgeAccumulator>,
  ends: {
    readonly from: ComponentAccumulator;
    readonly toKind: ComponentKind;
    readonly toObservedName: string;
    readonly fromKey: string;
    readonly toKey: string;
  },
  node: SpanNode,
  facts: {
    readonly tokens: SpanTokens;
    readonly retried: boolean;
    readonly parallel: number;
    readonly evidenceId: string;
  },
): void => {
  const span = node.span;
  const edgeKind = edgeKindFor(ends.from.kind, ends.toKind, span.operation);
  const edgeKey = `${edgeKind}|${ends.fromKey}|${ends.toKey}`;
  const edge: EdgeAccumulator = edges.get(edgeKey) ?? {
    kind: edgeKind,
    fromKind: ends.from.kind,
    fromObservedName: ends.from.observedName,
    toKind: ends.toKind,
    toObservedName: ends.toObservedName,
    executionCount: 0,
    errorCount: 0,
    retryCount: 0,
    parallelCount: 0,
    totalDurationMs: 0,
    durationsMs: [],
    inputTokens: 0,
    outputTokens: 0,
    evidence: new Set<string>(),
  };
  edge.executionCount += 1;
  edge.errorCount += span.status === 'error' ? 1 : 0;
  edge.retryCount += facts.retried ? 1 : 0;
  edge.parallelCount += facts.parallel > 0 ? 1 : 0;
  edge.totalDurationMs += span.durationMs;
  edge.durationsMs.push(span.durationMs);
  edge.inputTokens += facts.tokens.inputTokens;
  edge.outputTokens += facts.tokens.outputTokens;
  edge.evidence.add(facts.evidenceId);
  edges.set(edgeKey, edge);
};

const projectComponents = (
  components: ReadonlyMap<string, ComponentAccumulator>,
): ObservedComponent[] =>
  [...components.values()].map((accumulator) => ({
    kind: accumulator.kind,
    observedName: accumulator.observedName,
    operation: accumulator.operation,
    spanCount: accumulator.spanCount,
    errorCount: accumulator.errorCount,
    retryCount: accumulator.retryCount,
    selfDurationMs: accumulator.selfDurationMs,
    totalDurationMs: accumulator.totalDurationMs,
    durationsMs: accumulator.durationsMs,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    ...(accumulator.provider === undefined ? {} : { provider: accumulator.provider }),
    ...(accumulator.model === undefined ? {} : { model: accumulator.model }),
    ...(accumulator.codeLocation === undefined ? {} : { codeLocation: accumulator.codeLocation }),
    ...(accumulator.mcpServer === undefined ? {} : { mcpServer: accumulator.mcpServer }),
    performedSideEffect: accumulator.performedSideEffect,
    evidence: [...accumulator.evidence] as EvidenceId[],
    attributes: accumulator.attributes,
  }));

const projectEdges = (edges: ReadonlyMap<string, EdgeAccumulator>): ObservedEdge[] =>
  [...edges.values()].map((accumulator) => ({
    kind: accumulator.kind,
    fromKind: accumulator.fromKind,
    fromObservedName: accumulator.fromObservedName,
    toKind: accumulator.toKind,
    toObservedName: accumulator.toObservedName,
    executionCount: accumulator.executionCount,
    errorCount: accumulator.errorCount,
    retryCount: accumulator.retryCount,
    parallelCount: accumulator.parallelCount,
    totalDurationMs: accumulator.totalDurationMs,
    durationsMs: accumulator.durationsMs,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    evidence: [...accumulator.evidence] as EvidenceId[],
  }));

/**
 * Occurrences beyond the first of the same logical operation.
 *
 * A failed attempt changed nothing outside the system, so it is not an occurrence. An unknown outcome is counted,
 * because a timeout that may have committed is the case this metric exists for. The reconciliation delta uses the same
 * rule, so the two can never disagree about one run.
 */
const countDuplicateEffects = (effects: readonly SideEffectRecord[]): number => {
  const counts = new Map<string, number>();
  for (const effect of effects) {
    if (effect.outcome === 'failed') continue;
    const key =
      effect.idempotencyKey === undefined
        ? `${effect.kind}|${effect.target}`
        : `${effect.kind}|${effect.target}|${effect.idempotencyKey}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
};

type TraversalState = {
  readonly components: Map<string, ComponentAccumulator>;
  readonly edges: Map<string, EdgeAccumulator>;
  readonly evidence: Evidence[];
  readonly spanToComponentKey: Map<string, string>;
  readonly unattributed: Map<string, number>;
  readonly metrics: RunCounters;
};

const emptyTraversalState = (): TraversalState => ({
  components: new Map(),
  edges: new Map(),
  evidence: [],
  spanToComponentKey: new Map(),
  unattributed: new Map(),
  metrics: {
    modelCalls: 0,
    toolCalls: 0,
    agentSteps: 0,
    handoffs: 0,
    retrievalCalls: 0,
    memoryOperations: 0,
    inputTokens: 0,
    outputTokens: 0,
    errors: 0,
    retries: 0,
    loopIterations: 0,
    queueWaitMs: 0,
    userInterventions: 0,
    policyViolations: 0,
    maxObservedConcurrency: 0,
  },
});

/** One span folded into the traversal state, then its children. */
const visitSpan = (
  state: TraversalState,
  bundle: TraceBundle,
  node: SpanNode,
  parent: SpanNode | undefined,
): void => {
  const { components, edges, evidence, spanToComponentKey, unattributed, metrics } = state;
  const span = node.span;
  const kind = componentKindFor(span.operation);
  if (kind === undefined) {
    const reason = span.operation === 'unclassified' ? 'no_operation' : 'unsupported_dialect';
    unattributed.set(reason, (unattributed.get(reason) ?? 0) + 1);
    for (const child of node.children) visitSpan(state, bundle, child, node);
    return;
  }
  const observedName = observedNameFor(span.operation, span.name, span.attributes);
  const key = componentKey(kind, observedName);
  spanToComponentKey.set(span.spanId, key);

  const tokens = tokensOf(span);
  const retried = isRetry(parent, node);
  const parallel = parallelSiblings(parent, node);

  const spanRecord = spanEvidence({
    producer: PRODUCER,
    runId: bundle.runId,
    traceId: span.traceId,
    spanId: span.spanId,
    spanName: span.name,
    attribute: GEN_AI.operationName,
    attributeValue: span.operation,
  });
  evidence.push(spanRecord);

  const facts = { tokens, retried, evidenceId: spanRecord.id };
  components.set(
    key,
    accumulateComponent(
      components.get(key) ?? emptyAccumulator(kind, observedName, span.operation),
      node,
      facts,
    ),
  );

  metrics.inputTokens += tokens.inputTokens;
  metrics.outputTokens += tokens.outputTokens;
  if (span.status === 'error') metrics.errors += 1;
  if (retried) metrics.retries += 1;
  metrics.maxObservedConcurrency = Math.max(metrics.maxObservedConcurrency, parallel + 1);
  countOperation(metrics, span);

  const parentKey = parent === undefined ? undefined : spanToComponentKey.get(parent.span.spanId);
  const parentAccumulator = parentKey === undefined ? undefined : components.get(parentKey);
  if (parentKey !== undefined && parentKey !== key && parentAccumulator !== undefined) {
    accumulateEdge(
      edges,
      {
        from: parentAccumulator,
        toKind: kind,
        toObservedName: observedName,
        fromKey: parentKey,
        toKey: key,
      },
      node,
      { ...facts, parallel },
    );
  }

  for (const child of node.children) visitSpan(state, bundle, child, node);
};

export const deriveTopology = (bundle: TraceBundle): TopologyResult => {
  const { roots } = buildForest(bundle.spans);
  const state = emptyTraversalState();
  const { components, edges, evidence, spanToComponentKey, unattributed, metrics } = state;

  for (const root of roots) visitSpan(state, bundle, root, undefined);

  const rootDuration = roots.reduce((total, node) => Math.max(total, node.span.durationMs), 0);
  const rootSpan = roots[0]?.span;
  const taskSuccess =
    rootSpan === undefined ? undefined : readBoolean(rootSpan.attributes, ORCHESCOPE.taskSuccess);
  const timeToFirstOutput =
    rootSpan === undefined ? undefined : readNumber(rootSpan.attributes, GEN_AI.timeToFirstChunk);

  const observedComponents = projectComponents(components);
  const observedEdges = projectEdges(edges);
  const duplicateSideEffects = countDuplicateEffects(bundle.sideEffects);
  const effectsThatHappened = bundle.sideEffects.filter((effect) => effect.outcome !== 'failed');
  const vcsRevision = bundle.spans
    .map((span) =>
      readString(span.attributes, 'vcs.repository.ref.revision', 'vcs.ref.head.revision'),
    )
    .find((value) => value !== undefined);
  const vcsRepository = bundle.spans
    .map((span) => readString(span.attributes, 'vcs.repository.name'))
    .find((value) => value !== undefined);

  const runMetrics: RunMetrics = {
    durationMs: rootDuration,
    ...(timeToFirstOutput === undefined ? {} : { timeToFirstOutputMs: timeToFirstOutput }),
    ...(taskSuccess === undefined ? {} : { taskSuccess }),
    modelCalls: metrics.modelCalls,
    toolCalls: metrics.toolCalls,
    agentSteps: metrics.agentSteps,
    handoffs: metrics.handoffs,
    retrievalCalls: metrics.retrievalCalls,
    memoryOperations: metrics.memoryOperations,
    ...(metrics.queueWaitMs === 0 ? {} : { queueWaitMs: metrics.queueWaitMs }),
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    errors: metrics.errors,
    retries: metrics.retries,
    recoveredErrors: Math.min(metrics.errors, metrics.retries),
    duplicateSideEffects,
    prohibitedSideEffects: 0,
    sideEffects: effectsThatHappened.length,
    userInterventions: metrics.userInterventions,
    policyViolations: metrics.policyViolations,
    maxObservedConcurrency: metrics.maxObservedConcurrency,
    loopIterations: metrics.loopIterations,
  };

  const componentMetricsByName = [...components.values()].map((accumulator) => ({
    componentId: 'unassigned',
    observedName: accumulator.observedName,
    kind: accumulator.kind,
    executionCount: accumulator.spanCount,
    selfDurationMs: accumulator.selfDurationMs,
    totalDurationMs: accumulator.totalDurationMs,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    errorCount: accumulator.errorCount,
    retryCount: accumulator.retryCount,
  }));

  return {
    topology: {
      runIds: [bundle.runId],
      components: observedComponents,
      edges: observedEdges,
      sideEffects: [...bundle.sideEffects],
      ...(vcsRevision === undefined && vcsRepository === undefined
        ? {}
        : {
            vcs: {
              ...(vcsRevision === undefined ? {} : { revision: vcsRevision }),
              ...(vcsRepository === undefined ? {} : { repositoryName: vcsRepository }),
            },
          }),
      unattributed: [...unattributed].map(([reason, count]) => ({
        reason: reason as 'no_operation' | 'no_name' | 'unsupported_dialect',
        count,
      })),
    },
    evidence,
    runMetrics,
    componentMetricsByName,
    spanToComponentKey,
  };
};

export { componentKey };
