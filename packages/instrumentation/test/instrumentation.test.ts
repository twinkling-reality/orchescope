import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createExporter, type FinishedSpan } from '../src/exporter.ts';
import { alreadyInstrumented, install } from '../src/install.ts';
import { recogniseModelCall } from '../src/model-endpoints.ts';
import { instrumentedFetch } from '../src/outbound-fetch.ts';
import { readSettings } from '../src/settings.ts';
import { createTracer, SPAN_KIND_INTERNAL } from '../src/tracer.ts';

/**
 * The shim runs inside a program that never asked for it, so most of what is tested here is what it does
 * not do: it does not activate outside a traced run, it does not post to an address it was handed, it does
 * not run alongside an OpenTelemetry SDK that is already there, and above all it does not change what the
 * code it wraps returns or throws. A tool that can alter the behaviour of the thing it measures is not
 * measuring that thing.
 */

const collected: FinishedSpan[] = [];

const recordingExporter = () => {
  collected.length = 0;
  return {
    record: (span: FinishedSpan) => {
      collected.push(span);
    },
    flush: async () => {
      // Nothing to push: these tests read the spans out of the array above.
    },
    dropped: () => 0,
  };
};

/** A clock and an identifier source that make a trace a function of its inputs alone. */
const countedTracer = () => {
  let nanos = 1_000_000_000_000_000_000n;
  let counter = 0;
  return createTracer({
    exporter: recordingExporter(),
    nowNanos: () => {
      nanos += 1_000_000n;
      return nanos;
    },
    identifier: (bytes) => {
      counter += 1;
      return String(counter).padStart(bytes * 2, '0');
    },
  });
};

describe('deciding whether to switch on at all', () => {
  it('stays off outside a traced run, however the process was started', () => {
    assert.equal(readSettings({}), undefined);
    assert.equal(readSettings({ ORCHESCOPE_OTLP_ENDPOINT: 'http://127.0.0.1:4318' }), undefined);
    assert.equal(readSettings({ ORCHESCOPE_RUN_ID: 'run_0000000000000001' }), undefined);
  });

  /*
   * The shim travels in `NODE_OPTIONS`, which every child process inherits. A shim that posted to whatever
   * address it was handed would be a way to make an unrelated program talk to a host of somebody else's
   * choosing, and nothing about tracing needs that.
   */
  it('refuses an endpoint that is not loopback', () => {
    for (const endpoint of [
      'http://example.com:4318',
      'https://127.0.0.1:4318',
      'http://169.254.169.254',
      'not a url',
    ]) {
      assert.equal(
        readSettings({ ORCHESCOPE_OTLP_ENDPOINT: endpoint, ORCHESCOPE_RUN_ID: 'run_1' }),
        undefined,
        `${endpoint} must not activate the shim`,
      );
    }
  });

  it('switches on for a traced run, and takes the service name the run set', () => {
    const settings = readSettings({
      ORCHESCOPE_OTLP_ENDPOINT: 'http://127.0.0.1:4318/',
      ORCHESCOPE_RUN_ID: 'run_0000000000000001',
      OTEL_SERVICE_NAME: 'support-desk',
    });
    assert.equal(settings?.endpoint, 'http://127.0.0.1:4318');
    assert.equal(settings?.serviceName, 'support-desk');
  });

  /*
   * A target that already runs OpenTelemetry is already answering this question, and better: it knows the
   * names of things this can only see the shape of. Instrumenting on top would report every call twice.
   */
  it('stands down when the target already runs OpenTelemetry', () => {
    const registered = { [Symbol.for('opentelemetry.js.api.1')]: { trace: {} } };
    assert.equal(alreadyInstrumented(registered), true);
    assert.equal(alreadyInstrumented({}), false);

    const globals = { fetch: globalThis.fetch, ...registered };
    const installation = install({
      environment: {
        ORCHESCOPE_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
        ORCHESCOPE_RUN_ID: 'run_0000000000000001',
      },
      globals,
      onBeforeExit: () => {
        // The install refused, so nothing registered a listener to call.
      },
      setInterval: () => ({
        unref: () => {
          // Same: no timer was created to detach.
        },
      }),
    });
    assert.equal(installation, undefined);
    assert.equal(globals.fetch, globalThis.fetch, 'fetch must be left exactly as it was');
  });
});

describe('recognising a model call that arrives as plain HTTP', () => {
  it('names the provider from the host and the model from the body', () => {
    const call = recogniseModelCall(
      new URL('https://api.openai.com/v1/responses'),
      JSON.stringify({ model: 'gpt-4.1-mini', input: 'ignored' }),
    );
    assert.deepEqual(call, { provider: 'openai', operation: 'chat', model: 'gpt-4.1-mini' });
  });

  it('reads the model from the path when the provider puts it there', () => {
    const call = recogniseModelCall(
      new URL(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
      ),
      undefined,
    );
    assert.equal(call?.provider, 'gcp.gemini');
    assert.equal(call?.model, 'gemini-2.5-pro');
  });

  it('separates an embedding call from a chat call', () => {
    const call = recogniseModelCall(new URL('https://api.openai.com/v1/embeddings'), undefined);
    assert.equal(call?.operation, 'embeddings');
  });

  it('leaves the model absent rather than guessing one', () => {
    const call = recogniseModelCall(new URL('https://api.anthropic.com/v1/messages'), 'not json');
    assert.equal(call?.provider, 'anthropic');
    assert.equal(call?.model, undefined);
  });

  it('says nothing about a host it does not recognise', () => {
    assert.equal(recogniseModelCall(new URL('https://example.com/v1/chat'), undefined), undefined);
  });
});

/** Stands in for the receiver a real run exports to, so traffic to it can be shown to be left alone. */
const RECEIVER_ORIGIN = 'http://127.0.0.1:65535';

describe('the fetch that was patched', () => {
  let server: Server;
  let origin: string;

  before(async () => {
    server = createServer((request, response) => {
      if (request.url === '/boom') {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('no');
        return;
      }
      const body = JSON.stringify({ model: 'gpt-4o-mini', usage: { prompt_tokens: 3 } });
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
      });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const patched = () => {
    const tracer = countedTracer();
    return {
      tracer,
      fetch: instrumentedFetch({
        tracer,
        original: globalThis.fetch,
        receiverOrigin: RECEIVER_ORIGIN,
      }),
    };
  };

  it('returns the response the caller would have got, body and all', async () => {
    const response = await patched().fetch(`${origin}/v1/things`);
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), {
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 3 },
    });
  });

  it('records an outbound request as a component the audit can name', async () => {
    await patched().fetch(`${origin}/v1/things`);
    const span = collected[0];
    assert.ok(span !== undefined);
    assert.match(span.name, /^outbound_request 127\.0\.0\.1:\d+$/);
    assert.equal(span.attributes['http.request.method'], 'GET');
    assert.equal(span.status.code, 1);
  });

  /*
   * The event duplicate analysis reads. A write that happened is the thing the whole reconciliation exists
   * to catch happening twice, and the idempotency key is what decides whether the second one mattered.
   */
  it('records a write as a side effect, with the idempotency key when one was sent', async () => {
    await patched().fetch(`${origin}/charge`, {
      method: 'POST',
      headers: { 'idempotency-key': 'order-42' },
      body: '{}',
    });
    const event = collected[0]?.events[0];
    assert.equal(event?.name, 'orchescope.side_effect');
    assert.equal(event?.attributes['orchescope.side_effect.kind'], 'http.post');
    assert.equal(event?.attributes['orchescope.side_effect.idempotency_key'], 'order-42');
    assert.equal(event?.attributes['orchescope.side_effect.outcome'], 'succeeded');
  });

  it('records a read without inventing a side effect for it', async () => {
    await patched().fetch(`${origin}/v1/things`);
    assert.deepEqual(collected[0]?.events, []);
  });

  /*
   * A query string is where a credential ends up, and this target string travels into a report and into
   * the duplicate key. It carries the host and the path and stops there.
   */
  it('keeps the query string out of what it records', async () => {
    await patched().fetch(`${origin}/charge?api_key=secret`, { method: 'POST', body: '{}' });
    const target = collected[0]?.events[0]?.attributes['orchescope.side_effect.target'];
    assert.equal(String(target).includes('secret'), false);
    assert.match(String(target), /\/charge$/);
  });

  it('reports a failing status as an error without throwing one', async () => {
    const response = await patched().fetch(`${origin}/boom`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 500);
    assert.equal(collected[0]?.status.code, 2);
    assert.equal(collected[0]?.events[0]?.attributes['orchescope.side_effect.outcome'], 'unknown');
  });

  /*
   * A request that never completed still happened as far as the outside world is concerned. The rejection
   * the caller sees has to be the original one, and the effect is recorded with its outcome unknown, which
   * is exactly the case duplicate analysis exists for.
   */
  it('lets the original failure through, and records the effect as unknown', async () => {
    const { fetch: instrumented } = patched();
    await assert.rejects(() => instrumented('http://127.0.0.1:1/charge', { method: 'POST' }));
    assert.equal(collected[0]?.status.code, 2);
    assert.equal(collected[0]?.events[0]?.attributes['orchescope.side_effect.outcome'], 'unknown');
  });

  /*
   * A target that already exports OTLP over HTTP does it with `fetch`, so without this the act of reporting
   * a span becomes a span. The demonstration system posts its own spans by hand, and one hand written span
   * arrived at the receiver as two, from two services: the count a reader trusts had the machinery in it.
   */
  it('never traces the run reporting itself', async () => {
    const { fetch: instrumented } = patched();
    await assert.rejects(() =>
      instrumented(`${RECEIVER_ORIGIN}/v1/traces`, { method: 'POST', body: '{}' }),
    );
    assert.deepEqual(collected, []);
  });
});

describe('the tree a trace has to be', () => {
  it('makes a request the target started inside a span a child of that span', () => {
    const tracer = countedTracer();
    const parent = tracer.start({ name: 'execute_tool issue_refund', kind: SPAN_KIND_INTERNAL });
    tracer.within(parent, () => {
      const child = tracer.start({ name: 'outbound_request api.example.com', kind: 3 });
      child.end('ok');
    });
    parent.end('ok');
    assert.equal(collected[0]?.parentSpanId, parent.spanId);
    assert.equal(collected[0]?.traceId, parent.traceId, 'a child belongs to its parent trace');
  });

  it('never reports one piece of work as two executions', () => {
    const tracer = countedTracer();
    const span = tracer.start({ name: 'chat gpt-4o', kind: SPAN_KIND_INTERNAL });
    span.end('ok');
    span.end('error', 'ended twice');
    assert.equal(collected.length, 1);
  });
});

describe('the exporter, inside a process that belongs to someone else', () => {
  it('stops recording at its ceiling and says how many it dropped', async () => {
    const exporter = createExporter({
      endpoint: 'http://127.0.0.1:1',
      serviceName: 'fixture',
      maxSpans: 2,
      send: () => Promise.reject(new Error('nothing is listening')),
    });
    const span = (id: string): FinishedSpan => ({
      traceId: '0'.repeat(32),
      spanId: id.padStart(16, '0'),
      parentSpanId: '',
      name: 'outbound_request example.com',
      kind: 3,
      startTimeUnixNano: '1',
      endTimeUnixNano: '2',
      attributes: {},
      events: [],
      status: { code: 1 },
    });
    exporter.record(span('1'));
    exporter.record(span('2'));
    exporter.record(span('3'));
    assert.equal(exporter.dropped(), 1);
    // An exporter that could not reach its receiver must not turn that into the target's problem.
    await exporter.flush();
  });
});
