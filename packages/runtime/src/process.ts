import { spawn } from 'node:child_process';
import { type Deadline, OrchescopeError } from '@orchescope/domain';

/**
 * Supervised process execution.
 *
 * Every rule here exists because of a specific failure mode:
 *
 *  - no shell, ever. The argv is passed directly, so a repository path or a scenario field containing
 *    shell metacharacters cannot become a command.
 *  - the argv is checked against an allow list before spawning, so a scenario file cannot run an
 *    arbitrary binary just because it was committed to the repository.
 *  - an error listener is attached before the signal is used. A `spawn` call that receives an abort
 *    signal emits an `error` event, and an unhandled one crashes the parent process.
 *  - termination escalates: the stop signal first, then SIGKILL after a grace period, so a target that
 *    ignores SIGTERM cannot hold a run open forever.
 *  - output is captured with a byte ceiling. A target that prints without end degrades to truncated
 *    output rather than to an exhausted machine.
 */

export type ProcessRequest = {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly deadline: Deadline;
  readonly maxOutputBytes: number;
  readonly stopSignal: 'SIGINT' | 'SIGTERM';
  readonly killAfterMs: number;
  /** Commands the policy allows, matched against argv[0]. An empty list refuses every command. */
  readonly allowedCommands: readonly string[];
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
};

export type ProcessOutcome = {
  readonly exitCode: number | undefined;
  readonly signal: NodeJS.Signals | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputTruncated: boolean;
};

const basename = (value: string): string => value.split('/').pop() ?? value;

export const commandIsAllowed = (
  command: readonly string[],
  allowed: readonly string[],
): boolean => {
  const executable = command[0];
  if (executable === undefined) return false;
  const name = basename(executable);
  return allowed.some((entry) => entry === executable || entry === name);
};

export const runProcess = async (request: ProcessRequest): Promise<ProcessOutcome> => {
  const executable = request.command[0];
  if (executable === undefined) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'A process request needs at least one argument.');
  }
  if (!commandIsAllowed(request.command, request.allowedCommands)) {
    throw new OrchescopeError(
      'POLICY_DENIED',
      `Running "${executable}" is not permitted by the current policy.`,
      {
        detail: { executable, allowed: request.allowedCommands.join(', ') },
        remediation:
          'Add the executable to policy.allowedCommands in .orchescope/config.json if you intend to run it.',
      },
    );
  }
  request.deadline.check('process execution');

  const startedAt = Date.now();
  const controller = new AbortController();
  const child = spawn(executable, request.command.slice(1), {
    cwd: request.cwd,
    env: { ...request.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    signal: controller.signal,
    killSignal: request.stopSignal,
    shell: false,
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  let truncated = false;
  let timedOut = false;
  let cancelled = false;
  let spawnError: Error | undefined;

  // Attached before anything can abort: an aborted spawn emits `error`, and an unhandled `error` event
  // on a ChildProcess terminates the parent.
  child.on('error', (error) => {
    if ((error as { code?: string }).code !== 'ABORT_ERR') spawnError = error;
  });

  const append = (target: 'out' | 'err', chunk: string): void => {
    const current = target === 'out' ? stdout : stderr;
    if (current.length >= request.maxOutputBytes) {
      truncated = true;
      return;
    }
    const room = request.maxOutputBytes - current.length;
    const slice = chunk.length > room ? chunk.slice(0, room) : chunk;
    if (slice.length < chunk.length) truncated = true;
    if (target === 'out') stdout += slice;
    else stderr += slice;
  };

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    append('out', chunk);
    request.onStdout?.(chunk);
  });
  child.stderr?.on('data', (chunk: string) => {
    append('err', chunk);
    request.onStderr?.(chunk);
  });

  const onParentAbort = (): void => {
    cancelled = true;
    controller.abort();
  };
  request.deadline.signal.addEventListener('abort', onParentAbort, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, request.timeoutMs);
  timeout.unref();

  // Escalation: if the stop signal is ignored, send SIGKILL after the grace period.
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  controller.signal.addEventListener(
    'abort',
    () => {
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, request.killAfterMs);
      killTimer.unref();
    },
    { once: true },
  );

  const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );

  clearTimeout(timeout);
  if (killTimer !== undefined) clearTimeout(killTimer);
  request.deadline.signal.removeEventListener('abort', onParentAbort);

  if (spawnError !== undefined) {
    throw new OrchescopeError(
      'TARGET_FAILED',
      `The target could not be started: ${spawnError.message}`,
      {
        cause: spawnError,
        detail: { executable },
      },
    );
  }

  return {
    exitCode: outcome.code === null ? undefined : outcome.code,
    signal: outcome.signal === null ? undefined : outcome.signal,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    timedOut,
    cancelled,
    outputTruncated: truncated,
  };
};
