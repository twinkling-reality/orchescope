import { spanEvidence } from '@orchescope/domain';
import type {
  AgentOperation,
  ComponentKind,
  ComponentRunMetrics,
  Evidence,
  EvidenceId,
  MissingSpanAttribute,
  NormalizedSpan,
  ObservedComponent,
  ObservedEdge,
  ObservedContentLocation,
  ObservedSource,
  ObservedValueProvenance,
  RunMetrics,
  RuntimeTopology,
  SideEffectRecord,
  TraceBundle,
} from '@orchescope/schema';
import {
  componentKindFor,
  GEN_AI,
  MCP,
  modelNamed,
  ORCHESCOPE,
  observedNameWithProvenance,
  operationWithProvenance,
  providerNamed,
  readBoolean,
  readNumber,
  readString,
} from './attributes.ts';
import { graphNodeSpan } from './graph-node-span.ts';
import { type ObservedHandoff, recognizeHandoffs } from './handoff.ts';
import {
  type SourceIdentityResult,
  sourceIdentityKey,
  sourceIdentityOf,
} from './source-identity.ts';
import { isStructuralSpan } from './structural-span.ts';
import { supersededSpans } from './superseded-span.ts';

/**
 * Runtime topology derivation.
 *
 * Spans become components and relations. Four facts are computed here that a raw span list does not
 * contain and that the findings depend on:
 *
 *  - self time, so latency can be attributed to the component that actually spent it rather than to
 *    every ancestor that was waiting;
 *  - whether sibling calls overlapped in wall clock, which is the difference between "these two tools
 *    ran in parallel" and "these two tools ran one after the other";
 *  - retries, counted only when an earlier sibling with the same name ended in error, so a loop that
 *    legitimately calls the same tool three times is not reported as two retries;
 *  - which tool spans were transfers of control, which one span cannot answer because it depends on
 *    what the rest of the run reported as agents.
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
  observedSource: ObservedSource | undefined;
  observedContent: ObservedContentLocation | undefined;
  sourceRefusals: Map<string, MissingSpanAttribute>;
  mcpServer: string | undefined;
  performedSideEffect: boolean;
  evidence: Set<string>;
  attributes: Record<string, string | number | boolean>;
  provenance: {
    readonly kind: MutableValueProvenance;
    readonly name: MutableValueProvenance;
    readonly codeLocation: MutableValueProvenance;
  };
};

type EdgeAccumulator = {
  kind: string;
  fromKind: string;
  fromObservedName: string;
  fromObservedSource: ObservedSource | undefined;
  toKind: string;
  toObservedName: string;
  toObservedSource: ObservedSource | undefined;
  executionCount: number;
  errorCount: number;
  retryCount: number;
  parallelCount: number;
  totalDurationMs: number;
  durationsMs: number[];
  inputTokens: number;
  outputTokens: number;
  evidence: Set<string>;
  provenance: {
    readonly relation: MutableValueProvenance;
    readonly from: MutableValueProvenance;
    readonly to: MutableValueProvenance;
  };
};

type MutableValueProvenance = {
  readonly attributes: Set<string>;
  readonly resourceAttributes: Set<string>;
  readonly spanFields: Set<ObservedValueProvenance['spanFields'][number]>;
};

const mutableProvenance = (
  source: ObservedValueProvenance = { attributes: [], spanFields: [] },
): MutableValueProvenance => ({
  attributes: new Set(source.attributes),
  resourceAttributes: new Set(source.resourceAttributes ?? []),
  spanFields: new Set(source.spanFields),
});

const mergeProvenance = (
  target: MutableValueProvenance,
  source: ObservedValueProvenance | MutableValueProvenance,
): void => {
  for (const attribute of source.attributes) target.attributes.add(attribute);
  for (const attribute of source.resourceAttributes ?? []) target.resourceAttributes.add(attribute);
  for (const field of source.spanFields) target.spanFields.add(field);
};

const projectProvenance = (source: MutableValueProvenance): ObservedValueProvenance => ({
  attributes: [...source.attributes].sort(),
  ...(source.resourceAttributes.size === 0
    ? {}
    : { resourceAttributes: [...source.resourceAttributes].sort() }),
  spanFields: [...source.spanFields].sort(),
});

const missingAttributeKey = (missing: MissingSpanAttribute): string =>
  `${missing.purpose}|${missing.attribute}|${missing.reason ?? ''}`;

/**
 * What one span nested inside another says about the two components, read from the child's kind.
 *
 * For most kinds the child settles it whatever the parent was: a span that contained a tool span called
 * that tool, and one that contained a model span invoked that model. An agent is the exception, because
 * what it means to run an agent depends on what ran it, which is why `edgeKindFor` asks about the parent
 * before consulting this table.
 */
const EDGE_KIND_BY_TARGET: Readonly<Partial<Record<ComponentKind, string>>> = {
  model: 'invokes_model',
  tool: 'calls_tool',
  agent: 'contains',
  agent_group: 'contains',
  workflow: 'contains',
  workflow_step: 'contains',
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

/**
 * A nesting is a handoff only between two agents.
 *
 * An agent whose span contains another agent's span gave it the work, and `hands_off_to` is this
 * vocabulary's word for that: the demonstration system declares exactly that relation between its
 * orchestrator and its workers, and its run nests them, so this is the branch that joins the two.
 *
 * Anything else that contains an agent span merely ran it, and calling that a handoff was reporting a
 * transfer of control that never happened. A guardrail whose implementation is an agent produced
 * `hands_off_to` from the evaluator to the agent of the same name, which reads as a component handing
 * off to itself. Containment is what was observed and `contains` is what it is called, which also keeps
 * it out of the control flow projection, where a relation this build could not name has no business
 * contributing a cycle or a fan out.
 */
const edgeKindFor = (fromKind: string, toKind: ComponentKind, operation: string): string => {
  if (operation === 'memory_write') return 'writes_memory';
  if (fromKind === 'agent' && toKind === 'agent') return 'hands_off_to';
  return EDGE_KIND_BY_TARGET[toKind] ?? 'observed_after';
};

const componentKey = (kind: string, name: string, source?: ObservedSource): string => {
  const base = `${kind}|${name.toLowerCase()}`;
  return source === undefined ? base : `${base}|${sourceIdentityKey(source)}`;
};

const evidenceAttribute = (
  span: NormalizedSpan,
  provenance: ObservedValueProvenance,
): { readonly attribute?: string; readonly attributeValue?: string } => {
  const attribute = provenance.attributes[0];
  if (attribute === undefined) return {};
  const value = span.attributes[attribute];
  return {
    attribute,
    ...(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? { attributeValue: String(value) }
      : {}),
  };
};

export type TopologyResult = {
  readonly topology: RuntimeTopology;
  readonly evidence: readonly Evidence[];
  readonly runMetrics: RunMetrics;
  readonly componentMetricsByName: readonly (ComponentRunMetrics & {
    readonly observedName: string;
    readonly kind: string;
    readonly observedSource?: ObservedSource;
    readonly observedContent?: ObservedContentLocation;
    /** The provider and model the spans reported, which is what a price is keyed by. */
    readonly provider: string | undefined;
    readonly model: string | undefined;
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

const countOperation = (
  metrics: RunCounters,
  span: NormalizedSpan,
  operation: AgentOperation,
): void => {
  const counter = COUNTER_BY_OPERATION[operation];
  if (counter !== undefined) metrics[counter] += 1;
  if (operation === 'queue_wait') metrics.queueWaitMs += span.durationMs;
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
  source: SourceIdentityResult,
  provenance: {
    readonly kind: ObservedValueProvenance;
    readonly name: ObservedValueProvenance;
  },
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
  codeLocation: source.codeLocation,
  observedSource: source.observedSource,
  observedContent: source.observedContent,
  sourceRefusals: new Map(
    source.refusals.map((missing) => [missingAttributeKey(missing), missing]),
  ),
  mcpServer: undefined,
  performedSideEffect: false,
  evidence: new Set<string>(),
  attributes: {},
  provenance: {
    kind: mutableProvenance(provenance.kind),
    name: mutableProvenance(provenance.name),
    codeLocation: mutableProvenance(source.codeLocationProvenance),
  },
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
    readonly source: SourceIdentityResult;
    readonly provenance: {
      readonly kind: ObservedValueProvenance;
      readonly name: ObservedValueProvenance;
    };
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
  mergeProvenance(accumulator.provenance.kind, facts.provenance.kind);
  mergeProvenance(accumulator.provenance.name, facts.provenance.name);
  accumulator.provider = accumulator.provider ?? providerNamed(span.attributes);
  accumulator.model = accumulator.model ?? modelNamed(span.attributes);
  accumulator.codeLocation = accumulator.codeLocation ?? facts.source.codeLocation;
  accumulator.observedSource = accumulator.observedSource ?? facts.source.observedSource;
  accumulator.observedContent = accumulator.observedContent ?? facts.source.observedContent;
  mergeProvenance(accumulator.provenance.codeLocation, facts.source.codeLocationProvenance);
  for (const missing of facts.source.refusals) {
    const key = missingAttributeKey(missing);
    const previous = accumulator.sourceRefusals.get(key);
    accumulator.sourceRefusals.set(key, {
      ...missing,
      evidence:
        previous?.evidence === undefined || previous.evidence.length === 0
          ? [facts.evidenceId as EvidenceId]
          : previous.evidence,
    });
  }
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

/** Both ends of an observed relation, named the way the run named them. */
type EdgeEnds = {
  readonly kind: string;
  readonly fromKind: string;
  readonly fromObservedName: string;
  readonly fromObservedSource?: ObservedSource;
  readonly fromKey: string;
  readonly toKind: string;
  readonly toObservedName: string;
  readonly toObservedSource?: ObservedSource;
  readonly toKey: string;
  readonly provenance: {
    readonly relation: ObservedValueProvenance;
    readonly from: ObservedValueProvenance | MutableValueProvenance;
    readonly to: ObservedValueProvenance | MutableValueProvenance;
  };
};

const accumulateEdge = (
  edges: Map<string, EdgeAccumulator>,
  ends: EdgeEnds,
  node: SpanNode,
  facts: {
    readonly tokens: SpanTokens;
    readonly retried: boolean;
    readonly parallel: number;
    readonly evidenceId: string;
  },
): void => {
  const span = node.span;
  const edgeKey = `${ends.kind}|${ends.fromKey}|${ends.toKey}`;
  const edge: EdgeAccumulator = edges.get(edgeKey) ?? {
    kind: ends.kind,
    fromKind: ends.fromKind,
    fromObservedName: ends.fromObservedName,
    fromObservedSource: ends.fromObservedSource,
    toKind: ends.toKind,
    toObservedName: ends.toObservedName,
    toObservedSource: ends.toObservedSource,
    executionCount: 0,
    errorCount: 0,
    retryCount: 0,
    parallelCount: 0,
    totalDurationMs: 0,
    durationsMs: [],
    inputTokens: 0,
    outputTokens: 0,
    evidence: new Set<string>(),
    provenance: {
      relation: mutableProvenance(),
      from: mutableProvenance(),
      to: mutableProvenance(),
    },
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
  mergeProvenance(edge.provenance.relation, ends.provenance.relation);
  mergeProvenance(edge.provenance.from, ends.provenance.from);
  mergeProvenance(edge.provenance.to, ends.provenance.to);
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
    ...(accumulator.observedSource === undefined
      ? {}
      : { observedSource: accumulator.observedSource }),
    ...(accumulator.observedContent === undefined
      ? {}
      : { observedContent: accumulator.observedContent }),
    ...(accumulator.mcpServer === undefined ? {} : { mcpServer: accumulator.mcpServer }),
    performedSideEffect: accumulator.performedSideEffect,
    evidence: [...accumulator.evidence] as EvidenceId[],
    attributes: accumulator.attributes,
    provenance: {
      kind: projectProvenance(accumulator.provenance.kind),
      name: projectProvenance(accumulator.provenance.name),
      codeLocation: projectProvenance(accumulator.provenance.codeLocation),
    },
  }));

const projectEdges = (edges: ReadonlyMap<string, EdgeAccumulator>): ObservedEdge[] =>
  [...edges.values()].map((accumulator) => ({
    kind: accumulator.kind,
    fromKind: accumulator.fromKind,
    fromObservedName: accumulator.fromObservedName,
    ...(accumulator.fromObservedSource === undefined
      ? {}
      : { fromObservedSource: accumulator.fromObservedSource }),
    toKind: accumulator.toKind,
    toObservedName: accumulator.toObservedName,
    ...(accumulator.toObservedSource === undefined
      ? {}
      : { toObservedSource: accumulator.toObservedSource }),
    executionCount: accumulator.executionCount,
    errorCount: accumulator.errorCount,
    retryCount: accumulator.retryCount,
    parallelCount: accumulator.parallelCount,
    totalDurationMs: accumulator.totalDurationMs,
    durationsMs: accumulator.durationsMs,
    inputTokens: accumulator.inputTokens,
    outputTokens: accumulator.outputTokens,
    evidence: [...accumulator.evidence] as EvidenceId[],
    provenance: {
      relation: projectProvenance(accumulator.provenance.relation),
      from: projectProvenance(accumulator.provenance.from),
      to: projectProvenance(accumulator.provenance.to),
    },
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
  /** Span identifier to the transfer of control it recorded, for the spans that recorded one. */
  readonly handoffs: ReadonlyMap<string, ObservedHandoff>;
  /** Spans another producer already reported, which are read as nothing rather than as a second call. */
  readonly superseded: ReadonlySet<string>;
};

const emptyTraversalState = (
  handoffs: ReadonlyMap<string, ObservedHandoff>,
  superseded: ReadonlySet<string>,
): TraversalState => ({
  components: new Map(),
  edges: new Map(),
  evidence: [],
  spanToComponentKey: new Map(),
  unattributed: new Map(),
  handoffs,
  superseded,
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

/**
 * A transfer of control becomes a relation and never a component.
 *
 * The span carries both ends, so the relation is drawn between the two agents rather than from
 * whatever happened to be the parent span, which on the SDK that emits these is the turn the handoff
 * was decided in. Both ends are already components: a span is only read as a handoff when the run
 * reported both of its names as agents. The time the transfer took is attributed to the edge, which
 * is the only thing it can honestly be attributed to.
 */
const recordHandoff = (
  state: TraversalState,
  node: SpanNode,
  parent: SpanNode | undefined,
  handoff: ObservedHandoff,
  evidenceId: EvidenceId,
): void => {
  const span = node.span;
  const retried = isRetry(parent, node);
  const parallel = parallelSiblings(parent, node);
  accumulateEdge(
    state.edges,
    {
      kind: 'hands_off_to',
      fromKind: 'agent',
      fromObservedName: handoff.fromAgent,
      fromKey: componentKey('agent', handoff.fromAgent),
      toKind: 'agent',
      toObservedName: handoff.toAgent,
      toKey: componentKey('agent', handoff.toAgent),
      provenance: handoff.provenance,
    },
    node,
    { tokens: tokensOf(span), retried, parallel, evidenceId },
  );

  if (span.status === 'error') state.metrics.errors += 1;
  if (retried) state.metrics.retries += 1;
  state.metrics.maxObservedConcurrency = Math.max(
    state.metrics.maxObservedConcurrency,
    parallel + 1,
  );
  countOperation(state.metrics, span, 'handoff');
};

/**
 * What a span that is no component of its own leaves its children attached to.
 *
 * A relation is drawn to the nearest component that enclosed the work, and a span this build could not
 * attribute to one does not break that chain. The alternative is to draw nothing, which loses a relation
 * the run does show and is quieter rather than more honest: the AI SDK opens a `step` span around every
 * model call and tool call an agent makes, and severing there left a run of six spans that reached a
 * model and a tool reporting no observed relation at all.
 *
 * A side effect recorded on such a span belongs to the same component, which is what this map is read
 * for elsewhere.
 */
const encloseChildren = (
  state: TraversalState,
  node: SpanNode,
  parent: SpanNode | undefined,
): void => {
  const parentKey =
    parent === undefined ? undefined : state.spanToComponentKey.get(parent.span.spanId);
  if (parentKey !== undefined) state.spanToComponentKey.set(node.span.spanId, parentKey);
};

/**
 * The component a span reports, or the reason it reports none.
 *
 * The graph node is asked first because it outranks the kind the dialect gives the span: LangChain labels
 * a graph, a node and a lambda alike as a chain, so the kind decides an operation of `invoke_workflow` for
 * all three, while the node the span names is one of the application's own workflow steps. Where nothing names a
 * node this is the reading it always was.
 */
const componentOf = (
  span: NormalizedSpan,
):
  | {
      readonly kind: ComponentKind;
      readonly observedName: string;
      readonly provenance: {
        readonly kind: ObservedValueProvenance;
        readonly name: ObservedValueProvenance;
      };
    }
  | { readonly reason: string } => {
  const graphNode = graphNodeSpan(span);
  if (graphNode !== undefined) {
    return {
      kind: 'workflow_step',
      observedName: graphNode.name,
      provenance: { kind: graphNode.provenance, name: graphNode.provenance },
    };
  }
  if (isStructuralSpan(span)) return { reason: 'no_name' };
  const kind = componentKindFor(span.operation);
  if (kind === undefined) {
    return { reason: span.operation === 'unclassified' ? 'no_operation' : 'unsupported_dialect' };
  }
  const named = observedNameWithProvenance(span.operation, span.name, span.attributes);
  return {
    kind,
    observedName: named.name,
    provenance: {
      kind: operationWithProvenance(span.name, span.attributes).provenance,
      name: named.provenance,
    },
  };
};

/** One span folded into the traversal state, then its children. */
const visitSpan = (
  state: TraversalState,
  bundle: TraceBundle,
  node: SpanNode,
  parent: SpanNode | undefined,
): void => {
  const { components, edges, evidence, spanToComponentKey, unattributed, metrics } = state;
  const span = node.span;
  const handoff = state.handoffs.get(span.spanId);
  if (handoff !== undefined) {
    const record = spanEvidence({
      producer: PRODUCER,
      runId: bundle.runId,
      traceId: span.traceId,
      spanId: span.spanId,
      spanName: span.name,
      ...evidenceAttribute(span, handoff.provenance.relation),
    });
    evidence.push(record);
    recordHandoff(state, node, parent, handoff, record.id);
    encloseChildren(state, node, parent);
    for (const child of node.children) visitSpan(state, bundle, child, node);
    return;
  }
  /*
   * A call another producer already reported is read as nothing at all, rather than as a second call. It is
   * not counted as unattributed, because nothing it said went unreported.
   */
  if (state.superseded.has(span.spanId)) {
    evidence.push(
      spanEvidence({
        producer: PRODUCER,
        runId: bundle.runId,
        traceId: span.traceId,
        spanId: span.spanId,
        spanName: span.name,
      }),
    );
    encloseChildren(state, node, parent);
    for (const child of node.children) visitSpan(state, bundle, child, node);
    return;
  }
  const component = componentOf(span);
  if ('reason' in component) {
    evidence.push(
      spanEvidence({
        producer: PRODUCER,
        runId: bundle.runId,
        traceId: span.traceId,
        spanId: span.spanId,
        spanName: span.name,
      }),
    );
    unattributed.set(component.reason, (unattributed.get(component.reason) ?? 0) + 1);
    encloseChildren(state, node, parent);
    for (const child of node.children) visitSpan(state, bundle, child, node);
    return;
  }
  const { kind, observedName, provenance } = component;
  const source = sourceIdentityOf(span);
  const key = componentKey(kind, observedName, source.observedSource);
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
    observedComponent: { kind, observedName },
    ...evidenceAttribute(
      span,
      provenance.name.attributes.length > 0 ? provenance.name : provenance.kind,
    ),
  });
  evidence.push(spanRecord);

  const facts = { tokens, retried, evidenceId: spanRecord.id, source, provenance };
  components.set(
    key,
    accumulateComponent(
      components.get(key) ??
        emptyAccumulator(kind, observedName, span.operation, source, provenance),
      node,
      facts,
    ),
  );

  metrics.inputTokens += tokens.inputTokens;
  metrics.outputTokens += tokens.outputTokens;
  if (span.status === 'error') metrics.errors += 1;
  if (retried) metrics.retries += 1;
  metrics.maxObservedConcurrency = Math.max(metrics.maxObservedConcurrency, parallel + 1);
  countOperation(metrics, span, span.operation);

  const parentKey = parent === undefined ? undefined : spanToComponentKey.get(parent.span.spanId);
  const parentAccumulator = parentKey === undefined ? undefined : components.get(parentKey);
  if (parentKey !== undefined && parentKey !== key && parentAccumulator !== undefined) {
    accumulateEdge(
      edges,
      {
        kind: edgeKindFor(parentAccumulator.kind, kind, span.operation),
        fromKind: parentAccumulator.kind,
        fromObservedName: parentAccumulator.observedName,
        ...(parentAccumulator.observedSource === undefined
          ? {}
          : { fromObservedSource: parentAccumulator.observedSource }),
        fromKey: parentKey,
        toKind: kind,
        toObservedName: observedName,
        ...(facts.source.observedSource === undefined
          ? {}
          : { toObservedSource: facts.source.observedSource }),
        toKey: key,
        provenance: {
          relation: { attributes: [], spanFields: ['parentSpanId'] },
          from: parentAccumulator.provenance.name,
          to: provenance.name,
        },
      },
      node,
      { ...facts, parallel },
    );
  }

  for (const child of node.children) visitSpan(state, bundle, child, node);
};

const missingSourceAttributesOf = (
  components: ReadonlyMap<string, ComponentAccumulator>,
): MissingSpanAttribute[] => {
  const missingSourceAttributes = new Map<string, MissingSpanAttribute>();
  for (const accumulator of components.values()) {
    for (const missing of accumulator.sourceRefusals.values()) {
      const key = missingAttributeKey(missing);
      const previous = missingSourceAttributes.get(key);
      const evidence = [
        ...new Set([...(previous?.evidence ?? []), ...(missing.evidence ?? [])]),
      ].sort();
      const sample = evidence.slice(0, 10) as EvidenceId[];
      const observedComponents = (previous?.observedComponents ?? 0) + 1;
      missingSourceAttributes.set(key, {
        ...missing,
        observedComponents,
        ...(sample.length === 0 ? {} : { evidence: sample }),
        ...(observedComponents <= sample.length
          ? {}
          : { evidenceOmitted: observedComponents - sample.length }),
      });
    }
  }
  return [...missingSourceAttributes.values()].sort((left, right) => {
    const leftKey = missingAttributeKey(left);
    const rightKey = missingAttributeKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
};

export const deriveTopology = (bundle: TraceBundle): TopologyResult => {
  const { roots } = buildForest(bundle.spans);
  const state = emptyTraversalState(recognizeHandoffs(bundle.spans), supersededSpans(bundle.spans));
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
  const missingSourceAttributes = missingSourceAttributesOf(components);
  const duplicateSideEffects = countDuplicateEffects(bundle.sideEffects);
  const effectsThatHappened = bundle.sideEffects.filter((effect) => effect.outcome !== 'failed');
  const observedSources = observedComponents
    .map((component) => component.observedSource?.identity)
    .filter((source) => source !== undefined);
  const vcsRevisions = new Set(observedSources.map((source) => source.revision));
  const vcsRepositories = new Set(observedSources.map((source) => source.repositoryUrl));
  const vcsRevision = vcsRevisions.size === 1 ? [...vcsRevisions][0] : undefined;
  const vcsRepositoryUrl = vcsRepositories.size === 1 ? [...vcsRepositories][0] : undefined;

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
    ...(accumulator.observedSource === undefined
      ? {}
      : { observedSource: accumulator.observedSource }),
    provider: accumulator.provider,
    model: accumulator.model,
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
      coverage: {
        acceptedSpans: bundle.spans.length,
        droppedSpans: bundle.droppedSpanCount,
        rejectedSpans: bundle.rejected.reduce((total, entry) => total + entry.count, 0),
        missingSpanAttributes: missingSourceAttributes,
      },
      ...(vcsRevision === undefined && vcsRepositoryUrl === undefined
        ? {}
        : {
            vcs: {
              ...(vcsRevision === undefined ? {} : { revision: vcsRevision }),
              ...(vcsRepositoryUrl === undefined ? {} : { repositoryUrl: vcsRepositoryUrl }),
            },
          }),
      unattributed: [...unattributed].map(([reason, count]) => ({
        reason: reason as 'no_operation' | 'no_name' | 'unsupported_dialect',
        count,
      })),
    },
    evidence: [...evidence].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
    runMetrics,
    componentMetricsByName,
    spanToComponentKey,
  };
};

export { componentKey };
