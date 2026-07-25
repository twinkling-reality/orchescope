import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson, decodeTraceProtobuf } from '../src/otlp.ts';
import { ProtobufError } from '../src/protobuf.ts';

/**
 * The protobuf path, which is the one most senders actually use.
 *
 * The OpenTelemetry JavaScript SDK exports `application/x-protobuf` by default, so this decoder carries the traffic of a
 * typical installation. It is a hand written wire reader rather than generated code, which is exactly the kind of component
 * that has to be tested against bytes rather than against a mock.
 *
 * The encoder below is part of the test: writing the wire format by hand is what makes decoding it evidence of anything.
 */

const varint = (value: number | bigint): Buffer => {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    const byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    bytes.push(remaining > 0n ? byte | 0x80 : byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
};

const tag = (field: number, wire: number): Buffer => varint((field << 3) | wire);

/** Wire type 2: a length delimited field, which is how every nested message is encoded. */
const message = (field: number, body: Buffer): Buffer =>
  Buffer.concat([tag(field, 2), varint(body.length), body]);

const text = (field: number, value: string): Buffer => message(field, Buffer.from(value, 'utf8'));

const bytes = (field: number, value: Buffer): Buffer => message(field, value);

/** Wire type 0: a varint field. */
const integer = (field: number, value: number | bigint): Buffer =>
  Buffer.concat([tag(field, 0), varint(value)]);

/** Wire type 1: a fixed 64 bit field, which is how a double is encoded. */
const double = (field: number, value: number): Buffer => {
  const payload = Buffer.alloc(8);
  payload.writeDoubleLE(value);
  return Buffer.concat([tag(field, 1), payload]);
};

const stringAttribute = (key: string, value: string): Buffer =>
  Buffer.concat([text(1, key), message(2, text(1, value))]);

const intAttribute = (key: string, value: number): Buffer =>
  Buffer.concat([text(1, key), message(2, integer(3, value))]);

const boolAttribute = (key: string, value: boolean): Buffer =>
  Buffer.concat([text(1, key), message(2, integer(2, value ? 1 : 0))]);

const doubleAttribute = (key: string, value: number): Buffer =>
  Buffer.concat([text(1, key), message(2, double(4, value))]);

const arrayAttribute = (key: string, values: readonly string[]): Buffer =>
  Buffer.concat([
    text(1, key),
    message(2, message(5, Buffer.concat(values.map((value) => message(1, text(1, value)))))),
  ]);

const TRACE_ID = Buffer.from('a'.repeat(32), 'hex');
const SPAN_ID = Buffer.from('1'.repeat(16), 'hex');
const PARENT_ID = Buffer.from('2'.repeat(16), 'hex');

const span = (): Buffer =>
  Buffer.concat([
    bytes(1, TRACE_ID),
    bytes(2, SPAN_ID),
    bytes(4, PARENT_ID),
    text(5, 'chat demo-small'),
    integer(6, 3),
    integer(7, 1_700_000_000_000_000_000n),
    integer(8, 1_700_000_000_150_000_000n),
    message(9, stringAttribute('gen_ai.operation.name', 'chat')),
    message(9, stringAttribute('gen_ai.request.model', 'demo-small')),
    message(9, intAttribute('gen_ai.usage.input_tokens', 128)),
    message(9, boolAttribute('orchescope.task.success', true)),
    message(9, doubleAttribute('gen_ai.request.temperature', 0.25)),
    message(9, arrayAttribute('gen_ai.request.stop_sequences', ['\\n\\n', 'END'])),
    message(
      11,
      Buffer.concat([
        integer(1, 1_700_000_000_100_000_000n),
        text(2, 'orchescope.side_effect'),
        message(3, stringAttribute('orchescope.side_effect.kind', 'refund')),
        message(3, stringAttribute('orchescope.side_effect.target', 'payments/order-1234')),
        message(3, stringAttribute('orchescope.side_effect.outcome', 'unknown')),
      ]),
    ),
    message(15, Buffer.concat([text(2, 'the gateway did not answer'), integer(3, 2)])),
  ]);

const request = (): Buffer =>
  message(
    1,
    Buffer.concat([
      message(1, message(1, stringAttribute('service.name', 'protobuf-app'))),
      message(2, Buffer.concat([message(1, text(1, 'orchescope-probe')), message(2, span())])),
    ]),
  );

describe('decodeTraceProtobuf', () => {
  const decoded = decodeTraceProtobuf(request());
  const resource = decoded.resourceSpans[0];
  const scope = resource?.scopeSpans[0];
  const first = scope?.spans[0];

  it('reads the resource, the scope and the span', () => {
    assert.equal(decoded.resourceSpans.length, 1);
    assert.equal(resource?.resourceAttributes['service.name'], 'protobuf-app');
    assert.equal(scope?.scopeName, 'orchescope-probe');
    assert.equal(scope?.spans.length, 1);
  });

  it('converts identifiers to lowercase hex, which is what the join needs', () => {
    assert.equal(first?.traceId, 'a'.repeat(32));
    assert.equal(first?.spanId, '1'.repeat(16));
    assert.equal(first?.parentSpanId, '2'.repeat(16));
  });

  it('reads the name, the kind and both nanosecond timestamps without losing precision', () => {
    assert.equal(first?.name, 'chat demo-small');
    assert.equal(first?.kind, 'client');
    assert.equal(first?.startTimeUnixNano, '1700000000000000000');
    assert.equal(first?.endTimeUnixNano, '1700000000150000000');
  });

  it('reads every attribute value type the conventions use', () => {
    assert.equal(first?.attributes['gen_ai.operation.name'], 'chat');
    assert.equal(first?.attributes['gen_ai.request.model'], 'demo-small');
    assert.equal(first?.attributes['gen_ai.usage.input_tokens'], 128);
    assert.equal(first?.attributes['orchescope.task.success'], true);
    assert.equal(first?.attributes['gen_ai.request.temperature'], 0.25);
    assert.deepEqual(first?.attributes['gen_ai.request.stop_sequences'], ['\\n\\n', 'END']);
  });

  it('reads the status and its message', () => {
    assert.equal(first?.status, 'error');
    assert.equal(first?.statusMessage, 'the gateway did not answer');
  });

  it('reads a span event and its attributes', () => {
    const event = first?.events[0];
    assert.equal(event?.name, 'orchescope.side_effect');
    assert.equal(event?.timeUnixNano, '1700000000100000000');
    assert.equal(event?.attributes['orchescope.side_effect.kind'], 'refund');
    assert.equal(event?.attributes['orchescope.side_effect.outcome'], 'unknown');
  });

  it('produces the same normalized bundle as the equivalent JSON request', () => {
    const options = {
      runId: `run_${'0'.repeat(16)}`,
      capturedAt: '2026-07-24T00:00:00.000Z',
      maxSpans: 100,
      maxAttributeBytes: 256,
    };
    const fromProtobuf = normalizeTraces(decodeTraceProtobuf(request()), {
      ...options,
      source: 'otlp_http_protobuf',
    });
    const fromJson = normalizeTraces(
      decodeTraceJson({
        resourceSpans: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'protobuf-app' } }],
            },
            scopeSpans: [
              {
                scope: { name: 'orchescope-probe' },
                spans: [
                  {
                    traceId: 'a'.repeat(32),
                    spanId: '1'.repeat(16),
                    parentSpanId: '2'.repeat(16),
                    name: 'chat demo-small',
                    kind: 3,
                    startTimeUnixNano: '1700000000000000000',
                    endTimeUnixNano: '1700000000150000000',
                    status: { code: 2, message: 'the gateway did not answer' },
                    attributes: [
                      { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                      { key: 'gen_ai.request.model', value: { stringValue: 'demo-small' } },
                    ],
                    events: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
      { ...options, source: 'otlp_http_json' },
    );

    const protobufSpan = fromProtobuf.bundle.spans[0];
    const jsonSpan = fromJson.bundle.spans[0];
    assert.equal(protobufSpan?.traceId, jsonSpan?.traceId);
    assert.equal(protobufSpan?.spanId, jsonSpan?.spanId);
    assert.equal(protobufSpan?.parentSpanId, jsonSpan?.parentSpanId);
    assert.equal(protobufSpan?.operation, jsonSpan?.operation);
    assert.equal(protobufSpan?.durationMs, jsonSpan?.durationMs);
    assert.equal(protobufSpan?.status, jsonSpan?.status);
    assert.equal(protobufSpan?.kind, jsonSpan?.kind);
  });

  it('skips a field it does not know rather than failing', () => {
    // Field 99 is not in the OTLP schema. A reader that cannot skip an unknown field breaks on the next schema addition.
    const withUnknown = message(
      1,
      Buffer.concat([
        text(99, 'something a later version added'),
        message(1, message(1, stringAttribute('service.name', 'forward-compatible'))),
        message(2, message(2, span())),
      ]),
    );
    const result = decodeTraceProtobuf(withUnknown);
    assert.equal(result.resourceSpans[0]?.resourceAttributes['service.name'], 'forward-compatible');
    assert.equal(result.resourceSpans[0]?.scopeSpans[0]?.spans.length, 1);
  });

  it('reads an empty request as no spans rather than as an error', () => {
    assert.deepEqual(decodeTraceProtobuf(new Uint8Array()), { resourceSpans: [], rejected: [] });
  });
});

describe('malformed protobuf', () => {
  it('refuses a truncated varint', () => {
    assert.throws(() => decodeTraceProtobuf(Buffer.from([0x08, 0x80])), ProtobufError);
  });

  it('refuses a length that runs past the end of the buffer', () => {
    assert.throws(() => decodeTraceProtobuf(Buffer.from([0x0a, 0x7f, 0x01])), ProtobufError);
  });

  it('refuses a deprecated group wire type', () => {
    assert.throws(() => decodeTraceProtobuf(Buffer.from([0x0b])), ProtobufError);
  });

  it('refuses a varint longer than ten bytes', () => {
    const overlong = Buffer.from([0x08, ...Array.from({ length: 11 }, () => 0x80), 0x01]);
    assert.throws(() => decodeTraceProtobuf(overlong), ProtobufError);
  });
});
