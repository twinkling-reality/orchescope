import { createDeadline, type Deadline, runId as makeRunId } from '@orchescope/domain';
import { assertAllowed, commandDecision } from '@orchescope/policy';
import { runTracedSession, type TraceSessionResult } from '@orchescope/runtime';
import type { RunEnvironment, RunRecord, Timestamp } from '@orchescope/schema';
import { deriveTopology } from '@orchescope/traces';
import type { Workspace } from '@orchescope/workspace';
import { currentEnvironment } from './environment.ts';

/**
 * The trace use case: run a command the user typed, collect its spans, store them as a run.
 *
 * The command comes from the command line, so argv[0] is added to the allowed command set for this invocation
 * only. A command that arrives from a scenario file gets no such treatment, because a committed file is not the
 * same thing as a person typing an instruction.
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
    };
  } finally {
    handle?.dispose();
  }
};
