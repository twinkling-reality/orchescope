import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NormalizedSpan, ObservedEdge } from '@orchescope/schema';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson } from '../src/otlp.ts';
import { deriveTopology } from '../src/topology.ts';

/**
 * What the OpenAI Agents SDK's spans mean to this build.
 *
 * The spans below are copied from two stored runs, one per instrumentor. The Python one is the pinned
 * `openai-cs-agents-demo` checkout, which is the first traced run of a third party application this build
 * measured. The JavaScript one is the pinned `openai-agents-js` checkout's own customer service example.
 * Identifiers, names, attributes and nesting are each instrumentor's own; only the timestamps are rounded,
 * because nothing asserted here depends on a sub millisecond duration.
 *
 * Two of its spans say something other than what they appear to say, and both were found by running
 * this on somebody else's application. A handoff arrives as a tool call. The trace and the agent loop
 * arrive as an agent and two workflows, and reading those as components put a wrapper between every
 * agent and everything it did.
 *
 * They are held verbatim so that a rename in `openinference-instrumentation-openai-agents` fails here
 * rather than going quiet. The quiet failure is the one this build keeps hitting: an attribute moves,
 * the join stops happening, and every report afterwards names something nothing declared instead of
 * saying that it could not tell.
 */

const TRACE = 'c21e7d4d291292882f315ce37c36d64e';

type SpanInput = {
  readonly name: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly start: number;
  readonly end: number;
  readonly attributes: Readonly<Record<string, string>>;
};

const attributeList = (attributes: Readonly<Record<string, string>>) =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: value } }));

const nanos = (ms: number): string => String(BigInt(ms) * 1_000_000n);

const bundleOf = (spans: readonly SpanInput[], service = 'openai-cs-agents-demo-exercised') => {
  const decoded = decodeTraceJson({
    resourceSpans: [
      {
        resource: {
          attributes: attributeList({ 'service.name': service }),
        },
        scopeSpans: [
          {
            scope: { name: 'openinference.instrumentation.openai_agents' },
            spans: spans.map((span) => ({
              traceId: TRACE,
              spanId: span.spanId,
              ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
              name: span.name,
              kind: 1,
              startTimeUnixNano: nanos(span.start),
              endTimeUnixNano: nanos(span.end),
              attributes: attributeList(span.attributes),
              status: { code: 1 },
            })),
          },
        ],
      },
    ],
  });
  return normalizeTraces(decoded, {
    runId: `run_${'0'.repeat(16)}`,
    capturedAt: '2026-08-19T00:00:00.000Z',
    source: 'otlp_http_json',
    maxSpans: 100,
    maxAttributeBytes: 4096,
  }).bundle;
};

const TRIAGE_AGENT: SpanInput = {
  name: 'Triage Agent',
  spanId: '97d4e2197c40e6fe',
  parentSpanId: '3d2b8d9a3c4f5e61',
  start: 0,
  end: 2003,
  attributes: {
    'agent.name': 'Triage Agent',
    'graph.node.id': 'Triage Agent',
    'openinference.span.kind': 'AGENT',
  },
};

const TRIAGE_TURN: SpanInput = {
  name: 'turn',
  spanId: 'a52f04ee7c01366a',
  parentSpanId: '97d4e2197c40e6fe',
  start: 0,
  end: 2002,
  attributes: { 'openinference.span.kind': 'CHAIN' },
};

const SEAT_AGENT: SpanInput = {
  name: 'Seat and Special Services Agent',
  spanId: '5202d55cca0bb3a1',
  parentSpanId: '3d2b8d9a3c4f5e61',
  start: 2003,
  end: 4263,
  attributes: {
    'agent.name': 'Seat and Special Services Agent',
    'graph.node.id': 'Seat and Special Services Agent',
    'graph.node.parent_id': 'Triage Agent',
    'openinference.span.kind': 'AGENT',
  },
};

const SEAT_TOOL_TURN: SpanInput = {
  name: 'turn',
  spanId: '8105c03afb17e0b6',
  parentSpanId: '5202d55cca0bb3a1',
  start: 2003,
  end: 3159,
  attributes: { 'openinference.span.kind': 'CHAIN' },
};

const SEAT_HANDOFF_TURN: SpanInput = {
  name: 'turn',
  spanId: 'f711ed982c3c8836',
  parentSpanId: '5202d55cca0bb3a1',
  start: 3159,
  end: 4263,
  attributes: { 'openinference.span.kind': 'CHAIN' },
};

/** The transfer out of triage. `input.value` is the agent that gave up control and `output.value` is the one that took it. */
const HANDOFF_TO_SEAT: SpanInput = {
  name: 'handoff to Seat and Special Services Agent',
  spanId: '6055e3a09753fd9a',
  parentSpanId: 'a52f04ee7c01366a',
  start: 2001,
  end: 2002,
  attributes: {
    'input.value': 'Triage Agent',
    'openinference.span.kind': 'TOOL',
    'output.value': 'Seat and Special Services Agent',
  },
};

const HANDOFF_TO_TRIAGE: SpanInput = {
  name: 'handoff to Triage Agent',
  spanId: 'ed543c1ef32e7a07',
  parentSpanId: 'f711ed982c3c8836',
  start: 4262,
  end: 4263,
  attributes: {
    'input.value': 'Seat and Special Services Agent',
    'openinference.span.kind': 'TOOL',
    'output.value': 'Triage Agent',
  },
};

/**
 * The model call inside the triage agent's turn. This one span is trimmed: the instrumentor also
 * records every message and every invocation parameter, and none of that is read here.
 */
const TRIAGE_RESPONSE: SpanInput = {
  name: 'response',
  spanId: '7c1e4b0a55d2f318',
  parentSpanId: 'a52f04ee7c01366a',
  start: 1934,
  end: 2001,
  attributes: {
    'llm.model_name': 'gpt-5.2-2025-12-11',
    'llm.system': 'openai',
    'llm.token_count.completion': '39',
    'llm.token_count.prompt': '224',
    'openinference.span.kind': 'LLM',
  },
};

/** A tool the same run called, recorded by the same instrumentor, which names the tool it called. */
const UPDATE_SEAT: SpanInput = {
  name: 'update_seat',
  spanId: '52640274bc20c3f8',
  parentSpanId: '8105c03afb17e0b6',
  start: 3157,
  end: 3159,
  attributes: {
    'input.mime_type': 'application/json',
    'input.value': '{"confirmation_number":"IR-D204","new_seat":"14A"}',
    'openinference.span.kind': 'TOOL',
    'output.value': 'Updated seat to 14A for confirmation number IR-D204',
    'tool.description': 'Update the seat for a given confirmation number.',
    'tool.name': 'update_seat',
  },
};

/**
 * The trace the SDK opens around a run, and the iteration of the agent loop inside it. Each carries an
 * OpenInference kind and no other attribute: nothing names an agent, and nothing names a workflow.
 */
const TRACE_ROOT: SpanInput = {
  name: 'Agent workflow',
  spanId: '1029198d42df072c',
  start: 0,
  end: 4263,
  attributes: { 'openinference.span.kind': 'AGENT' },
};

const TRACE_CHAIN: SpanInput = {
  name: 'Agent workflow',
  spanId: '3d2b8d9a3c4f5e61',
  parentSpanId: '1029198d42df072c',
  start: 0,
  end: 4263,
  attributes: { 'openinference.span.kind': 'CHAIN' },
};

/** The guardrail, whose span also carries nothing but its kind and whose name is the guardrail's own. */
const RELEVANCE_GUARDRAIL: SpanInput = {
  name: 'Relevance Guardrail',
  spanId: '644b59c912477bc4',
  parentSpanId: 'a52f04ee7c01366a',
  start: 1,
  end: 1934,
  attributes: { 'openinference.span.kind': 'GUARDRAIL' },
};

/**
 * The guardrail is implemented by running an agent, and the run nests the two with the SDK's own trace
 * span between them. The repository declares both: the decorated function the agent list names, and the
 * agent that function runs, which on this demonstration carry the same name.
 */
const RELEVANCE_GUARDRAIL_CHAIN: SpanInput = {
  name: 'Agent workflow',
  spanId: 'b0a1c2d3e4f50617',
  parentSpanId: '644b59c912477bc4',
  start: 1,
  end: 1934,
  attributes: { 'openinference.span.kind': 'CHAIN' },
};

const RELEVANCE_GUARDRAIL_AGENT: SpanInput = {
  name: 'Relevance Guardrail',
  spanId: 'c9e8d7b6a5f43210',
  parentSpanId: 'b0a1c2d3e4f50617',
  start: 1,
  end: 1933,
  attributes: {
    'agent.name': 'Relevance Guardrail',
    'graph.node.id': 'Relevance Guardrail',
    'openinference.span.kind': 'AGENT',
  },
};

const RECORDED_RUN: readonly SpanInput[] = [
  TRACE_ROOT,
  TRACE_CHAIN,
  RELEVANCE_GUARDRAIL,
  RELEVANCE_GUARDRAIL_CHAIN,
  RELEVANCE_GUARDRAIL_AGENT,
  TRIAGE_AGENT,
  TRIAGE_TURN,
  TRIAGE_RESPONSE,
  HANDOFF_TO_SEAT,
  SEAT_AGENT,
  SEAT_TOOL_TURN,
  UPDATE_SEAT,
  SEAT_HANDOFF_TURN,
  HANDOFF_TO_TRIAGE,
];

const describeEdge = (edge: ObservedEdge): string =>
  `${edge.kind} ${edge.fromKind}:${edge.fromObservedName} -> ${edge.toKind}:${edge.toObservedName}`;

const spanNamed = (spans: readonly NormalizedSpan[], spanId: string): NormalizedSpan => {
  const span = spans.find((candidate) => candidate.spanId === spanId);
  assert.ok(span !== undefined, `the fixture carries span ${spanId}`);
  return span;
};

describe('a handoff recorded as a tool call', () => {
  it('reads the recorded run as two transfers of control and one tool call', () => {
    const result = deriveTopology(bundleOf(RECORDED_RUN));

    assert.deepEqual(
      result.topology.components
        .filter((component) => component.kind === 'tool')
        .map((component) => component.observedName),
      ['update_seat'],
    );
    const edges = result.topology.edges.map(describeEdge);
    assert.ok(
      edges.includes('hands_off_to agent:Triage Agent -> agent:Seat and Special Services Agent'),
      edges.join('\n'),
    );
    assert.ok(
      edges.includes('hands_off_to agent:Seat and Special Services Agent -> agent:Triage Agent'),
      edges.join('\n'),
    );
    assert.equal(result.runMetrics.handoffs, 2);
    assert.equal(result.runMetrics.toolCalls, 1);
  });

  it('leaves the span itself classified as the instrumentor recorded it', () => {
    // The span carries `openinference.span.kind: TOOL` and nothing else, so on its own it is a tool
    // call and stays one. What makes it a handoff is the rest of the run, which is why the reading is
    // derived where cross span facts are and not where a single span is classified.
    const bundle = bundleOf(RECORDED_RUN);
    assert.equal(spanNamed(bundle.spans, HANDOFF_TO_SEAT.spanId).operation, 'execute_tool');
  });

  it('attributes the transfer to the edge rather than to either agent', () => {
    const result = deriveTopology(bundleOf(RECORDED_RUN));
    const triage = result.topology.components.find(
      (component) => component.kind === 'agent' && component.observedName === 'Triage Agent',
    );
    assert.equal(triage?.spanCount, 1);
    const handoff = result.topology.edges.find(
      (edge) =>
        describeEdge(edge) ===
        'hands_off_to agent:Triage Agent -> agent:Seat and Special Services Agent',
    );
    assert.equal(handoff?.executionCount, 1);
    assert.equal(handoff?.totalDurationMs, 1);
  });
});

describe('the spans the instrumentation opens for its own structure', () => {
  it('reports no component for the trace it opens or for an iteration of the agent loop', () => {
    const result = deriveTopology(bundleOf(RECORDED_RUN));
    assert.deepEqual(
      result.topology.components.map((component) => `${component.kind}:${component.observedName}`),
      [
        'agent:Triage Agent',
        'evaluator:Relevance Guardrail',
        'agent:Relevance Guardrail',
        'model:openai/gpt-5.2-2025-12-11',
        'agent:Seat and Special Services Agent',
        'tool:update_seat',
      ],
    );
  });

  it('says how many spans it declined and why, rather than declining quietly', () => {
    const result = deriveTopology(bundleOf(RECORDED_RUN));
    // The trace root, the chain beneath it, the chain the guardrail opens, and the three turns.
    assert.deepEqual(result.topology.unattributed, [{ reason: 'no_name', count: 6 }]);
  });

  it('leaves what ran attached to the agent that ran it, not to the wrapper between them', () => {
    // The relation this application declares is that the seat agent calls `update_seat`, and the run
    // has three wrapper spans between the two. Anchoring on the wrapper is why none of the declared
    // relations of this application had ever been reported as exercised.
    const edges = deriveTopology(bundleOf(RECORDED_RUN)).topology.edges.map(describeEdge);
    assert.ok(
      edges.includes('calls_tool agent:Seat and Special Services Agent -> tool:update_seat'),
      edges.join('\n'),
    );
    assert.ok(
      edges.includes('validated_by agent:Triage Agent -> evaluator:Relevance Guardrail'),
      edges.join('\n'),
    );
    assert.ok(
      edges.includes('invokes_model agent:Triage Agent -> model:openai/gpt-5.2-2025-12-11'),
      edges.join('\n'),
    );
  });

  it('keeps a guardrail, whose span carries nothing but its kind and whose name is its own', () => {
    // The near miss. `Relevance Guardrail` carries exactly what `turn` carries, one attribute naming
    // its kind. It stays a component because this build reads no attribute for an evaluator's name, so
    // there is no absent name to notice, and the span name has always been the only carrier.
    const result = deriveTopology(bundleOf(RECORDED_RUN));
    assert.ok(
      result.topology.components.some(
        (component) =>
          component.kind === 'evaluator' && component.observedName === 'Relevance Guardrail',
      ),
    );
  });

  it('keeps an agent, which this instrumentor names in an attribute', () => {
    const named = deriveTopology(
      bundleOf([
        { ...TRACE_ROOT, attributes: { ...TRACE_ROOT.attributes, 'agent.name': 'Airline' } },
      ]),
    );
    assert.deepEqual(
      named.topology.components.map((component) => `${component.kind}:${component.observedName}`),
      ['agent:Airline'],
    );
    assert.deepEqual(named.topology.unattributed, []);
  });

  it('keeps a workflow that a span names, which is what tells a group from a nesting', () => {
    const named = deriveTopology(
      bundleOf([
        {
          name: TRACE_CHAIN.name,
          spanId: TRACE_CHAIN.spanId,
          start: TRACE_CHAIN.start,
          end: TRACE_CHAIN.end,
          attributes: { ...TRACE_CHAIN.attributes, 'gen_ai.workflow.name': 'airline crew' },
        },
      ]),
    );
    assert.deepEqual(
      named.topology.components.map((component) => `${component.kind}:${component.observedName}`),
      ['workflow:airline crew'],
    );
  });
});

describe('one span nested inside another', () => {
  it('calls it a handoff only between two agents', () => {
    /*
     * The guardrail is implemented by running an agent of the same name, and the run nests the two. Read
     * as a handoff it said that `evaluator:relevance-guardrail` transferred control to
     * `agent:relevance-guardrail`, which is a component handing off to itself, and a relation nothing
     * declares was reported as exercised beside the ones that do.
     */
    const edges = deriveTopology(bundleOf(RECORDED_RUN)).topology.edges.map(describeEdge);
    assert.ok(
      edges.includes('contains evaluator:Relevance Guardrail -> agent:Relevance Guardrail'),
      edges.join('\n'),
    );
    assert.ok(!edges.some((edge) => edge.startsWith('hands_off_to evaluator:')), edges.join('\n'));
  });

  it('leaves the transfer of control the run recorded alone', () => {
    // The two handoffs come from handoff spans, which name both ends. Nesting never produced them.
    const edges = deriveTopology(bundleOf(RECORDED_RUN))
      .topology.edges.map(describeEdge)
      .filter((edge) => edge.startsWith('hands_off_to'));
    assert.deepEqual(edges, [
      'hands_off_to agent:Triage Agent -> agent:Seat and Special Services Agent',
      'hands_off_to agent:Seat and Special Services Agent -> agent:Triage Agent',
    ]);
  });
});

describe('a tool call that is not a handoff', () => {
  it('stays a tool when the span names the tool it called', () => {
    // Built rather than recorded, because the run holds no tool that takes and returns an agent name.
    // A span that names the tool it called is a call to that tool whatever its arguments happen to say.
    const result = deriveTopology(
      bundleOf([
        TRIAGE_AGENT,
        TRIAGE_TURN,
        {
          ...HANDOFF_TO_SEAT,
          name: 'transfer',
          attributes: { ...HANDOFF_TO_SEAT.attributes, 'tool.name': 'transfer' },
        },
        SEAT_AGENT,
      ]),
    );
    assert.deepEqual(
      result.topology.components
        .filter((component) => component.kind === 'tool')
        .map((component) => component.observedName),
      ['transfer'],
    );
    assert.equal(result.runMetrics.handoffs, 0);
    assert.equal(result.runMetrics.toolCalls, 1);
  });

  it('stays a tool when only one of the two values names an agent the run reported', () => {
    const result = deriveTopology(
      bundleOf([
        TRIAGE_AGENT,
        TRIAGE_TURN,
        {
          ...HANDOFF_TO_SEAT,
          attributes: {
            ...HANDOFF_TO_SEAT.attributes,
            'output.value': 'a destination this run never reported',
          },
        },
      ]),
    );
    assert.deepEqual(
      result.topology.components
        .filter((component) => component.kind === 'tool')
        .map((component) => component.observedName),
      ['to Seat and Special Services Agent'],
    );
    assert.equal(result.runMetrics.handoffs, 0);
  });

  it('stays a tool when the run reported no agent at all, whatever the span is named', () => {
    // The span name still begins with `handoff to`. A name is corroboration and never the test, so with
    // nothing to join to, this build reports the tool it saw rather than inventing two agents.
    const result = deriveTopology(bundleOf([TRIAGE_TURN, HANDOFF_TO_SEAT]));
    assert.deepEqual(
      result.topology.components
        .filter((component) => component.kind === 'tool')
        .map((component) => component.observedName),
      ['to Seat and Special Services Agent'],
    );
    assert.equal(result.runMetrics.handoffs, 0);
  });
});

/**
 * The same SDK from the other instrumentor, and the same handoff written two ways.
 *
 * These five spans are the stored run of the pinned `openai-agents-js` checkout's own customer service
 * example, driven by a scripted model so the run reaches nothing and repeats exactly. Everything above was
 * argued from the Python instrumentor's output, and `@arizeai/openinference-instrumentation-openai-agents`
 * is a different program: the tree it opens is the same shape, and the one span that decides whether a
 * declared handoff can ever join is written differently in both halves that reading depends on.
 */
const JAVASCRIPT = 'openai-agents-js-exercised';

/** The trace the SDK opens, named by the application's own `withTrace` label rather than by an attribute. */
const CUSTOMER_SERVICE: SpanInput = {
  name: 'Customer service',
  spanId: 'ec8ee807c163ecbf',
  start: 0,
  end: 41,
  attributes: { 'llm.system': 'openai', 'openinference.span.kind': 'AGENT' },
};

/** An agent span. This instrumentor writes `graph.node.id` and no `agent.name`, where Python writes both. */
const JS_TRIAGE: SpanInput = {
  name: 'Triage Agent',
  spanId: '4b8e228e66866715',
  parentSpanId: CUSTOMER_SERVICE.spanId,
  start: 9,
  end: 27,
  attributes: {
    'graph.node.id': 'Triage Agent',
    'llm.system': 'openai',
    'openinference.span.kind': 'AGENT',
  },
};

/**
 * The transfer, and the whole reason this run is here. It names the tool it called and puts each agent in
 * a JSON document under a key that says which end it is, where the Python instrumentor names no tool and
 * writes the two names bare.
 */
const JS_HANDOFF: SpanInput = {
  name: 'handoff to Seat Booking Agent',
  spanId: '919ca9794598d765',
  parentSpanId: JS_TRIAGE.spanId,
  start: 20,
  end: 23,
  attributes: {
    'input.mime_type': 'application/json',
    'input.value': '{"from_agent":"Triage Agent"}',
    'llm.system': 'openai',
    'openinference.span.kind': 'TOOL',
    'output.mime_type': 'application/json',
    'output.value': '{"to_agent":"Seat Booking Agent"}',
    'tool.name': 'handoff_to_Seat Booking Agent',
  },
};

const JS_SEAT: SpanInput = {
  name: 'Seat Booking Agent',
  spanId: '223ad5ec2d6bdc95',
  parentSpanId: CUSTOMER_SERVICE.spanId,
  start: 27,
  end: 41,
  attributes: {
    'graph.node.id': 'Seat Booking Agent',
    'graph.node.parent_id': 'Triage Agent',
    'llm.system': 'openai',
    'openinference.span.kind': 'AGENT',
  },
};

const JS_UPDATE_SEAT: SpanInput = {
  name: 'update_seat',
  spanId: 'fe49afe218931597',
  parentSpanId: JS_SEAT.spanId,
  start: 33,
  end: 39,
  attributes: {
    'input.mime_type': 'application/json',
    'input.value': '{"confirmationNumber":"IR-D204","seatNumber":"14A"}',
    'llm.system': 'openai',
    'openinference.span.kind': 'TOOL',
    'output.value': 'Seat updated to 14A for confirmation IR-D204',
    'tool.name': 'update_seat',
  },
};

const RECORDED_JAVASCRIPT_RUN: readonly SpanInput[] = [
  JS_HANDOFF,
  JS_TRIAGE,
  JS_UPDATE_SEAT,
  JS_SEAT,
  CUSTOMER_SERVICE,
];

describe('the same handoff from the JavaScript instrumentor', () => {
  it('reads the documented form as a transfer of control rather than as a tool call', () => {
    // Read as the span says it, this is a call to a tool named `handoff_to_Seat Booking Agent`, which
    // nothing in the repository declares, and the declared handoff between the two agents joins nothing.
    const result = deriveTopology(bundleOf(RECORDED_JAVASCRIPT_RUN, JAVASCRIPT));
    const edges = result.topology.edges.map(describeEdge);
    assert.ok(
      edges.includes('hands_off_to agent:Triage Agent -> agent:Seat Booking Agent'),
      edges.join('\n'),
    );
    assert.deepEqual(
      result.topology.components
        .filter((component) => component.kind === 'tool')
        .map((component) => component.observedName),
      ['update_seat'],
    );
    assert.equal(result.runMetrics.handoffs, 1);
    assert.equal(result.runMetrics.toolCalls, 1);
  });

  it('reads the tool name the span carries, which the other instrumentor does not write', () => {
    // The Python reading declines any span that names a tool, because a repository may call a tool
    // whatever it likes. This one names every handoff span, so that check would decline all of them, and
    // what carries the evidence instead is the document: two keys that say which end each agent is.
    assert.equal(JS_HANDOFF.attributes['tool.name'], 'handoff_to_Seat Booking Agent');
    const result = deriveTopology(bundleOf(RECORDED_JAVASCRIPT_RUN, JAVASCRIPT));
    assert.equal(result.runMetrics.handoffs, 1);
  });

  it('still refuses a document naming an agent this run never reported', () => {
    const stranger = {
      ...JS_HANDOFF,
      attributes: {
        ...JS_HANDOFF.attributes,
        'output.value': '{"to_agent":"An Agent Nothing Ran"}',
      },
    };
    const result = deriveTopology(
      bundleOf([CUSTOMER_SERVICE, JS_TRIAGE, stranger, JS_SEAT, JS_UPDATE_SEAT], JAVASCRIPT),
    );
    assert.equal(result.runMetrics.handoffs, 0);
    assert.ok(
      result.topology.components.some(
        (component) => component.observedName === 'handoff_to_Seat Booking Agent',
      ),
      'the tool the span named is reported when the document names nothing that ran',
    );
  });

  it('keeps a named tool whose bare input and output happen to be agent names a tool call', () => {
    // The branch the documented form does not reach. A repository's own tool that takes one agent's name
    // and answers with another's is a tool call, because the span already said which tool it called and
    // nothing in the arguments says otherwise.
    const ordinary = {
      ...JS_HANDOFF,
      attributes: {
        'input.value': 'Triage Agent',
        'openinference.span.kind': 'TOOL',
        'output.value': 'Seat Booking Agent',
        'tool.name': 'pick_specialist',
      },
    };
    const result = deriveTopology(
      bundleOf([CUSTOMER_SERVICE, JS_TRIAGE, ordinary, JS_SEAT], JAVASCRIPT),
    );
    assert.equal(result.runMetrics.handoffs, 0);
    assert.deepEqual(
      result.topology.components
        .filter((component) => component.kind === 'tool')
        .map((component) => component.observedName),
      ['pick_specialist'],
    );
  });

  it('declines the trace span, which this application named itself', () => {
    // `withTrace('Customer service')` puts the application's own label on the span the SDK opens around a
    // run. It carries an OpenInference kind and no naming attribute, so it names nothing this build can
    // report, and reading the span name would mint an agent the repository declares nowhere.
    const result = deriveTopology(bundleOf(RECORDED_JAVASCRIPT_RUN, JAVASCRIPT));
    assert.deepEqual(
      result.topology.components.map((component) => `${component.kind}:${component.observedName}`),
      ['agent:Triage Agent', 'agent:Seat Booking Agent', 'tool:update_seat'],
    );
  });
});
