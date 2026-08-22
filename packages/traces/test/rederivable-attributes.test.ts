import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CODE } from '../src/attributes.ts';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson } from '../src/otlp.ts';
import { deriveTopology } from '../src/topology.ts';

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

const topologyOf = (spans: readonly SpanInput[]) => {
  const decoded = decodeTraceJson({
    resourceSpans: [
      {
        resource: { attributes: attributeList({ 'service.name': 'provenance-fixture' }) },
        scopeSpans: [
          {
            scope: { name: 'openinference.instrumentation.crewai' },
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
  return deriveTopology(
    normalizeTraces(decoded, {
      runId: `run_${'0'.repeat(16)}`,
      capturedAt: '2026-08-19T00:00:00.000Z',
      source: 'otlp_http_json',
      maxSpans: 100,
      maxAttributeBytes: 4096,
    }).bundle,
  ).topology;
};

const agent = (
  name: string,
  spanId: string,
  start: number,
  attributes: Readonly<Record<string, string>> = {},
  parentSpanId?: string,
): SpanInput => ({
  name,
  spanId,
  ...(parentSpanId === undefined ? {} : { parentSpanId }),
  start,
  end: start + 1000,
  attributes: {
    'openinference.span.kind': 'AGENT',
    'agent.name': name,
    ...attributes,
  },
});

describe('attribute provenance on observed topology', () => {
  it('records the exact attributes that produced a component identity', () => {
    const topology = topologyOf([
      agent('Lead Market Analyst', '1111111111111111', 0, {
        [CODE.filePath]: 'src/crew.py',
        [CODE.lineNumber]: '12',
      }),
    ]);
    assert.deepEqual(topology.components[0]?.provenance, {
      kind: { attributes: ['openinference.span.kind'], spanFields: [] },
      name: { attributes: ['agent.name'], spanFields: [] },
      codeLocation: {
        attributes: ['code.file.path', 'code.line.number'],
        spanFields: [],
      },
    });
  });

  it('records span nesting separately from the attributes naming both endpoints', () => {
    const topology = topologyOf([
      agent('Lead Market Analyst', '1111111111111111', 0),
      agent('Chief Marketing Strategist', '2222222222222222', 1000, {}, '1111111111111111'),
    ]);
    assert.deepEqual(topology.edges[0]?.provenance, {
      relation: { attributes: [], spanFields: ['parentSpanId'] },
      from: { attributes: ['agent.name'], spanFields: [] },
      to: { attributes: ['agent.name'], spanFields: [] },
    });
  });

  it('does not turn a declared-list endpoint into a relation', () => {
    const topology = topologyOf([
      agent('Lead Market Analyst', '1111111111111111', 0),
      agent('Chief Marketing Strategist', '2222222222222222', 1000, {
        'graph.node.parent_id': 'Lead Market Analyst',
      }),
    ]);
    assert.deepEqual(topology.edges, []);
  });

  it('names code.file.path and the observed population missing it', () => {
    const topology = topologyOf([
      agent('Lead Market Analyst', '1111111111111111', 0),
      agent('Chief Marketing Strategist', '2222222222222222', 1000),
    ]);
    assert.deepEqual(topology.coverage.missingSpanAttributes, [
      {
        attribute: 'code.file.path',
        purpose: 'code_location',
        reason: 'missing',
        observedComponents: 2,
      },
      {
        attribute: 'orchescope.code.repository.path',
        purpose: 'source_identity',
        reason: 'missing',
        observedComponents: 2,
      },
      {
        attribute: 'vcs.ref.head.revision',
        purpose: 'source_identity',
        reason: 'missing',
        observedComponents: 2,
      },
      {
        attribute: 'vcs.repository.url.full',
        purpose: 'source_identity',
        reason: 'missing',
        observedComponents: 2,
      },
    ]);
  });
});
