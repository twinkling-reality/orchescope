import { formatCount, runId as makeRunId, OrchescopeError } from '@orchescope/domain';
import { startReceiver } from '@orchescope/runtime';
import type { RunRecord } from '@orchescope/schema';
import { deriveTopology } from '@orchescope/traces';
import type { Workspace } from '@orchescope/workspace';
import { currentEnvironment } from './environment.ts';
import type { TraceResult } from './trace.ts';

/**
 * Collecting spans from a system Orchescope did not start.
 *
 * `trace` wraps a command, which works for anything that runs to completion and not for anything that is already
 * running: a development server, a worker, a deployment on another machine. Those are the systems most worth
 * reconciling, and until now the only way to get their spans in was to export them to a file first.
 *
 * The design is to receive rather than to fetch. There is no query interface to a collector: OTLP is a push protocol,
 * and every backend that stores spans has its own API, so fetching would mean choosing a vendor and calling it the
 * integration. Standing the same receiver `trace` uses up for a window instead means a system already running exports
 * to Orchescope the way it exports anywhere else, and nothing here knows or cares what produced the spans.
 *
 * The receiver stays bound to loopback. A process on another machine reaches it through a tunnel the operator opens
 * deliberately, which is a decision for them to make rather than a default that quietly listens on a network.
 */

export type ReceiveRequest = {
  readonly workspace: Workspace;
  readonly orchescopeVersion: string;
  readonly label?: string;
  /** How long to listen. The window is bounded because an unbounded one is a daemon, and this is not one. */
  readonly durationMs: number;
  /** Called once the receiver is listening, with the endpoint a caller should export to. */
  readonly onListening?: (endpoint: { readonly url: string; readonly variables: string }) => void;
  /** Called as spans arrive, so a terminal can show that something is happening. */
  readonly onProgress?: (received: { readonly spans: number; readonly requests: number }) => void;
  /** Resolves when the operator asks to stop early. */
  readonly until?: Promise<void>;
};

const PROGRESS_INTERVAL_MS = 1_000;

/** The window a caller asked for, bounded by what policy allows a single run to take. */
const windowOf = (request: ReceiveRequest): number => {
  const ceiling = request.workspace.config.policy.maxRunDurationMs;
  if (request.durationMs <= 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'A receive window has to be a positive duration.',
      {
        remediation: 'Pass --for with a duration, for example --for 10m.',
      },
    );
  }
  return Math.min(request.durationMs, ceiling);
};

export const receiveTraces = async (request: ReceiveRequest): Promise<TraceResult> => {
  const { workspace } = request;
  const runtime = workspace.config.runtime;
  const durationMs = windowOf(request);
  const startedAt = workspace.clock.now();
  const label = request.label ?? `received over ${Math.round(durationMs / 1000)}s`;
  const runId = makeRunId({
    projectId: workspace.projectId,
    kind: 'trace',
    label,
    startedAt,
    sequence: workspace.store.listRuns({ projectId: workspace.projectId, limit: 1000 }).length,
  });

  const receiver = await startReceiver({
    host: runtime.receiverHost,
    port: runtime.receiverPort,
    runId,
    now: () => workspace.clock.now(),
    maxSpansPerRun: runtime.maxSpansPerRun,
    maxRequestBytes: runtime.maxRequestBytes,
    maxSpanAttributeBytes: runtime.maxSpanAttributeBytes,
  });

  const phase = workspace.progress.phase('ingest', `Receiving spans on ${receiver.url}`);
  request.onListening?.({
    url: receiver.url,
    variables: `OTEL_EXPORTER_OTLP_ENDPOINT=${receiver.url} OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`,
  });

  let ticker: NodeJS.Timeout | undefined;
  try {
    if (request.onProgress !== undefined) {
      ticker = setInterval(() => {
        request.onProgress?.({
          spans: receiver.collected().spans.length,
          requests: receiver.requestCount(),
        });
      }, PROGRESS_INTERVAL_MS);
      ticker.unref();
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, durationMs);
        timer.unref();
      }),
      ...(request.until === undefined ? [] : [request.until]),
    ]);
  } finally {
    if (ticker !== undefined) clearInterval(ticker);
  }

  const bundle = receiver.collected();
  await receiver.close();

  const derived = deriveTopology(bundle);
  const environment = currentEnvironment(request.orchescopeVersion);
  const run: RunRecord = {
    id: runId,
    kind: 'trace',
    label,
    // A window that ends is a window that completed. Whether anything exported to it is a separate question, and the
    // span count is where that is answered.
    status: 'completed',
    startedAt,
    finishedAt: workspace.clock.now(),
    environment,
    metrics: derived.runMetrics,
    componentMetrics: [],
    ...(workspace.git === undefined ? {} : { git: workspace.git }),
    metadata: {
      receiverUrl: receiver.url,
      spanCount: bundle.spans.length,
      requests: receiver.requestCount(),
      windowMs: durationMs,
      collectedBy: 'receive',
    },
  };

  workspace.store.saveRun({
    run,
    projectId: workspace.projectId,
    bundle,
    sideEffects: bundle.sideEffects,
  });
  workspace.store.saveEvidence(derived.evidence);
  phase.finish(
    `${formatCount(bundle.spans.length, 'span')} from ${formatCount(bundle.services.length, 'service')}, run ${runId}`,
  );

  return {
    run,
    spanCount: bundle.spans.length,
    serviceNames: bundle.services,
    exitCode: undefined,
    receiverUrl: receiver.url,
    targetResultProblem: undefined,
    environment,
    /*
     * None. Nothing was started here, so nothing had its environment set: the variables are the operator's to set on
     * the process they already have running, which is what the command prints when it starts listening.
     */
    otlpVariables: [],
  };
};
