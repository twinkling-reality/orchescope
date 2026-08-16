import { GEN_AI, ORCHESCOPE } from '@orchescope/traces/attributes';
import type { AttributeValue, SpanAttributes } from './exporter.ts';
import { recogniseModelCall } from './model-endpoints.ts';
import { SPAN_KIND_CLIENT, type SpanHandle, type Tracer } from './tracer.ts';

/** What the platform's own `fetch` accepts, rather than a shape borrowed from a browser type library. */
type FetchInput = Parameters<typeof globalThis.fetch>[0];

/**
 * Every outbound request the target makes, as a span.
 *
 * `fetch` is where a hand rolled agent system actually touches the outside world: the model it calls, the
 * MCP server it talks to over HTTP, and the payment or notification it sends. It is also the one thing an
 * automatic instrumentation can reach without patching a single package, because it is a global.
 *
 * The rule this follows throughout: the request happens exactly as it would have. Nothing here is inside
 * the caller's control flow. Every failure in this file is swallowed, the original function is called with
 * the original arguments, and the caller receives the original promise. Instrumentation that can change
 * the behaviour of the thing it measures is not instrumentation.
 */

/** Read from the response only when the provider sent a bounded JSON document. A stream is left alone. */
const USAGE_BODY_LIMIT = 1_000_000;

/** The one request header worth reading. It is the header the duplicate effect analysis exists to look for. */
const IDEMPOTENCY_HEADER = 'idempotency-key';

const requestUrl = (input: FetchInput): URL | undefined => {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
    return new URL((input as Request).url);
  } catch {
    return undefined;
  }
};

const requestMethod = (input: FetchInput, init: RequestInit | undefined): string => {
  const declared =
    init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined);
  return (declared ?? 'GET').toUpperCase();
};

/**
 * The request body, only when it is already a string in hand.
 *
 * A stream is not read and a `Request` is not consumed: reading either would take the body away from the
 * call that is about to need it. What is lost is the model name on a streamed request, and the alternative
 * is a shim that breaks uploads.
 */
const requestBody = (init: RequestInit | undefined): string | undefined =>
  typeof init?.body === 'string' ? init.body : undefined;

const headerValue = (
  input: FetchInput,
  init: RequestInit | undefined,
  name: string,
): string | undefined => {
  try {
    const headers = new Headers(
      init?.headers ??
        (typeof input === 'object' && 'headers' in input ? input.headers : undefined),
    );
    return headers.get(name) ?? undefined;
  } catch {
    return undefined;
  }
};

/** A target without its query string, because a query string is where a credential ends up. */
const targetOf = (url: URL): string => `${url.host}${url.pathname}`;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const modelAttributes = (
  provider: string,
  operation: string,
  model: string | undefined,
): SpanAttributes => ({
  [GEN_AI.operationName]: operation,
  [GEN_AI.providerName]: provider,
  ...(model === undefined ? {} : { [GEN_AI.requestModel]: model }),
});

const outboundAttributes = (url: URL, method: string): SpanAttributes => ({
  [ORCHESCOPE.component]: url.host,
  'http.request.method': method,
  'server.address': url.host,
  'url.path': url.pathname,
});

/**
 * Token counts, read from a copy of the response.
 *
 * Copying a response buffers it, so this happens only for a call already recognised as a model call, only
 * when the provider declared a bounded JSON document, and never for a stream. A streamed completion
 * reports its usage in a terminal event that reading here would consume, so it is left to the SDK patches.
 */
const recordUsage = (span: SpanHandle, response: Response): void => {
  const type = response.headers.get('content-type') ?? '';
  const length = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (!type.includes('application/json')) return;
  if (!Number.isFinite(length) || length > USAGE_BODY_LIMIT) return;
  void response
    .clone()
    .json()
    .then((payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) return;
      const record = payload as Record<string, unknown>;
      const model = record['model'];
      if (typeof model === 'string' && model.length > 0) span.set(GEN_AI.responseModel, model);
      const usage = record['usage'];
      if (typeof usage !== 'object' || usage === null) return;
      const counts = usage as Record<string, unknown>;
      const input = counts['input_tokens'] ?? counts['prompt_tokens'];
      const output = counts['output_tokens'] ?? counts['completion_tokens'];
      if (typeof input === 'number') span.set(GEN_AI.inputTokens, input);
      if (typeof output === 'number') span.set(GEN_AI.outputTokens, output);
    })
    .catch(() => {
      // The body was not what its own headers said it was. Nothing here is worth failing a run over.
    });
};

const effectOutcome = (status: number): string =>
  status < 400 ? 'succeeded' : status < 500 ? 'failed' : 'unknown';

export type FetchPatchOptions = {
  readonly tracer: Tracer;
  readonly original: typeof globalThis.fetch;
  /**
   * The receiver this run exports to, so that traffic to it is never itself traced.
   *
   * A target that already exports OTLP over HTTP does it with `fetch`, so without this the act of
   * reporting a span becomes a span, and the report of that becomes another. The first target this ran
   * against was the demonstration exporter, which posts its own spans by hand: one hand written span
   * arrived as two, from two services, and the count a reader trusts had a copy of the machinery in it.
   */
  readonly receiverOrigin: string;
};

/** What a span for this request is called and carries, decided before the request is made. */
const describeRequest = (
  url: URL,
  method: string,
  body: string | undefined,
): {
  readonly name: string;
  readonly attributes: SpanAttributes;
  readonly isModelCall: boolean;
} => {
  const call = recogniseModelCall(url, body);
  if (call === undefined) {
    return {
      name: `outbound_request ${url.host}`,
      attributes: outboundAttributes(url, method),
      isModelCall: false,
    };
  }
  return {
    name: `${call.operation} ${call.model ?? call.provider}`,
    attributes: {
      ...outboundAttributes(url, method),
      ...modelAttributes(call.provider, call.operation, call.model),
    },
    isModelCall: true,
  };
};

/**
 * A write that reached the outside world, recorded as the event duplicate analysis reads.
 *
 * An outcome of `unknown` is not a hedge. A request that never returned may still have been delivered, and
 * that is precisely the case a duplicated effect comes from, so it counts as an occurrence rather than
 * being dropped for want of a confirmation.
 */
const recordEffect = (
  span: SpanHandle,
  input: {
    readonly url: URL;
    readonly method: string;
    readonly outcome: string;
    readonly idempotencyKey: string | undefined;
  },
): void => {
  if (!WRITE_METHODS.has(input.method)) return;
  span.addEvent(ORCHESCOPE.sideEffectEvent, {
    [ORCHESCOPE.sideEffectKind]: `http.${input.method.toLowerCase()}`,
    [ORCHESCOPE.sideEffectTarget]: targetOf(input.url),
    [ORCHESCOPE.sideEffectOutcome]: input.outcome,
    ...(input.idempotencyKey === undefined
      ? {}
      : { [ORCHESCOPE.sideEffectKey]: input.idempotencyKey }),
  });
};

export const instrumentedFetch = (options: FetchPatchOptions): typeof globalThis.fetch => {
  const { tracer, original, receiverOrigin } = options;
  return async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url === undefined || url.origin === receiverOrigin) return original(input, init);

    const method = requestMethod(input, init);
    const described = describeRequest(url, method, requestBody(init));
    const span = tracer.start({
      name: described.name,
      kind: SPAN_KIND_CLIENT,
      attributes: described.attributes,
    });
    const idempotencyKey = headerValue(input, init, IDEMPOTENCY_HEADER);

    try {
      const response = await tracer.within(span, () => original(input, init));
      span.set('http.response.status_code', response.status as AttributeValue);
      if (described.isModelCall) recordUsage(span, response);
      recordEffect(span, {
        url,
        method,
        outcome: effectOutcome(response.status),
        idempotencyKey,
      });
      span.end(response.ok ? 'ok' : 'error', response.ok ? undefined : `status ${response.status}`);
      return response;
    } catch (error) {
      recordEffect(span, { url, method, outcome: 'unknown', idempotencyKey });
      span.end('error', error instanceof Error ? error.message : 'the request failed');
      throw error;
    }
  };
};
