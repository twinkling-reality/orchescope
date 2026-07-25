import { readFileSync } from 'node:fs';
import {
  createDeadline,
  type Deadline,
  runId as makeRunId,
  OrchescopeError,
} from '@orchescope/domain';
import { assertAllowed, commandDecision } from '@orchescope/policy';
import {
  OTEL_EXPORT_VARIABLES,
  runTracedSession,
  type TraceSessionResult,
} from '@orchescope/runtime';
import type { RunEnvironment, RunRecord, Timestamp } from '@orchescope/schema';
import {
  type DecodedTraceRequest,
  decodeTraceJson,
  deriveTopology,
  normalizeTraces,
} from '@orchescope/traces';
import { resolveInsideRoot, type Workspace } from '@orchescope/workspace';
import { currentEnvironment } from './environment.ts';

/**
 * The trace use cases: run a command and collect its spans, or import spans a run produced elsewhere.
 *
 * The command is checked against the configured allow list rather than added to it. That list is what bounds what
 * Orchescope will execute, and a list that grows to include whatever it was asked to run would bound nothing.
 */

export type TraceRequest = {
  readonly workspace: Workspace;
  readonly command: readonly string[];
  readonly label?: string;
  readonly orchescopeVersion: string;
  readonly deadline?: Deadline;
  readonly timeoutMs?: number;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
};

export type TraceResult = {
  readonly run: RunRecord;
  readonly spanCount: number;
  readonly serviceNames: readonly string[];
  readonly exitCode: number | undefined;
  readonly receiverUrl: string;
  readonly targetResultProblem: string | undefined;
  readonly environment: RunEnvironment;
  /**
   * The OpenTelemetry variables that were set for the target. Reported so that a run which collected nothing can
   * name what the exporter was expected to honour, rather than leaving the reader to guess.
   */
  readonly otlpVariables: readonly string[];
};

/**
 * The stored record for one traced run.
 *
 * The target's own result file can report task success, interventions and policy violations, and those override what the
 * spans implied: the target knows whether its task succeeded, the trace only knows what it was told.
 */
const traceRunRecord = (input: {
  readonly runId: string;
  readonly label: string;
  readonly status: RunRecord['status'];
  readonly startedAt: Timestamp;
  readonly finishedAt: Timestamp;
  readonly environment: RunEnvironment;
  readonly metrics: RunRecord['metrics'];
  readonly session: TraceSessionResult;
  readonly command: readonly string[];
  readonly git?: RunRecord['git'];
}): RunRecord => {
  const { session, status } = input;
  const result = session.targetResult;
  return {
    id: input.runId,
    kind: 'trace',
    label: input.label,
    status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    environment: input.environment,
    metrics: {
      ...input.metrics,
      ...(result?.success === undefined ? {} : { taskSuccess: result.success }),
      ...(result?.userInterventions === undefined
        ? {}
        : { userInterventions: result.userInterventions }),
      ...(result?.policyViolations === undefined
        ? {}
        : { policyViolations: result.policyViolations }),
    },
    componentMetrics: [],
    ...(session.process.exitCode === undefined ? {} : { exitCode: session.process.exitCode }),
    ...(status === 'completed'
      ? {}
      : {
          failureReason:
            session.process.timedOut === true
              ? 'the target exceeded its deadline'
              : `the target exited with code ${session.process.exitCode ?? 'unknown'}`,
        }),
    ...(input.git === undefined ? {} : { git: input.git }),
    metadata: {
      command: input.command.join(' '),
      receiverUrl: session.receiverUrl,
      spanCount: session.bundle.spans.length,
      ...(session.targetResultProblem === undefined
        ? {}
        : { targetResultProblem: session.targetResultProblem }),
    },
  };
};

export const runTrace = async (request: TraceRequest): Promise<TraceResult> => {
  const { workspace } = request;
  const policy = workspace.config.policy;
  assertAllowed(
    policy.allowProcessSpawn
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'tracing runs a command',
          settingToChange: 'policy.allowProcessSpawn',
        },
    'Tracing',
  );

  // The allow list is what bounds what Orchescope will execute, so the requested command is checked against it rather
  // than added to it.
  const allowedCommands = policy.allowedCommands;
  assertAllowed(commandDecision(policy, request.command), 'Tracing');

  const handle =
    request.deadline === undefined
      ? createDeadline(request.timeoutMs ?? policy.maxRunDurationMs, workspace.clock.monotonicMs)
      : undefined;
  const deadline = request.deadline ?? (handle as Deadline);

  const startedAt = workspace.clock.now();
  const label = request.label ?? request.command.join(' ').slice(0, 120);
  const runId = makeRunId({
    projectId: workspace.projectId,
    kind: 'trace',
    label,
    startedAt,
    sequence: workspace.store.listRuns({ projectId: workspace.projectId, limit: 1000 }).length,
  });

  const phase = workspace.progress.phase('ingest', `Running ${label}`);
  try {
    const session = await runTracedSession({
      command: request.command,
      cwd: workspace.paths.root,
      runId,
      baseEnv: process.env,
      serviceName: workspace.projectName,
      clock: workspace.clock,
      deadline,
      timeoutMs: request.timeoutMs ?? policy.maxRunDurationMs,
      drainMs: workspace.config.runtime.exportDrainMs,
      maxSpansPerRun: workspace.config.runtime.maxSpansPerRun,
      maxRequestBytes: workspace.config.runtime.maxRequestBytes,
      maxSpanAttributeBytes: workspace.config.runtime.maxSpanAttributeBytes,
      maxOutputBytes: 256 * 1024,
      allowedCommands,
      receiverHost: workspace.config.runtime.receiverHost,
      receiverPort: workspace.config.runtime.receiverPort,
      stopSignal: 'SIGTERM',
      killAfterMs: 5_000,
      ...(request.onStdout === undefined ? {} : { onStdout: request.onStdout }),
      ...(request.onStderr === undefined ? {} : { onStderr: request.onStderr }),
    });

    const derived = deriveTopology(session.bundle);
    const environment = currentEnvironment(request.orchescopeVersion);
    const status =
      session.process.cancelled === true
        ? 'cancelled'
        : session.process.timedOut
          ? 'timeout'
          : session.process.exitCode === 0
            ? 'completed'
            : 'failed';

    const run = traceRunRecord({
      runId,
      label,
      status,
      startedAt,
      finishedAt: workspace.clock.now(),
      environment,
      metrics: derived.runMetrics,
      session,
      command: request.command,
      ...(workspace.git === undefined ? {} : { git: workspace.git }),
    });

    workspace.store.saveRun({
      run,
      projectId: workspace.projectId,
      bundle: session.bundle,
      sideEffects: session.bundle.sideEffects,
    });
    workspace.store.saveEvidence(derived.evidence);
    phase.finish(
      `${session.bundle.spans.length} span(s) from ${session.bundle.services.length} service(s), run ${runId}`,
    );

    return {
      run,
      spanCount: session.bundle.spans.length,
      serviceNames: session.bundle.services,
      exitCode: session.process.exitCode,
      receiverUrl: session.receiverUrl,
      targetResultProblem: session.targetResultProblem,
      environment,
      otlpVariables: [...OTEL_EXPORT_VARIABLES],
    };
  } finally {
    handle?.dispose();
  }
};

export type ImportTraceRequest = {
  readonly workspace: Workspace;
  readonly file: string;
  readonly label?: string;
  readonly orchescopeVersion: string;
};

/**
 * Reads spans a run produced elsewhere.
 *
 * Two shapes are accepted, because both are what exporters and collectors write: one OTLP JSON document, or one JSON value
 * per line. A line may be a whole OTLP request or a single span; a span alone is wrapped in a synthetic resource so the rest
 * of the pipeline sees the same structure either way. A file that yields no span is refused rather than stored as an empty
 * run, because an empty run would reconcile as though nothing ran.
 */
export const importTrace = (request: ImportTraceRequest): TraceResult => {
  const { workspace } = request;
  const resolved = resolveInsideRoot(workspace.paths, request.file);
  const text = readFileSync(resolved, 'utf8');
  const ndjson = request.file.endsWith('.ndjson') || request.file.endsWith('.jsonl');

  const decoded = ndjson ? decodeNdjson(text, request.file) : decodeOne(text, request.file);
  const startedAt = workspace.clock.now();
  const label = request.label ?? request.file;
  const runId = makeRunId({
    projectId: workspace.projectId,
    kind: 'trace',
    label,
    startedAt,
    sequence: workspace.store.listRuns({ projectId: workspace.projectId, limit: 1000 }).length,
  });

  const normalized = normalizeTraces(decoded, {
    runId,
    capturedAt: startedAt,
    source: ndjson ? 'imported_ndjson' : 'imported_otlp_json',
    maxSpans: workspace.config.runtime.maxSpansPerRun,
    maxAttributeBytes: workspace.config.runtime.maxSpanAttributeBytes,
  });
  if (normalized.bundle.spans.length === 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `${request.file} contained no span this build can read.`,
      {
        detail: { rejected: normalized.bundle.rejected.map((entry) => entry.reason).join('; ') },
        remediation:
          'Check that the file is OTLP JSON or newline delimited spans, and that identifiers are hex or base64.',
      },
    );
  }

  const derived = deriveTopology(normalized.bundle);
  const environment = currentEnvironment(request.orchescopeVersion);
  const run: RunRecord = {
    id: runId,
    kind: 'trace',
    label,
    status: 'completed',
    startedAt,
    finishedAt: workspace.clock.now(),
    environment,
    metrics: derived.runMetrics,
    componentMetrics: [],
    ...(workspace.git === undefined ? {} : { git: workspace.git }),
    metadata: {
      importedFrom: request.file,
      spanCount: normalized.bundle.spans.length,
      rejected: normalized.bundle.rejected.length,
    },
  };

  workspace.store.saveRun({
    run,
    projectId: workspace.projectId,
    bundle: normalized.bundle,
    sideEffects: normalized.bundle.sideEffects,
  });
  workspace.store.saveEvidence(derived.evidence);

  return {
    run,
    spanCount: normalized.bundle.spans.length,
    serviceNames: normalized.bundle.services,
    exitCode: undefined,
    receiverUrl: 'imported',
    targetResultProblem: undefined,
    environment,
    // An import sets no environment for anything: the spans already existed.
    otlpVariables: [],
  };
};

const decodeOne = (text: string, file: string): DecodedTraceRequest => {
  try {
    return decodeTraceJson(JSON.parse(text) as unknown);
  } catch (error) {
    throw new OrchescopeError('PARSE_FAILED', `${file} is not valid JSON.`, { cause: error });
  }
};

const decodeNdjson = (text: string, file: string): DecodedTraceRequest => {
  const resourceSpans: DecodedTraceRequest['resourceSpans'][number][] = [];
  const rejected: { reason: string; count: number }[] = [];
  let malformed = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      malformed += 1;
      continue;
    }
    const record =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    const wrapped =
      record['resourceSpans'] === undefined
        ? { resourceSpans: [{ scopeSpans: [{ spans: [record] }] }] }
        : record;
    const decoded = decodeTraceJson(wrapped);
    resourceSpans.push(...decoded.resourceSpans);
    rejected.push(...decoded.rejected);
  }

  if (malformed > 0)
    rejected.push({ reason: `${file} had lines that were not JSON`, count: malformed });
  return { resourceSpans, rejected };
};
