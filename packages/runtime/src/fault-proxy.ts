import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { OrchescopeError, decideByKey } from '@orchescope/domain';
import type { FaultKind, FaultPlan, FaultSpec } from '@orchescope/schema';

/**
 * A loopback fault injecting proxy for model traffic.
 *
 * This is the second of the two fault delivery mechanisms. The cooperative mechanism hands the plan to the
 * target through an environment variable and is fully deterministic. This one works for targets that read
 * their endpoint from the environment and cannot be modified, at the cost of only being able to inject
 * faults that are expressible as an HTTP response.
 *
 * Safety properties, all deliberate:
 *  - binds to loopback only;
 *  - refuses to start unless the upstream is explicitly provided, so it can never become an open proxy;
 *  - refuses a non loopback upstream unless outbound network access was granted;
 *  - decides each injection from the seed and a request key rather than from a random source, so a run is
 *    reproducible and the seed is recorded with the evidence.
 */

export type FaultProxyOptions = {
  readonly plan: FaultPlan;
  /** Absolute upstream base URL. Requests are forwarded here when no fault applies. */
  readonly upstreamBaseUrl: string;
  readonly allowOutboundNetwork: boolean;
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly maxRequestBytes: number;
};

export type AppliedFault = {
  readonly kind: FaultKind;
  readonly target: string;
  readonly path: string;
};

export type FaultProxyHandle = {
  readonly url: string;
  readonly applied: () => readonly AppliedFault[];
  readonly forwardedCount: () => number;
  readonly close: () => Promise<void>;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const isLoopback = (url: URL): boolean => LOOPBACK_HOSTS.has(url.hostname);

/** Faults this proxy can express as an HTTP response. Everything else is cooperative only. */
const PROXY_FAULTS: ReadonlySet<FaultKind> = new Set<FaultKind>([
  'model_timeout',
  'model_rate_limited',
  'model_server_error',
  'model_malformed_structured_output',
  'model_stream_interrupted',
  'auth_expired',
  'duplicate_response',
]);

export const proxyCapableFaults = (plan: FaultPlan): readonly FaultSpec[] =>
  plan.faults.filter((fault) => fault.delivery === 'proxy' && PROXY_FAULTS.has(fault.kind));

const matchesTarget = (fault: FaultSpec, path: string): boolean =>
  fault.target === '*' || path.includes(fault.target);

const injectResponse = (
  response: ServerResponse,
  fault: FaultSpec,
): void => {
  switch (fault.kind) {
    case 'model_rate_limited':
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      response.end(JSON.stringify({ error: { type: 'rate_limit_error', message: 'injected by orchescope' } }));
      return;
    case 'model_server_error':
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { type: 'api_error', message: 'injected by orchescope' } }));
      return;
    case 'auth_expired':
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: { type: 'authentication_error', message: 'injected by orchescope' } }),
      );
      return;
    case 'model_malformed_structured_output':
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"choices":[{"message":{"content":"{\\"unclosed\\": tru');
      return;
    case 'model_stream_interrupted':
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
      response.destroy();
      return;
    case 'duplicate_response':
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ orchescopeInjected: 'duplicate', duplicate: true }));
      return;
    default:
      response.writeHead(504, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { type: 'timeout_error', message: 'injected by orchescope' } }));
  }
};

export const startFaultProxy = async (options: FaultProxyOptions): Promise<FaultProxyHandle> => {
  let upstream: URL;
  try {
    upstream = new URL(options.upstreamBaseUrl);
  } catch (error) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'The fault proxy needs an absolute upstream URL.', {
      cause: error,
    });
  }
  if (!isLoopback(upstream) && !options.allowOutboundNetwork) {
    throw new OrchescopeError(
      'POLICY_DENIED',
      `Forwarding to ${upstream.host} requires outbound network access to be granted.`,
      {
        remediation: 'Set policy.allowOutboundNetwork to true only if you intend to send live traffic.',
      },
    );
  }

  const applied: AppliedFault[] = [];
  const counts = new Map<FaultKind, number>();
  let forwarded = 0;
  let sequence = 0;

  const faults = proxyCapableFaults(options.plan);

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = request.url ?? '/';
    sequence += 1;
    const key = `${path}#${sequence}`;

    for (const fault of faults) {
      if (!matchesTarget(fault, path)) continue;
      const limit = fault.maxApplications;
      const used = counts.get(fault.kind) ?? 0;
      if (limit !== undefined && used >= limit) continue;
      if (fault.attempts !== undefined && fault.attempts.length > 0 && !fault.attempts.includes(sequence)) {
        continue;
      }
      if (!decideByKey(options.plan.seed, `${fault.kind}:${key}`, fault.probability)) continue;
      counts.set(fault.kind, used + 1);
      applied.push({ kind: fault.kind, target: fault.target, path });
      if (fault.delayMs !== undefined && fault.delayMs > 0) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, fault.delayMs);
          timer.unref();
        });
      }
      if (fault.kind === 'model_timeout') {
        // A timeout is expressed by never answering. The client's own deadline ends the request.
        request.socket.pause();
        return;
      }
      injectResponse(response, fault);
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of request) {
      const buffer = chunk as Buffer;
      total += buffer.length;
      if (total > options.maxRequestBytes) {
        response.writeHead(413, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'request body too large' }));
        return;
      }
      chunks.push(buffer);
    }

    const targetUrl = new URL(path.replace(/^\//, ''), `${upstream.origin}${upstream.pathname}`);
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string' && name !== 'host' && name !== 'connection') headers[name] = value;
    }
    const upstreamResponse = await fetch(targetUrl, {
      method: request.method ?? 'POST',
      headers,
      ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks) }),
    });
    forwarded += 1;
    const body = Buffer.from(await upstreamResponse.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    upstreamResponse.headers.forEach((value, name) => {
      if (name !== 'content-encoding' && name !== 'transfer-encoding') responseHeaders[name] = value;
    });
    responseHeaders['content-length'] = String(body.length);
    response.writeHead(upstreamResponse.status, responseHeaders);
    response.end(body);
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'proxy failure' }));
      } else {
        response.end();
      }
    });
  });

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
    throw new OrchescopeError('NETWORK_REFUSED', 'The fault proxy did not bind to a port.');
  }

  return {
    url: `http://${options.host}:${address.port}`,
    applied: () => applied,
    forwardedCount: () => forwarded,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
        server.closeIdleConnections();
      }),
  };
};
