import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { OrchescopeError } from '@orchescope/domain';
import type { ProgressEvent } from '@orchescope/observability';
import type { ReportBundle } from '@orchescope/schema';
import { cookieHeader, createToken, securityHeaders, verifyRequest } from './security.ts';

/**
 * The local report server.
 *
 * It serves three static files and a small API. State changing routes exist only when the caller supplies a
 * handler for them, so a report served in a read only context has no write surface at all rather than a surface
 * that refuses at request time.
 *
 * The bundle is held in memory and re-read through a getter, so a rescan updates what the browser sees without a
 * restart.
 */

export type ActionResult = {
  readonly status: number;
  readonly body: unknown;
};

/**
 * An action may be synchronous. Creating a goal reads the store and returns; running a scenario starts a process. The
 * type admits both rather than requiring the quick ones to pretend they wait for something.
 */
export type Action<Input> = (input: Input) => ActionResult | Promise<ActionResult>;

export type ServerActions = {
  readonly createGoal?: Action<string>;
  readonly rerunScenario?: Action<string>;
  readonly runBenchmark?: Action<{
    readonly scenarioId: string;
    readonly dimension: string;
    readonly values: readonly string[];
  }>;
  readonly runChaos?: Action<string>;
  readonly compareRuns?: Action<{
    readonly baseline: string;
    readonly candidate: string;
  }>;
  readonly openLocation?: Action<{
    readonly file: string;
    readonly line?: number;
  }>;
};

export type ReportServerOptions = {
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly assetDirectory: string;
  readonly bundle: () => ReportBundle;
  readonly actions?: ServerActions;
  readonly maxRequestBytes?: number;
};

export type ReportServerHandle = {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly publish: (event: ProgressEvent) => void;
  readonly close: () => Promise<void>;
};

const ASSETS: Readonly<Record<string, string>> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/app.css': 'app.css',
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  'index.html': 'text/html; charset=utf-8',
  'app.js': 'text/javascript; charset=utf-8',
  'app.css': 'text/css; charset=utf-8',
};

const readJsonBody = async (
  request: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBytes) {
      // Reading stops here rather than buffering the rest, and the refusal is answered before the socket is closed.
      throw new OrchescopeError(
        'LIMIT_EXCEEDED',
        `The request body is larger than ${maxBytes} bytes.`,
      );
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'The request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
};

const stringField = (body: Record<string, unknown>, name: string): string => {
  const value = body[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new OrchescopeError('INVALID_ARGUMENT', `The field ${name} must be a short string.`);
  }
  return value;
};

/**
 * The state changing routes. Each one is present only when the caller wired up the matching action, so a report served
 * without them answers 404 rather than pretending the button will work.
 */
const ACTION_ROUTES: Readonly<
  Record<
    string,
    {
      readonly select: (actions: ServerActions) => Action<never> | undefined;
      readonly read: (body: Record<string, unknown>) => unknown;
    }
  >
> = {
  '/api/goals': {
    select: (actions) => actions.createGoal as Action<never> | undefined,
    read: (body) => stringField(body, 'findingId'),
  },
  '/api/scenario-runs': {
    select: (actions) => actions.rerunScenario as Action<never> | undefined,
    read: (body) => stringField(body, 'scenarioId'),
  },
  '/api/benchmarks': {
    select: (actions) => actions.runBenchmark as Action<never> | undefined,
    read: (body) => ({
      scenarioId: stringField(body, 'scenarioId'),
      dimension: stringField(body, 'dimension'),
      values: Array.isArray(body['values'])
        ? body['values'].filter((value): value is string => typeof value === 'string')
        : [],
    }),
  },
  '/api/chaos-runs': {
    select: (actions) => actions.runChaos as Action<never> | undefined,
    read: (body) => stringField(body, 'scenarioId'),
  },
  '/api/comparisons': {
    select: (actions) => actions.compareRuns as Action<never> | undefined,
    read: (body) => ({
      baseline: stringField(body, 'baseline'),
      candidate: stringField(body, 'candidate'),
    }),
  },
  '/api/open-location': {
    select: (actions) => actions.openLocation as Action<never> | undefined,
    read: (body) => {
      const line = body['line'];
      return {
        file: stringField(body, 'file'),
        ...(typeof line === 'number' && Number.isInteger(line) && line > 0 ? { line } : {}),
      };
    },
  },
};

/** The bundle is substituted into the JSON island so the page has its data before the first paint. */
const renderAsset = (
  options: ReportServerOptions,
  asset: string,
): { readonly body: string; readonly contentType: string } | undefined => {
  let contents: string;
  try {
    contents = readFileSync(join(options.assetDirectory, asset), 'utf8');
  } catch {
    return undefined;
  }
  const body =
    asset === 'index.html'
      ? contents.replace(
          '__ORCHESCOPE_REPORT__',
          JSON.stringify(options.bundle()).replace(/<\//g, '<\\/'),
        )
      : contents;
  return { body, contentType: CONTENT_TYPES[asset] ?? 'application/octet-stream' };
};

/** Everything a request handler needs, gathered once so the handlers can live outside the factory. */
type ServerRuntime = {
  readonly options: ReportServerOptions;
  readonly token: string;
  readonly maxRequestBytes: number;
  readonly listeners: Set<ServerResponse>;
  readonly recent: ProgressEvent[];
  readonly boundPort: () => number;
};

const send = (
  runtime: ServerRuntime,
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  setCookie: boolean,
): void => {
  const headers: Record<string, string> = {
    ...securityHeaders(contentType),
    'content-length': String(Buffer.byteLength(body)),
  };
  if (setCookie) headers['set-cookie'] = cookieHeader(runtime.token);
  response.writeHead(status, headers);
  response.end(body);
};

const sendJson = (
  runtime: ServerRuntime,
  response: ServerResponse,
  status: number,
  value: unknown,
  setCookie = false,
): void =>
  send(
    runtime,
    response,
    status,
    'application/json; charset=utf-8',
    JSON.stringify(value),
    setCookie,
  );

const handleAction = async (
  runtime: ServerRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<boolean> => {
  const route = ACTION_ROUTES[path];
  if (route === undefined) return false;
  const action = route.select(runtime.options.actions ?? {});
  if (action === undefined) return false;
  const body = await readJsonBody(request, runtime.maxRequestBytes);
  const result = await action(route.read(body) as never);
  sendJson(runtime, response, result.status, result.body);
  return true;
};

const handleGet = (
  runtime: ServerRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  setCookie: boolean,
): void => {
  const asset = ASSETS[path];
  if (asset !== undefined) {
    const rendered = renderAsset(runtime.options, asset);
    if (rendered === undefined) {
      sendJson(runtime, response, 500, {
        error: `the report asset ${asset} is missing from this installation`,
      });
      return;
    }
    send(runtime, response, 200, rendered.contentType, rendered.body, setCookie);
    return;
  }
  if (path === '/api/report') {
    sendJson(runtime, response, 200, runtime.options.bundle(), setCookie);
    return;
  }
  if (path === '/api/events') {
    response.writeHead(200, {
      ...securityHeaders('text/event-stream'),
      connection: 'keep-alive',
    });
    for (const event of runtime.recent) response.write(`data: ${JSON.stringify(event)}\n\n`);
    runtime.listeners.add(response);
    request.on('close', () => runtime.listeners.delete(response));
    return;
  }
  sendJson(runtime, response, 404, { error: 'no such route' });
};

const handleRequest = async (
  runtime: ServerRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const port = runtime.boundPort();
  const host = runtime.options.host === '::1' ? '[::1]' : runtime.options.host;
  const verdict = verifyRequest(request, {
    token: runtime.token,
    host: runtime.options.host,
    port,
    origin: `http://${host}:${port}`,
  });
  if (!verdict.ok) {
    sendJson(runtime, response, verdict.status, { error: verdict.reason });
    return;
  }

  const path = new URL(request.url ?? '/', `http://${host}:${port}`).pathname;
  if (request.method === 'GET') {
    handleGet(runtime, request, response, path, verdict.setCookie);
    return;
  }
  if (request.method === 'POST') {
    const handled = await handleAction(runtime, request, response, path);
    if (!handled) {
      sendJson(runtime, response, 404, { error: 'this action is not available in this report' });
    }
    return;
  }
  sendJson(runtime, response, 405, { error: 'only GET and POST are accepted' });
};

export const startReportServer = async (
  options: ReportServerOptions,
): Promise<ReportServerHandle> => {
  const token = createToken();
  const listeners = new Set<ServerResponse>();
  const recent: ProgressEvent[] = [];
  let server: Server;
  const runtime: ServerRuntime = {
    options,
    token,
    maxRequestBytes: options.maxRequestBytes ?? 64 * 1024,
    listeners,
    recent,
    boundPort: () => (server.address() as { port: number } | null)?.port ?? options.port,
  };

  server = createServer((request, response) => {
    handleRequest(runtime, request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'request failed';
      // A body that exceeded the limit is reported as such, so a caller can tell a size problem from a bad request.
      const status =
        error instanceof OrchescopeError && error.code === 'LIMIT_EXCEEDED' ? 413 : 400;
      if (!response.headersSent) sendJson(runtime, response, status, { error: message });
      else response.end();
    });
  });
  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 35_000;

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
    throw new OrchescopeError('NETWORK_REFUSED', 'The report server did not bind to a port.');
  }
  const host = options.host === '::1' ? '[::1]' : options.host;

  return {
    url: `http://${host}:${address.port}/?token=${token}`,
    port: address.port,
    token,
    publish: (event) => {
      recent.push(event);
      if (recent.length > 200) recent.shift();
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const listener of listeners) listener.write(payload);
    },
    close: async () => {
      for (const listener of listeners) listener.end();
      listeners.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error: Error | undefined) =>
          error === undefined ? resolve() : reject(error),
        );
        server.closeIdleConnections();
      });
    },
  };
};
