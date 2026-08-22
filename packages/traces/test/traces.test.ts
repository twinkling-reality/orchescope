import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyOperation, componentKindFor, GEN_AI, ORCHESCOPE } from '../src/attributes.ts';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson } from '../src/otlp.ts';
import { deriveTopology } from '../src/topology.ts';

/**
 * Trace ingestion tests.
 *
 * Everything observed about a running system arrives through this path, so the cases here are about not inventing and
 * not losing: OTLP variants that senders actually emit are accepted, a span that cannot be understood is counted rather
 * than dropped silently, limits are enforced, and the derived topology counts a retry as one operation attempted twice
 * rather than as two operations.
 */

const TRACE = 'a'.repeat(32);

type SpanInput = {
  readonly name: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly start: number;
  readonly end: number;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
  readonly events?: readonly {
    name: string;
    attributes?: Readonly<Record<string, string | number | boolean>>;
  }[];
  readonly status?: 'unset' | 'ok' | 'error';
};

const attributeValue = (value: string | number | boolean): Record<string, unknown> => {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
};

const attributeList = (attributes: Readonly<Record<string, string | number | boolean>>) =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: attributeValue(value) }));

const nanos = (ms: number): string => String(BigInt(ms) * 1_000_000n);

const payload = (spans: readonly SpanInput[], serviceName = 'demo') => ({
  resourceSpans: [
    {
      resource: { attributes: attributeList({ 'service.name': serviceName }) },
      scopeSpans: [
        {
          scope: { name: 'orchescope-demo' },
          spans: spans.map((span) => ({
            traceId: TRACE,
            spanId: span.spanId,
            ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
            name: span.name,
            kind: 1,
            startTimeUnixNano: nanos(span.start),
            endTimeUnixNano: nanos(span.end),
            attributes: attributeList(span.attributes ?? {}),
            events: (span.events ?? []).map((event) => ({
              name: event.name,
              timeUnixNano: nanos(span.start),
              attributes: attributeList(event.attributes ?? {}),
            })),
            ...(span.status === undefined
              ? {}
              : { status: { code: span.status === 'error' ? 2 : 1 } }),
          })),
        },
      ],
    },
  ],
});

const options = {
  runId: `run_${'0'.repeat(16)}`,
  capturedAt: '2026-07-24T00:00:00.000Z',
  source: 'otlp_http_json' as const,
  maxSpans: 100,
  maxAttributeBytes: 256,
};

const normalize = (spans: readonly SpanInput[]) =>
  normalizeTraces(decodeTraceJson(payload(spans)), options);

describe('decodeTraceJson', () => {
  it('reads a well formed request', () => {
    const decoded = decodeTraceJson(
      payload([{ name: 'chat', spanId: '1'.repeat(16), start: 0, end: 5 }]),
    );
    assert.equal(decoded.resourceSpans.length, 1);
    assert.deepEqual(decoded.rejected, []);
  });

  it('reports a body that is not a trace request rather than accepting an empty one', () => {
    const decoded = decodeTraceJson({ nothing: true });
    assert.equal(decoded.resourceSpans.length, 0);
    assert.equal(decoded.rejected.length, 1);
    assert.match(decoded.rejected[0]?.reason ?? '', /resourceSpans/);
  });

  it('accepts a trace identifier in either of the two encodings senders use', () => {
    const hex = decodeTraceJson(
      payload([{ name: 'chat', spanId: '1'.repeat(16), start: 0, end: 1 }]),
    );
    const base64 = decodeTraceJson({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: Buffer.from(TRACE, 'hex').toString('base64'),
                  spanId: Buffer.from('1'.repeat(16), 'hex').toString('base64'),
                  name: 'chat',
                  startTimeUnixNano: '0',
                  endTimeUnixNano: '1000000',
                },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(
      base64.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.traceId,
      hex.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.traceId,
    );
  });

  it('counts a malformed entry instead of failing the whole request', () => {
    const decoded = decodeTraceJson({ resourceSpans: [null, 'text', { scopeSpans: [] }] });
    assert.ok(decoded.rejected.some((entry) => entry.count >= 2));
  });
});

describe('normalizeTraces', () => {
  it('keeps the service name and the source of the spans', () => {
    const result = normalize([{ name: 'chat', spanId: '1'.repeat(16), start: 0, end: 10 }]);
    assert.deepEqual(result.bundle.services, ['demo']);
    assert.equal(result.bundle.source, 'otlp_http_json');
    assert.equal(result.bundle.spans.length, 1);
    assert.equal(result.serviceBySpanId.get('1'.repeat(16)), 'demo');
    assert.deepEqual(result.bundle.spans[0]?.resourceAttributes, { 'service.name': 'demo' });
  });

  it('retains VCS resource identity on the span that resource emitted', () => {
    const document = payload([{ name: 'chat', spanId: '1'.repeat(16), start: 0, end: 10 }]);
    const resource = document.resourceSpans[0]?.resource;
    assert.ok(resource !== undefined);
    resource.attributes = attributeList({
      'service.name': 'demo',
      'vcs.repository.url.full': 'https://github.com/example/demo',
      'vcs.ref.head.revision': 'a'.repeat(40),
    });
    const result = normalizeTraces(decodeTraceJson(document), options);
    assert.equal(
      result.bundle.spans[0]?.resourceAttributes?.['vcs.repository.url.full'],
      'https://github.com/example/demo',
    );
  });

  it('computes a duration in milliseconds from nanosecond timestamps', () => {
    const result = normalize([{ name: 'chat', spanId: '1'.repeat(16), start: 100, end: 250 }]);
    assert.equal(result.bundle.spans[0]?.durationMs, 150);
  });

  it('never reports a negative duration when a clock went backwards', () => {
    const result = normalize([{ name: 'chat', spanId: '1'.repeat(16), start: 250, end: 100 }]);
    assert.equal(result.bundle.spans[0]?.durationMs, 0);
  });

  it('stops at the span ceiling and says how many it dropped', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      name: `span-${index}`,
      spanId: index.toString(16).padStart(16, '0'),
      start: 0,
      end: 1,
    }));
    const result = normalizeTraces(decodeTraceJson(payload(many)), { ...options, maxSpans: 4 });
    assert.equal(result.bundle.spans.length, 4);
    assert.equal(result.bundle.droppedSpanCount, 6);
  });

  it('truncates an attribute that is too long rather than storing it whole', () => {
    const result = normalizeTraces(
      decodeTraceJson(
        payload([
          {
            name: 'chat',
            spanId: '1'.repeat(16),
            start: 0,
            end: 1,
            attributes: { note: 'x'.repeat(1000) },
          },
        ]),
      ),
      { ...options, maxAttributeBytes: 32 },
    );
    const value = result.bundle.spans[0]?.attributes['note'];
    assert.equal(typeof value, 'string');
    assert.ok(String(value).length <= 64, 'the attribute was not truncated');
  });

  it('collects a side effect recorded as a span event', () => {
    const result = normalize([
      {
        name: 'execute_tool issue_refund',
        spanId: '1'.repeat(16),
        start: 0,
        end: 5,
        events: [
          {
            name: ORCHESCOPE.sideEffectEvent,
            attributes: {
              [ORCHESCOPE.sideEffectKind]: 'refund',
              [ORCHESCOPE.sideEffectTarget]: 'payments/order-1',
            },
          },
        ],
      },
    ]);
    assert.equal(result.bundle.sideEffects.length, 1);
    assert.equal(result.bundle.sideEffects[0]?.kind, 'refund');
    assert.equal(result.bundle.sideEffects[0]?.target, 'payments/order-1');
  });
});

describe('attributes', () => {
  it('classifies an operation from the attribute the convention defines for it', () => {
    assert.equal(classifyOperation('anything', { [GEN_AI.operationName]: 'chat' }), 'chat');
    assert.equal(
      classifyOperation('anything', { [GEN_AI.operationName]: 'execute_tool' }),
      'execute_tool',
    );
  });

  it('falls back to the span name when no attribute says what happened', () => {
    assert.equal(classifyOperation('execute_tool issue_refund', {}), 'execute_tool');
    assert.equal(classifyOperation('something unfamiliar', {}), 'unclassified');
  });

  it('maps an operation to the kind of component that performs it', () => {
    assert.equal(componentKindFor('chat'), 'model');
    assert.equal(componentKindFor('execute_tool'), 'tool');
    assert.equal(componentKindFor('invoke_agent'), 'agent');
    assert.equal(componentKindFor('unclassified'), undefined);
  });
});

describe('deriveTopology', () => {
  const topologyOf = (spans: readonly SpanInput[]) => deriveTopology(normalize(spans).bundle);

  it('counts a model call and a tool call separately', () => {
    const result = topologyOf([
      {
        name: 'invoke_agent orchestrator',
        spanId: '1'.repeat(16),
        start: 0,
        end: 100,
        attributes: { [GEN_AI.operationName]: 'invoke_agent', [GEN_AI.agentName]: 'orchestrator' },
      },
      {
        name: 'chat demo-small',
        spanId: '2'.repeat(16),
        parentSpanId: '1'.repeat(16),
        start: 10,
        end: 40,
        attributes: { [GEN_AI.operationName]: 'chat', [GEN_AI.requestModel]: 'demo-small' },
      },
      {
        name: 'execute_tool issue_refund',
        spanId: '3'.repeat(16),
        parentSpanId: '1'.repeat(16),
        start: 50,
        end: 90,
        attributes: { [GEN_AI.operationName]: 'execute_tool', [GEN_AI.toolName]: 'issue_refund' },
      },
    ]);
    assert.equal(result.runMetrics.modelCalls, 1);
    assert.equal(result.runMetrics.toolCalls, 1);
    assert.equal(result.runMetrics.agentSteps, 1);
    assert.equal(result.topology.components.length, 3);
  });

  /**
   * A workflow a run names is the one target kind in `EDGE_KIND_BY_TARGET` that no corpus run reaches, so
   * nothing outside this test says what a nesting into one means. It is containment for the same reason a
   * nesting into an agent from anything other than an agent is: what was observed is that the work
   * happened inside, and calling it a transfer of control would report one that never happened.
   */
  it('calls a nesting into a workflow containment, whatever opened it', () => {
    const result = topologyOf([
      {
        name: 'invoke_agent orchestrator',
        spanId: '1'.repeat(16),
        start: 0,
        end: 100,
        attributes: { [GEN_AI.operationName]: 'invoke_agent', [GEN_AI.agentName]: 'orchestrator' },
      },
      {
        name: 'invoke_workflow nightly-report',
        spanId: '2'.repeat(16),
        parentSpanId: '1'.repeat(16),
        start: 10,
        end: 90,
        attributes: {
          [GEN_AI.operationName]: 'invoke_workflow',
          [GEN_AI.workflowName]: 'nightly-report',
        },
      },
    ]);
    assert.deepEqual(
      result.topology.edges.map((edge) => `${edge.kind} ${edge.fromKind} -> ${edge.toKind}`),
      ['contains agent -> agent_group'],
    );
  });

  it('reports the time a component spent on its own work, not the time its children took', () => {
    const result = topologyOf([
      {
        name: 'invoke_agent orchestrator',
        spanId: '1'.repeat(16),
        start: 0,
        end: 100,
        attributes: { [GEN_AI.operationName]: 'invoke_agent', [GEN_AI.agentName]: 'orchestrator' },
      },
      {
        name: 'chat demo-small',
        spanId: '2'.repeat(16),
        parentSpanId: '1'.repeat(16),
        start: 10,
        end: 90,
        attributes: { [GEN_AI.operationName]: 'chat', [GEN_AI.requestModel]: 'demo-small' },
      },
    ]);
    const agent = result.topology.components.find(
      (component) => component.observedName === 'orchestrator',
    );
    assert.equal(agent?.totalDurationMs, 100);
    assert.equal(agent?.selfDurationMs, 20);
  });

  it('counts a retried tool as one component attempted twice', () => {
    const result = topologyOf([
      {
        name: 'execute_tool issue_refund',
        spanId: '1'.repeat(16),
        start: 0,
        end: 10,
        status: 'error',
        attributes: {
          [GEN_AI.operationName]: 'execute_tool',
          [GEN_AI.toolName]: 'issue_refund',
          [ORCHESCOPE.retryAttempt]: 1,
        },
      },
      {
        name: 'execute_tool issue_refund',
        spanId: '2'.repeat(16),
        start: 20,
        end: 30,
        attributes: {
          [GEN_AI.operationName]: 'execute_tool',
          [GEN_AI.toolName]: 'issue_refund',
          [ORCHESCOPE.retryAttempt]: 2,
        },
      },
    ]);
    const tool = result.topology.components.find(
      (component) => component.observedName === 'issue_refund',
    );
    assert.equal(result.topology.components.length, 1);
    assert.equal(tool?.spanCount, 2);
    assert.equal(tool?.retryCount, 1);
    assert.equal(result.runMetrics.retries, 1);
    assert.equal(result.runMetrics.errors, 1);
  });

  it('adds up the tokens a run reported', () => {
    const result = topologyOf([
      {
        name: 'chat demo-small',
        spanId: '1'.repeat(16),
        start: 0,
        end: 10,
        attributes: {
          [GEN_AI.operationName]: 'chat',
          [GEN_AI.requestModel]: 'demo-small',
          [GEN_AI.inputTokens]: 120,
          [GEN_AI.outputTokens]: 34,
        },
      },
    ]);
    assert.equal(result.runMetrics.inputTokens, 120);
    assert.equal(result.runMetrics.outputTokens, 34);
  });

  it('does not count a failed attempt as a side effect that happened', () => {
    const result = topologyOf([
      {
        name: 'execute_tool issue_refund',
        spanId: '1'.repeat(16),
        start: 0,
        end: 10,
        attributes: { [GEN_AI.operationName]: 'execute_tool', [GEN_AI.toolName]: 'issue_refund' },
        events: [
          {
            name: ORCHESCOPE.sideEffectEvent,
            attributes: {
              [ORCHESCOPE.sideEffectKind]: 'refund',
              [ORCHESCOPE.sideEffectTarget]: 'payments/order-1',
              [ORCHESCOPE.sideEffectOutcome]: 'failed',
            },
          },
          {
            name: ORCHESCOPE.sideEffectEvent,
            attributes: {
              [ORCHESCOPE.sideEffectKind]: 'refund',
              [ORCHESCOPE.sideEffectTarget]: 'payments/order-1',
              [ORCHESCOPE.sideEffectOutcome]: 'succeeded',
            },
          },
        ],
      },
    ]);
    assert.equal(result.runMetrics.duplicateSideEffects, 0);
    assert.equal(result.runMetrics.sideEffects, 1);
  });

  it('counts a repeated effect with no key as a duplicate', () => {
    const effect = (outcome: string) => ({
      name: ORCHESCOPE.sideEffectEvent,
      attributes: {
        [ORCHESCOPE.sideEffectKind]: 'refund',
        [ORCHESCOPE.sideEffectTarget]: 'payments/order-1',
        [ORCHESCOPE.sideEffectOutcome]: outcome,
      },
    });
    const result = topologyOf([
      {
        name: 'execute_tool issue_refund',
        spanId: '1'.repeat(16),
        start: 0,
        end: 10,
        attributes: { [GEN_AI.operationName]: 'execute_tool', [GEN_AI.toolName]: 'issue_refund' },
        events: [effect('unknown'), effect('succeeded')],
      },
    ]);
    assert.equal(result.runMetrics.duplicateSideEffects, 1);
  });

  it('links every span it understood to a component, and counts the ones it did not', () => {
    const result = topologyOf([
      {
        name: 'execute_tool issue_refund',
        spanId: '1'.repeat(16),
        start: 0,
        end: 10,
        attributes: { [GEN_AI.operationName]: 'execute_tool', [GEN_AI.toolName]: 'issue_refund' },
      },
      { name: 'a span with no convention attributes', spanId: '2'.repeat(16), start: 0, end: 1 },
    ]);
    assert.equal(result.spanToComponentKey.size, 1);
    assert.ok(result.topology.unattributed.length >= 1);
  });

  it('leaves a span it could not read out of the chain rather than breaking it', () => {
    /*
     * The AI SDK opens a `step` span around every model call and tool call an agent makes, and labels
     * it `gen_ai.operation.name: agent_step`, which this build does not read. Severing the chain there
     * left a recorded run of six spans that reached a model and a tool reporting no observed relation
     * at all, so the one thing it proved about the system was thrown away.
     */
    const result = topologyOf([
      {
        name: 'invoke_agent planner',
        spanId: '1'.repeat(16),
        start: 0,
        end: 100,
        attributes: { [GEN_AI.operationName]: 'invoke_agent', [GEN_AI.agentName]: 'planner' },
      },
      {
        name: 'step 1',
        spanId: '2'.repeat(16),
        parentSpanId: '1'.repeat(16),
        start: 1,
        end: 90,
        attributes: { [GEN_AI.operationName]: 'agent_step' },
      },
      {
        name: 'execute_tool issue_refund',
        spanId: '3'.repeat(16),
        parentSpanId: '2'.repeat(16),
        start: 2,
        end: 40,
        attributes: { [GEN_AI.operationName]: 'execute_tool', [GEN_AI.toolName]: 'issue_refund' },
      },
    ]);
    assert.deepEqual(
      result.topology.edges.map(
        (edge) => `${edge.kind} ${edge.fromObservedName} -> ${edge.toObservedName}`,
      ),
      ['calls_tool planner -> issue_refund'],
    );
    // The span is still reported as one this build could not attribute to a component.
    assert.deepEqual(result.topology.unattributed, [{ reason: 'no_operation', count: 1 }]);
  });

  it('reads one agent running another as a handoff, which is the relation a manifest declares', () => {
    // The demonstration system declares `hands_off_to` from its orchestrator to each worker and its run
    // nests the worker's span inside the orchestrator's, so this branch is what joins the two. It is the
    // only nesting that is read as a transfer of control: for both ends to be agents is the whole test.
    const result = topologyOf([
      {
        name: 'invoke_agent orchestrator',
        spanId: '1'.repeat(16),
        start: 0,
        end: 100,
        attributes: { [GEN_AI.operationName]: 'invoke_agent', [GEN_AI.agentName]: 'orchestrator' },
      },
      {
        name: 'invoke_agent account-worker',
        spanId: '2'.repeat(16),
        parentSpanId: '1'.repeat(16),
        start: 1,
        end: 50,
        attributes: {
          [GEN_AI.operationName]: 'invoke_agent',
          [GEN_AI.agentName]: 'account-worker',
        },
      },
    ]);
    assert.deepEqual(
      result.topology.edges.map(
        (edge) => `${edge.kind} ${edge.fromObservedName} -> ${edge.toObservedName}`,
      ),
      ['hands_off_to orchestrator -> account-worker'],
    );
  });

  it('reads anything else running an agent as containment rather than as a transfer', () => {
    const result = topologyOf([
      {
        name: 'execute_tool ask_the_researcher',
        spanId: '1'.repeat(16),
        start: 0,
        end: 100,
        attributes: {
          [GEN_AI.operationName]: 'execute_tool',
          [GEN_AI.toolName]: 'ask_the_researcher',
        },
      },
      {
        name: 'invoke_agent researcher',
        spanId: '2'.repeat(16),
        parentSpanId: '1'.repeat(16),
        start: 1,
        end: 50,
        attributes: { [GEN_AI.operationName]: 'invoke_agent', [GEN_AI.agentName]: 'researcher' },
      },
    ]);
    assert.deepEqual(
      result.topology.edges.map(
        (edge) => `${edge.kind} ${edge.fromObservedName} -> ${edge.toObservedName}`,
      ),
      ['contains ask_the_researcher -> researcher'],
    );
  });

  it('reads a span name as a name where the conventions say it is one', () => {
    // The generative AI conventions specify a span name of `{operation} {name}`, so an agent that names
    // itself only there is named. The rule that declines an unnamed span is for the other dialect,
    // where a span name is a label the instrumentation chose.
    const result = topologyOf([
      {
        name: 'invoke_agent planner',
        spanId: '1'.repeat(16),
        start: 0,
        end: 10,
        attributes: { [GEN_AI.operationName]: 'invoke_agent' },
      },
    ]);
    assert.deepEqual(
      result.topology.components.map((component) => component.observedName),
      ['planner'],
    );
    assert.deepEqual(result.topology.unattributed, []);
  });

  it('produces the same topology for the same spans in a different arrival order', () => {
    const spans: SpanInput[] = [
      {
        name: 'invoke_agent orchestrator',
        spanId: '1'.repeat(16),
        start: 0,
        end: 100,
        attributes: { [GEN_AI.operationName]: 'invoke_agent', [GEN_AI.agentName]: 'orchestrator' },
      },
      {
        name: 'execute_tool issue_refund',
        spanId: '2'.repeat(16),
        parentSpanId: '1'.repeat(16),
        start: 10,
        end: 40,
        attributes: { [GEN_AI.operationName]: 'execute_tool', [GEN_AI.toolName]: 'issue_refund' },
      },
    ];
    const forward = topologyOf(spans);
    const backward = topologyOf([...spans].reverse());
    assert.deepEqual(
      forward.topology.components.map((component) => component.observedName),
      backward.topology.components.map((component) => component.observedName),
    );
    assert.deepEqual(forward.runMetrics, backward.runMetrics);
  });
});
