import { createHash } from 'node:crypto';
import { CODE, GEN_AI, MCP, ORCHESCOPE, VCS } from '@orchescope/traces/attributes';
import type { AttributeValue, SpanAttributes } from './exporter.ts';
import { type ProtocolCall, recogniseProtocolCall } from './json-rpc.ts';
import { recogniseModelCall } from './model-endpoints.ts';
import type { SourceFrame, SourceFrameReader } from './source-frame.ts';
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

/**
 * What an effect acted on: the host and the path, and which request it was.
 *
 * The query string is left out because a query string is where a credential ends up, and this string
 * travels into a report. The digest is in because duplicate detection keys on this: two writes to the same
 * endpoint are the same logical operation when they carry the same request and two different operations
 * when they do not. Without it, a system that posts two different messages to one webhook in a single run
 * would be reported as having performed one outside effect twice, at high severity, which is the exact
 * shape of confident wrongness this work exists to remove.
 *
 * A digest is not the body. Nothing here can be read back out of it, and no payload leaves the process.
 */
const targetOf = (url: URL, body: string | undefined): string => {
  const path = `${url.host}${url.pathname}`;
  if (body === undefined || body.length === 0) return path;
  return `${path}#${createHash('sha256').update(body).digest('hex').slice(0, 8)}`;
};

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

/**
 * What every outbound request carries, whatever it turned out to be.
 *
 * `orchescope.component` is left out on purpose. It overrides every other name when the topology decides
 * what a span belongs to, so setting it to the host here would bury the tool name a protocol call carries
 * and turn an `execute_tool` span into another external service. It is added back, below, only for the
 * requests whose component genuinely is the host they went to.
 */
const httpAttributes = (url: URL, method: string): SpanAttributes => ({
  'http.request.method': method,
  'server.address': url.host,
  'url.path': url.pathname,
});

const outboundAttributes = (url: URL, method: string): SpanAttributes => ({
  ...httpAttributes(url, method),
  [ORCHESCOPE.component]: url.host,
});

/**
 * A protocol call, named by what it did rather than by where it went.
 *
 * `mcp.tool.name` is one of the three names reconciliation joins tools on, so a tool a repository declared
 * and a tool a run executed become the same component. The server address stays as an attribute: the tool
 * is what ran, and which server answered is a fact about it.
 */
const protocolAttributes = (
  url: URL,
  method: string,
  call: ProtocolCall,
): { readonly name: string; readonly attributes: SpanAttributes } => {
  const base: SpanAttributes = {
    ...httpAttributes(url, method),
    [MCP.methodName]: call.method,
    [MCP.serverName]: url.host,
  };
  if (call.toolName === undefined) {
    return {
      name: `outbound_request ${url.host}`,
      attributes: { ...base, [ORCHESCOPE.component]: url.host },
    };
  }
  return {
    name: `execute_tool ${call.toolName}`,
    attributes: { ...base, [MCP.toolName]: call.toolName },
  };
};

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
  /**
   * Where the call was made from, when this run named a repository to answer against.
   *
   * Absent is ordinary: a run may not have named one, and a process reached through an inherited
   * `NODE_OPTIONS` may not be the target at all.
   */
  readonly sourceFrames?: SourceFrameReader;
};

/**
 * The call site, written onto the span after the request rather than before it.
 *
 * Reading a file to hash it is the one thing here that touches the disk, so it happens once the response
 * is in hand and the caller is no longer waiting: the span is still open, and `recordUsage` already
 * writes to it from the same place. What the capture itself costs is bounded by the frame limit and is
 * paid before the request, because the stack that made the call does not survive the await.
 *
 * Two coordinates go out and they answer different questions, so both are written when both can be. The
 * pinned pair is what lets a location cross repositories, which a run that spawns a second process
 * needs, and it exists only where the checkout is clean and has a remote. The audit-relative path and
 * the digest are what let a location be believed on a tree somebody is editing, which is every other
 * run, and they are checkable by hand.
 */
const sourceAttributes = (frame: SourceFrame): SpanAttributes => ({
  [CODE.filePath]: frame.absoluteFile,
  [ORCHESCOPE.repositoryPath]: frame.repositoryFile,
  ...(frame.auditFile === undefined ? {} : { [ORCHESCOPE.auditPath]: frame.auditFile }),
  ...(frame.line === undefined ? {} : { [CODE.lineNumber]: frame.line }),
  ...(frame.functionName === undefined ? {} : { [CODE.functionName]: frame.functionName }),
  ...(frame.digest === undefined ? {} : { [ORCHESCOPE.fileDigest]: frame.digest }),
  ...(frame.repositoryUrl === undefined ? {} : { [VCS.repositoryUrl]: frame.repositoryUrl }),
  ...(frame.revision === undefined ? {} : { [VCS.headRevision]: frame.revision }),
  [ORCHESCOPE.sourceCapture]: 'node.callsite.tracked_file',
});

const recordSource = (
  span: SpanHandle,
  reader: SourceFrameReader,
  frame: SourceFrame | undefined,
): void => {
  if (frame === undefined) return;
  const digest = reader.digestOf(frame.absoluteFile);
  for (const [key, value] of Object.entries(
    sourceAttributes(digest === undefined ? frame : { ...frame, digest }),
  )) {
    span.set(key, value as AttributeValue);
  }
};

/**
 * What a span for this request is called and carries, decided before the request is made.
 *
 * Three shapes, in order of how much they say. A call to a published model endpoint is a model call. A
 * JSON-RPC document is a protocol call and names the tool it executed. Everything else is a request to a
 * service, which is the least a run can say about reaching one and still more than nothing.
 */
const describeRequest = (
  url: URL,
  method: string,
  body: string | undefined,
): {
  readonly name: string;
  readonly attributes: SpanAttributes;
  readonly isModelCall: boolean;
  readonly isOutsideEffect: boolean;
} => {
  const model = recogniseModelCall(url, body);
  if (model !== undefined) {
    /*
     * The host is an attribute here and never the component. A model call's component is the model, which
     * the span names and `gen_ai.request.model` carries, and `orchescope.component` overrides both: set to
     * the host it reported the two models of a run as one component called `api.openai.com`, which is a
     * name no repository declares and no reader asked about. That is the case the rule above describes as
     * a request whose component genuinely is the host, and a model call is not one.
     */
    return {
      name: `${model.operation} ${model.model ?? model.system}`,
      attributes: {
        ...httpAttributes(url, method),
        ...modelAttributes(model.system, model.operation, model.model),
      },
      isModelCall: true,
      isOutsideEffect: false,
    };
  }
  const protocol = recogniseProtocolCall(body);
  if (protocol !== undefined) {
    return {
      ...protocolAttributes(url, method, protocol),
      isModelCall: false,
      isOutsideEffect: false,
    };
  }
  return {
    name: `outbound_request ${url.host}`,
    attributes: outboundAttributes(url, method),
    isModelCall: false,
    isOutsideEffect: WRITE_METHODS.has(method),
  };
};

/**
 * A write that reached the outside world, recorded as the event duplicate analysis reads.
 *
 * Only a plain write counts. A model call is a POST and so is every Model Context Protocol message, and
 * recording those here would put the transport into the ledger of things that happened to the world: two
 * chat completions in one run would read as one outside effect performed twice, at high severity, and so
 * would two calls to two different tools on one server. What each of those did is the business of the
 * component the span already names.
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
    readonly body: string | undefined;
    readonly outcome: string;
    readonly idempotencyKey: string | undefined;
  },
): void => {
  span.addEvent(ORCHESCOPE.sideEffectEvent, {
    [ORCHESCOPE.sideEffectKind]: `http.${input.method.toLowerCase()}`,
    [ORCHESCOPE.sideEffectTarget]: targetOf(input.url, input.body),
    [ORCHESCOPE.sideEffectOutcome]: input.outcome,
    ...(input.idempotencyKey === undefined
      ? {}
      : { [ORCHESCOPE.sideEffectKey]: input.idempotencyKey }),
  });
};

export const instrumentedFetch = (options: FetchPatchOptions): typeof globalThis.fetch => {
  const { tracer, original, receiverOrigin, sourceFrames } = options;
  return async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url === undefined || url.origin === receiverOrigin) return original(input, init);

    const method = requestMethod(input, init);
    const body = requestBody(init);
    const described = describeRequest(url, method, body);
    // Taken here because the stack that reached this call does not survive the await below.
    const frame = sourceFrames?.capture();
    const span = tracer.start({
      name: described.name,
      kind: SPAN_KIND_CLIENT,
      attributes: described.attributes,
    });
    const idempotencyKey = headerValue(input, init, IDEMPOTENCY_HEADER);
    const effect = { url, method, body, idempotencyKey };

    try {
      const response = await tracer.within(span, () => original(input, init));
      span.set('http.response.status_code', response.status as AttributeValue);
      if (sourceFrames !== undefined) recordSource(span, sourceFrames, frame);
      if (described.isModelCall) recordUsage(span, response);
      if (described.isOutsideEffect) {
        recordEffect(span, { ...effect, outcome: effectOutcome(response.status) });
      }
      span.end(response.ok ? 'ok' : 'error', response.ok ? undefined : `status ${response.status}`);
      return response;
    } catch (error) {
      if (sourceFrames !== undefined) recordSource(span, sourceFrames, frame);
      if (described.isOutsideEffect) recordEffect(span, { ...effect, outcome: 'unknown' });
      span.end('error', error instanceof Error ? error.message : 'the request failed');
      throw error;
    }
  };
};
