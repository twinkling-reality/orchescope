import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { OrchescopeError } from '@orchescope/domain';
import type { TraceBundle } from '@orchescope/schema';
import {
  type NormalizeOptions,
  decodeTraceJson,
  decodeTraceProtobuf,
  mergeBundles,
  normalizeTraces,
} from '@orchescope/traces';

/**
 * A loopback OTLP receiver.
 *
 * The OpenTelemetry SDKs export `application/x-protobuf` by default and `application/json` when asked, so
 * both are accepted. Everything else about this server is deliberately minimal: it binds to loopback only,
 * it answers `POST /v1/traces` and nothing else, it enforces a request size ceiling before reading a body
 * into memory, and it never follows a redirect or makes an outbound request of its own.
 *
 * Responses follow the OTLP specification: 200 with an `ExportTraceServiceResponse`, `partialSuccess` when
 * spans were rejected, and 4xx for a request the receiver cannot read. A 400 is not retryable and the
 * specification forbids a client from retrying it, which is why a malformed body is answered with 400
 * rather than 500.
 */

export type ReceiverOptions = {
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly runId: string;
  readonly maxSpansPerRun: number;
  readonly maxRequestBytes: number;
  readonly maxSpanAttributeBytes: number;
  readonly now: () => string;
};

export type ReceiverHandle = {
  readonly url: string;
  readonly port: number;
  /** Bundles received so far, merged into one. */
  readonly collected: () => TraceBundle;
  readonly requestCount: () => number;
  readonly close: () => Promise<void>;
};

const EMPTY_SUCCESS = JSON.stringify({ partialSuccess: {} });

const readBody = async (
  request: IncomingMessage,
  maxBytes: number,
): Promise<{ readonly bytes: Buffer } | { readonly error: string }> => {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: `body of ${declared} bytes exceeds the ${maxBytes} byte limit` };
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBytes) return { error: `body exceeded the ${maxBytes} byte limit` };
    chunks.push(buffer);
  }
  const bytes = Buffer.concat(chunks);
  if (request.headers['content-encoding'] === 'gzip') {
    try {
      return { bytes: gunzipSync(bytes) };
    } catch {
      return { error: 'body was not valid gzip' };
    }
  }
  return { bytes };
};

const respond = (response: ServerResponse, status: number, body: string): void => {
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
};

export const startReceiver = async (options: ReceiverOptions): Promise<ReceiverHandle> => {
  const bundles: TraceBundle[] = [];
  let requestCount = 0;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== 'POST') {
      respond(response, 405, JSON.stringify({ error: 'only POST is accepted' }));
      return;
    }
    const path = (request.url ?? '').split('?')[0];
    if (path !== '/v1/traces') {
      respond(response, 404, JSON.stringify({ error: 'only /v1/traces is served' }));
      return;
    }
    const body = await readBody(request, options.maxRequestBytes);
    if ('error' in body) {
      respond(response, 413, JSON.stringify({ error: body.error }));
      return;
    }
    requestCount += 1;
    const contentType = String(request.headers['content-type'] ?? '');
    const normalizeOptions: NormalizeOptions = {
      runId: options.runId,
      capturedAt: options.now(),
      source: contentType.includes('json') ? 'otlp_http_json' : 'otlp_http_protobuf',
      maxSpans: options.maxSpansPerRun,
      maxAttributeBytes: options.maxSpanAttributeBytes,
    };

    try {
      if (contentType.includes('json')) {
        const payload = JSON.parse(body.bytes.toString('utf8')) as unknown;
        bundles.push(normalizeTraces(decodeTraceJson(payload), normalizeOptions).bundle);
      } else if (contentType.includes('protobuf') || contentType.length === 0) {
        bundles.push(
          normalizeTraces(decodeTraceProtobuf(new Uint8Array(body.bytes)), normalizeOptions).bundle,
        );
      } else {
        respond(response, 415, JSON.stringify({ error: `unsupported content type ${contentType}` }));
        return;
      }
    } catch (error) {
      respond(
        response,
        400,
        JSON.stringify({ error: error instanceof Error ? error.message : 'body could not be decoded' }),
      );
      return;
    }

    const latest = bundles[bundles.length - 1];
    const rejectedSpans = latest?.rejected.reduce((total, entry) => total + entry.count, 0) ?? 0;
    if (rejectedSpans > 0) {
      respond(
        response,
        200,
        JSON.stringify({
          partialSuccess: {
            rejectedSpans: String(rejectedSpans),
            errorMessage: latest?.rejected.map((entry) => entry.reason).join('; ') ?? '',
          },
        }),
      );
      return;
    }
    respond(response, 200, EMPTY_SUCCESS);
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) {
        respond(response, 500, JSON.stringify({ error: 'receiver failure' }));
      } else {
        response.end();
      }
    });
  });
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new OrchescopeError('NETWORK_REFUSED', 'The trace receiver did not bind to a port.');
  }

  const host = options.host === '::1' ? '[::1]' : options.host;
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    collected: () =>
      bundles.length === 0
        ? {
            schemaVersion: 1,
            runId: options.runId,
            capturedAt: options.now(),
            source: 'otlp_http_protobuf',
            services: [],
            spans: [],
            sideEffects: [],
            droppedSpanCount: 0,
            rejected: [],
            metadata: {},
          }
        : mergeBundles(bundles, options.runId),
    requestCount: () => requestCount,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeIdleConnections();
      }),
  };
};
