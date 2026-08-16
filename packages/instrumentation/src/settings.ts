/**
 * Whether this process should be instrumented at all, decided before anything is patched.
 *
 * The shim arrives through `NODE_OPTIONS`, and `NODE_OPTIONS` is inherited by every process the target
 * spawns and by every process those spawn in turn. That is the property that lets it reach a worker the
 * target starts, and it is also the property that would put Orchescope inside a package manager, a
 * language server or a git hook that happened to run underneath. So activation is decided here, from the
 * variables one traced run sets, and a process that was not the subject of a run does nothing at all.
 *
 * The endpoint is required to be loopback. A shim that would post spans to any address it was handed is a
 * way to make an unrelated process talk to a host of someone else's choosing, and nothing about tracing
 * needs that.
 */

export type InstrumentationSettings = {
  readonly endpoint: string;
  readonly runId: string;
  readonly serviceName: string;
  readonly maxSpans: number;
};

/** Beyond this a run has stopped being evidence and started being a memory leak in someone else's process. */
const DEFAULT_MAX_SPANS = 10_000;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const isLoopback = (endpoint: string): boolean => {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

const positiveInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const readSettings = (
  environment: Readonly<Record<string, string | undefined>>,
): InstrumentationSettings | undefined => {
  const endpoint = environment['ORCHESCOPE_OTLP_ENDPOINT']?.replace(/\/+$/, '');
  const runId = environment['ORCHESCOPE_RUN_ID'];
  if (endpoint === undefined || endpoint.length === 0) return undefined;
  if (runId === undefined || runId.length === 0) return undefined;
  if (!isLoopback(endpoint)) return undefined;
  return {
    endpoint,
    runId,
    serviceName: environment['OTEL_SERVICE_NAME'] ?? 'orchescope-target',
    maxSpans: positiveInteger(environment['ORCHESCOPE_MAX_SPANS'], DEFAULT_MAX_SPANS),
  };
};
