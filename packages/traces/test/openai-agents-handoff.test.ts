import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NormalizedSpan, ObservedEdge } from '@orchescope/schema';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson } from '../src/otlp.ts';
import { deriveTopology } from '../src/topology.ts';

/**
 * The handoff the OpenAI Agents SDK records as a tool call.
 *
 * The spans below are copied from the stored run of the pinned `openai-cs-agents-demo` checkout, which
 * is the first traced run of a third party application this build measured. Identifiers, names,
 * attributes and nesting are the instrumentor's own; only the timestamps are rounded, because nothing
 * asserted here depends on a sub millisecond duration.
 *
 * They are held verbatim so that a rename in `openinference-instrumentation-openai-agents` fails here
 * rather than going quiet. The quiet failure is the one this build keeps hitting: an attribute moves,
 * the handoff stops joining, and every report afterwards says a tool nothing declared ran instead of
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

const bundleOf = (spans: readonly SpanInput[]) => {
  const decoded = decodeTraceJson({
    resourceSpans: [
      {
        resource: {
          attributes: attributeList({ 'service.name': 'openai-cs-agents-demo-exercised' }),
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

const RECORDED_RUN: readonly SpanInput[] = [
  TRIAGE_AGENT,
  TRIAGE_TURN,
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
