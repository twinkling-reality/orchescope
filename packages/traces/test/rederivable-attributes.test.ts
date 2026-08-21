import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CODE,
  GEN_AI,
  MCP,
  OPEN_INFERENCE,
  ORCHESCOPE,
  REDERIVABLE_ATTRIBUTES,
  VCS,
} from '../src/attributes.ts';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson } from '../src/otlp.ts';
import { deriveTopology } from '../src/topology.ts';

/**
 * A declaration sent out through the process being audited and reported back is not an observation.
 *
 * `graph.node.parent_id` is the recorded case. Every CrewAI agent span after the first carries it, and on
 * the pinned marketing crew the values draw exactly the sequence the crew declares, because the
 * instrumentor finds the agent whose task is running in `crew.agents` and returns the role of the entry
 * before it. Reading it would have moved `exercisedEdges` off zero and filled `runtime.joined`, which is
 * the shape of a fix, and every one of those edges would have been a declaration this build already reads
 * from source. What caught it was a person reading the instrumentor. What holds it now is this file.
 *
 * Two assertions, because there are two ways back in. An attribute added to a vocabulary is read by
 * whatever consults that vocabulary, and an attribute read directly produces a relation. The second is the
 * one that matters and the first is the one that is easy to do by accident.
 *
 * A companion asserts that a relation forms at all from the same fixture, because a refusal and a reader
 * that produces no relations under any circumstances are the same result read from outside.
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

const topologyOf = (spans: readonly SpanInput[]) => {
  const decoded = decodeTraceJson({
    resourceSpans: [
      {
        resource: { attributes: attributeList({ 'service.name': 'crewai-examples-exercised' }) },
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
  );
};

const analyst = (attributes: Readonly<Record<string, string>>): SpanInput => ({
  name: 'Lead Market Analyst',
  spanId: '1111111111111111',
  start: 0,
  end: 1000,
  attributes: {
    'openinference.span.kind': 'AGENT',
    'agent.name': 'Lead Market Analyst',
    ...attributes,
  },
});

const strategist = (
  attributes: Readonly<Record<string, string>>,
  parentSpanId?: string,
): SpanInput => ({
  name: 'Chief Marketing Strategist',
  spanId: '2222222222222222',
  ...(parentSpanId === undefined ? {} : { parentSpanId }),
  start: 1000,
  end: 2000,
  attributes: {
    'openinference.span.kind': 'AGENT',
    'agent.name': 'Chief Marketing Strategist',
    ...attributes,
  },
});

describe('an attribute carrying a declaration rather than an observation', () => {
  const vocabularies = Object.entries({ GEN_AI, OPEN_INFERENCE, CODE, VCS, MCP, ORCHESCOPE }).map(
    ([name, vocabulary]) => ({ name, attributes: new Set<string>(Object.values(vocabulary)) }),
  );

  it('is named, so that reaching for one runs into the measurement', () => {
    assert.ok(
      REDERIVABLE_ATTRIBUTES.length > 0,
      'the refusal is a sentence again rather than data',
    );
    for (const refused of REDERIVABLE_ATTRIBUTES) {
      assert.ok(refused.writtenBy.length > 0, `${refused.name} does not say who writes it`);
      assert.ok(refused.rederives.length > 0, `${refused.name} does not say what it rederives`);
    }
  });

  it('is in none of the vocabularies this build reads', () => {
    for (const refused of REDERIVABLE_ATTRIBUTES) {
      for (const vocabulary of vocabularies) {
        assert.equal(
          vocabulary.attributes.has(refused.name),
          false,
          `${refused.name} is in ${vocabulary.name}, and it rederives ${refused.rederives}`,
        );
      }
    }
  });

  it('draws no relation between the two spans it names', () => {
    for (const refused of REDERIVABLE_ATTRIBUTES) {
      const result = topologyOf([
        analyst({}),
        strategist({ [refused.name]: 'Lead Market Analyst' }),
      ]);
      assert.deepEqual(
        result.topology.edges.map(
          (edge) => `${edge.fromObservedName} ${edge.kind} ${edge.toObservedName}`,
        ),
        [],
        `${refused.name} drew a relation, and it rederives ${refused.rederives}`,
      );
    }
  });

  it('leaves a relation the run really did report alone', () => {
    const result = topologyOf([analyst({}), strategist({}, '1111111111111111')]);
    assert.ok(
      result.topology.edges.length > 0,
      'the same fixture draws no relation from a real nesting either, so the refusal above proves nothing',
    );
  });
});
