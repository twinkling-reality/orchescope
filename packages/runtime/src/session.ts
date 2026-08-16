import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Clock, Deadline } from '@orchescope/domain';
import type { FaultPlan, TargetResult, TraceBundle } from '@orchescope/schema';
import {
  formatIssues,
  TARGET_ENV,
  TargetResult as TargetResultSchema,
  validate,
} from '@orchescope/schema';
import { type ProcessOutcome, runProcess } from './process.ts';
import { type ReceiverHandle, startReceiver } from './receiver.ts';
import { locateShim, targetRunsNode, withShim } from './shim.ts';

/**
 * A traced run: start a loopback receiver, run the target with the environment that points it at that
 * receiver, wait a bounded moment for in flight exports, then stop.
 *
 * The drain period exists because span export is asynchronous. Without it, the last spans of a short
 * lived process are lost, and a report that silently loses the end of every trace is worse than one that
 * waits fifty milliseconds.
 */

export type TraceSessionRequest = {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly runId: string;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly serviceName: string;
  readonly clock: Clock;
  readonly deadline: Deadline;
  readonly timeoutMs: number;
  readonly drainMs: number;
  readonly maxSpansPerRun: number;
  readonly maxRequestBytes: number;
  readonly maxSpanAttributeBytes: number;
  readonly maxOutputBytes: number;
  readonly allowedCommands: readonly string[];
  readonly receiverHost: '127.0.0.1' | '::1';
  readonly receiverPort: number;
  readonly stopSignal: 'SIGINT' | 'SIGTERM';
  readonly killAfterMs: number;
  readonly faultPlan?: FaultPlan;
  /**
   * Whether to load Orchescope's own instrumentation into the target.
   *
   * Off is a real answer and has to stay one: this puts code inside a process the operator owns, and an
   * operator who does not want that must be able to say so and still get a receiver.
   */
  readonly autoInstrument: boolean;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
};

export type TraceSessionResult = {
  readonly bundle: TraceBundle;
  readonly process: ProcessOutcome;
  readonly receiverUrl: string;
  readonly targetResult: TargetResult | undefined;
  readonly targetResultProblem: string | undefined;
  /**
   * Whether Orchescope loaded its own instrumentation into the target, and if not, why not.
   *
   * A reader has to be able to tell why a run that produced nothing last week produces spans today, and a
   * reader whose target is not a Node process has to be told that the variable does nothing for it rather
   * than left to conclude their system is silent.
   */
  readonly instrumentation: InstrumentationOutcome;
};

export type InstrumentationOutcome =
  | { readonly injected: true; readonly shimPath: string }
  | {
      readonly injected: false;
      readonly reason: 'disabled' | 'not_a_node_target' | 'shim_missing';
    };

/**
 * Environment for the child. The standard OpenTelemetry variables are set so that an unmodified SDK
 * exports to the local receiver with no code change, and the Orchescope variables are set so that a target
 * with no tracing at all can still report a result.
 */
/**
 * The OpenTelemetry variables set for the target, named once so that a command line can tell a reader which
 * variables their exporter was expected to honour rather than restating a list that could drift.
 */
export const OTEL_EXPORT_VARIABLES = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_TRACES_EXPORTER',
] as const;

/**
 * Whether this run loads the shim, decided once so the environment and the report cannot disagree.
 *
 * The three ways it does not happen are kept apart because they are three different sentences for a reader.
 * Turned off is a choice. A target that is not a Node process is a boundary this cannot cross, and it is
 * the common case for Cloudflare Workers, Python and containers, which is a large share of real agent
 * systems. A missing shim is a defect in the build.
 */
const resolveInstrumentation = (request: TraceSessionRequest): InstrumentationOutcome => {
  if (!request.autoInstrument) return { injected: false, reason: 'disabled' };
  if (!targetRunsNode(request.command)) return { injected: false, reason: 'not_a_node_target' };
  const shimPath = locateShim(import.meta.url);
  if (shimPath === undefined) return { injected: false, reason: 'shim_missing' };
  return { injected: true, shimPath };
};

export const buildTargetEnv = (input: {
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly endpoint: string;
  readonly serviceName: string;
  readonly runId: string;
  readonly resultFile: string;
  readonly shimPath?: string;
  readonly faultPlan?: FaultPlan;
  readonly extraEnv?: Readonly<Record<string, string>>;
}): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.baseEnv)) {
    if (value !== undefined) env[key] = value;
  }
  env[OTEL_EXPORT_VARIABLES[0]] = input.endpoint;
  env[OTEL_EXPORT_VARIABLES[1]] = `${input.endpoint}/v1/traces`;
  env[OTEL_EXPORT_VARIABLES[2]] = 'otlp';
  env['OTEL_METRICS_EXPORTER'] = 'none';
  env['OTEL_LOGS_EXPORTER'] = 'none';
  env['OTEL_SERVICE_NAME'] = env['OTEL_SERVICE_NAME'] ?? input.serviceName;
  env['OTEL_BSP_SCHEDULE_DELAY'] = '200';
  env[TARGET_ENV.endpoint] = input.endpoint;
  env[TARGET_ENV.runId] = input.runId;
  env[TARGET_ENV.resultFile] = input.resultFile;
  if (input.shimPath !== undefined) {
    env['NODE_OPTIONS'] = withShim(env['NODE_OPTIONS'], input.shimPath);
  }
  if (input.faultPlan !== undefined) {
    env[TARGET_ENV.faultPlan] = JSON.stringify(input.faultPlan);
  }
  for (const [key, value] of Object.entries(input.extraEnv ?? {})) env[key] = value;
  return env;
};

const readTargetResult = (
  path: string,
): { readonly result?: TargetResult; readonly problem?: string } => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return {};
    return { problem: error instanceof Error ? error.message : 'result file could not be read' };
  }
  if (text.length > 2_000_000) {
    return { problem: `result file of ${text.length} bytes is larger than the two megabyte limit` };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    return { problem: error instanceof Error ? error.message : 'result file was not valid JSON' };
  }
  const validated = validate(TargetResultSchema, payload);
  if (!validated.ok) {
    return { problem: `result file did not match the protocol: ${formatIssues(validated.issues)}` };
  }
  return { result: validated.value };
};

export const runTracedSession = async (
  request: TraceSessionRequest,
): Promise<TraceSessionResult> => {
  const receiver: ReceiverHandle = await startReceiver({
    host: request.receiverHost,
    port: request.receiverPort,
    runId: request.runId,
    maxSpansPerRun: request.maxSpansPerRun,
    maxRequestBytes: request.maxRequestBytes,
    maxSpanAttributeBytes: request.maxSpanAttributeBytes,
    now: request.clock.now,
  });

  const resultDirectory = join(tmpdir(), `orchescope-${request.runId}`);
  mkdirSync(resultDirectory, { recursive: true, mode: 0o700 });
  const resultFile = join(resultDirectory, 'result.json');
  const instrumentation = resolveInstrumentation(request);

  try {
    const env = buildTargetEnv({
      baseEnv: request.baseEnv,
      endpoint: receiver.url,
      serviceName: request.serviceName,
      runId: request.runId,
      resultFile,
      ...(instrumentation.injected ? { shimPath: instrumentation.shimPath } : {}),
      ...(request.faultPlan === undefined ? {} : { faultPlan: request.faultPlan }),
      ...(request.extraEnv === undefined ? {} : { extraEnv: request.extraEnv }),
    });

    const outcome = await runProcess({
      command: request.command,
      cwd: request.cwd,
      env,
      timeoutMs: request.timeoutMs,
      deadline: request.deadline,
      maxOutputBytes: request.maxOutputBytes,
      stopSignal: request.stopSignal,
      killAfterMs: request.killAfterMs,
      allowedCommands: request.allowedCommands,
      ...(request.onStdout === undefined ? {} : { onStdout: request.onStdout }),
      ...(request.onStderr === undefined ? {} : { onStderr: request.onStderr }),
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, request.drainMs);
      timer.unref();
    });

    const target = readTargetResult(resultFile);
    return {
      bundle: receiver.collected(),
      process: outcome,
      receiverUrl: receiver.url,
      targetResult: target.result,
      targetResultProblem: target.problem,
      instrumentation,
    };
  } finally {
    await receiver.close();
    rmSync(resultDirectory, { recursive: true, force: true });
  }
};
