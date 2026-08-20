import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson } from '../src/otlp.ts';
import { deriveTopology } from '../src/topology.ts';

/**
 * One call, watched by two instrumentations.
 *
 * `orchescope trace` patches `fetch` in the target so a run of a system with no instrumentation of its own
 * still says something. A system worth auditing usually has its own, and then both watch the same request.
 *
 * The spans below are the stored run of the pinned `openai-agents-js` checkout driven against a real
 * provider, which is the first run this build has measured with two producers in it. Identifiers, scope
 * names, attributes and nesting are each producer's own; the timestamps are rounded to the millisecond.
 * Read as two calls, this run of two model calls reported four, and because the two producers name a model
 * differently it reported two models: `gen_ai.request.model` is what was sent and `llm.model_name` is what
 * came back.
 *
 * The two are told apart by the scope that exported them. Nothing but this build exports under
 * `orchescope`, and each of its spans is its own trace, because an instrumentation that bridges its SDK's
 * events after the fact opens no context a patched `fetch` runs inside.
 */

const AGENTS_SCOPE = '@arizeai/openinference-instrumentation-openai-agents';
const OWN_SCOPE = 'orchescope';

const AGENTS_TRACE = '434a185229953fe2a0b1c2d3e4f50617';

type SpanInput = {
  readonly name: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceId: string;
  readonly scope: string;
  readonly start: number;
  readonly end: number;
  readonly attributes: Readonly<Record<string, string>>;
};

const attributeList = (attributes: Readonly<Record<string, string>>) =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: value } }));

const nanos = (ms: number): string => String(BigInt(ms) * 1_000_000n);

/** One scope group per producer, which is how a run with two instrumentations arrives over the wire. */
const bundleOf = (spans: readonly SpanInput[]) => {
  const scopes = [...new Set(spans.map((span) => span.scope))];
  const decoded = decodeTraceJson({
    resourceSpans: [
      {
        resource: {
          attributes: attributeList({ 'service.name': 'openai-agents-js-exercised' }),
        },
        scopeSpans: scopes.map((scope) => ({
          scope: { name: scope },
          spans: spans
            .filter((span) => span.scope === scope)
            .map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
              name: span.name,
              kind: 1,
              startTimeUnixNano: nanos(span.start),
              endTimeUnixNano: nanos(span.end),
              attributes: attributeList(span.attributes),
              status: { code: 1 },
            })),
        })),
      },
    ],
  });
  return normalizeTraces(decoded, {
    runId: `run_${'0'.repeat(16)}`,
    capturedAt: '2026-08-20T00:00:00.000Z',
    source: 'otlp_http_json',
    maxSpans: 100,
    maxAttributeBytes: 4096,
  }).bundle;
};

const agentSpan = (
  name: string,
  spanId: string,
  parentSpanId: string | undefined,
  start: number,
  end: number,
  attributes: Readonly<Record<string, string>>,
): SpanInput => ({
  name,
  spanId,
  ...(parentSpanId === undefined ? {} : { parentSpanId }),
  traceId: AGENTS_TRACE,
  scope: AGENTS_SCOPE,
  start,
  end,
  attributes,
});

const WORKFLOW = agentSpan('Customer service', 'e57d33568f5e8f3c', undefined, 0, 2683, {
  'openinference.span.kind': 'AGENT',
});
const TRIAGE = agentSpan('Triage Agent', 'd34770c29a185044', WORKFLOW.spanId, 4, 1655, {
  'graph.node.id': 'Triage Agent',
  'openinference.span.kind': 'AGENT',
});
const TRIAGE_RESPONSE = agentSpan('response', 'bb07d5e4f9a4c9b1', TRIAGE.spanId, 11, 1649, {
  'llm.model_name': 'gpt-5.4-mini-2026-03-17',
  'llm.provider': 'openai',
  'openinference.span.kind': 'LLM',
});
const SEAT = agentSpan('Seat Booking Agent', '9f9c87eedc295387', WORKFLOW.spanId, 1655, 2682, {
  'graph.node.id': 'Seat Booking Agent',
  'openinference.span.kind': 'AGENT',
});
const SEAT_RESPONSE = agentSpan('response', '94adf7aec18aef12', SEAT.spanId, 1656, 2678, {
  'llm.model_name': 'gpt-5.4-mini-2026-03-17',
  'llm.provider': 'openai',
  'openinference.span.kind': 'LLM',
});

/** This build's own view of the same two requests, each its own trace and each inside one of the two above. */
const ownSpan = (spanId: string, traceId: string, start: number, end: number): SpanInput => ({
  name: 'chat gpt-5.4-mini',
  spanId,
  traceId,
  scope: OWN_SCOPE,
  start,
  end,
  attributes: {
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': 'openai',
    'gen_ai.request.model': 'gpt-5.4-mini',
    'http.request.method': 'POST',
    'http.response.status_code': '200',
    'server.address': 'api.openai.com',
    'url.path': '/v1/responses',
  },
});

const OWN_FIRST = ownSpan('960f3987594e8a6d', 'bd8b8e836559a1b2c3d4e5f607182930', 143, 1638);
const OWN_SECOND = ownSpan('722e55b983d41e03', 'c938827056b6d1e2f3a4b5c607182930', 1658, 2569);

const RECORDED_RUN: readonly SpanInput[] = [
  WORKFLOW,
  TRIAGE,
  TRIAGE_RESPONSE,
  OWN_FIRST,
  SEAT,
  SEAT_RESPONSE,
  OWN_SECOND,
];

const componentsOf = (spans: readonly SpanInput[]): readonly string[] =>
  deriveTopology(bundleOf(spans)).topology.components.map(
    (component) => `${component.kind}:${component.observedName}`,
  );

describe('a model call two instrumentations watched', () => {
  it('reports the call once, and the model once', () => {
    // Read as two, this run of two model calls reported four, under two model names.
    const result = deriveTopology(bundleOf(RECORDED_RUN));
    assert.equal(result.runMetrics.modelCalls, 2);
    assert.deepEqual(
      result.topology.components
        .filter((component) => component.kind === 'model')
        .map((component) => component.observedName),
      ['openai/gpt-5.4-mini-2026-03-17'],
    );
  });

  it('keeps the account of the instrumentation that watched from inside the SDK', () => {
    // The one kept is the one attached to the agent that made the call. This build's own span is a root of
    // its own trace, so keeping it instead would report a model no agent invoked.
    const edges = deriveTopology(bundleOf(RECORDED_RUN)).topology.edges.map(
      (edge) => `${edge.kind} ${edge.fromObservedName} -> ${edge.toObservedName}`,
    );
    assert.ok(
      edges.includes('invokes_model Triage Agent -> openai/gpt-5.4-mini-2026-03-17'),
      edges.join('\n'),
    );
  });

  it('does not count the superseded span as one it could not read', () => {
    // `unattributed` says what this build could not see. Everything a superseded span said is reported, by
    // a witness that said more, so there is no gap to state and suppressing two adds nothing here. The one
    // that is counted is the workflow span, which carries a kind and no name and declines on its own.
    assert.deepEqual(deriveTopology(bundleOf(RECORDED_RUN)).topology.unattributed, [
      { reason: 'no_name', count: 1 },
    ]);
  });

  it('stands alone when nothing else in the run watched the call', () => {
    // The fallback this shim exists to be. Without it a run of an uninstrumented system says nothing at
    // all, so a rule that dropped our span whenever any other producer was present would be wrong.
    assert.deepEqual(componentsOf([OWN_FIRST, OWN_SECOND]), ['model:openai/gpt-5.4-mini']);
    assert.equal(deriveTopology(bundleOf([OWN_FIRST])).runMetrics.modelCalls, 1);
  });

  it('stands when no other model call was in flight for the whole of it', () => {
    // A request this build watched that ran outside every model call anybody else reported is a call
    // nobody else reported. Overlapping is not containing.
    const afterwards = { ...OWN_FIRST, start: 2000, end: 3000 };
    const result = deriveTopology(bundleOf([WORKFLOW, TRIAGE, TRIAGE_RESPONSE, afterwards]));
    assert.equal(result.runMetrics.modelCalls, 2);
    assert.deepEqual(
      result.topology.components
        .filter((component) => component.kind === 'model')
        .map((component) => component.observedName)
        .sort(),
      ['openai/gpt-5.4-mini', 'openai/gpt-5.4-mini-2026-03-17'],
    );
  });

  it('asks the question only of a model call, and only of one this build produced', () => {
    // A tool call, an agent step or a protocol call from this shim is the only account of it anywhere,
    // and another producer's model call is never dropped for being inside one of ours.
    const ourTool = {
      ...OWN_FIRST,
      name: 'execute_tool issue_refund',
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'mcp.tool.name': 'issue_refund',
        'server.address': 'api.example.com',
      },
    };
    assert.ok(
      componentsOf([WORKFLOW, TRIAGE, TRIAGE_RESPONSE, ourTool]).includes('tool:issue_refund'),
    );

    const { parentSpanId: _enclosing, ...unparented } = TRIAGE_RESPONSE;
    const theirsInsideOurs = {
      ...unparented,
      start: OWN_FIRST.start + 1,
      end: OWN_FIRST.end - 1,
    };
    const result = deriveTopology(bundleOf([OWN_FIRST, theirsInsideOurs]));
    assert.equal(result.runMetrics.modelCalls, 2);
  });
});
