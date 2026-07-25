import { cancelledError, OrchescopeError, timeoutError } from './errors.ts';

/**
 * Deadlines and cancellation.
 *
 * Every long running operation in Orchescope takes a `Deadline`. It carries both the remaining time
 * and the cancellation signal, so a caller cannot accidentally pass one without the other, and a
 * cancelled operation stops rather than finishing quietly in the background.
 */

export type Deadline = {
  readonly signal: AbortSignal;
  /** Milliseconds left, or undefined when the operation is only cancellable and not time bounded. */
  readonly remainingMs: () => number | undefined;
  readonly expired: () => boolean;
  /** Raises the correct error when the deadline passed or the signal aborted. */
  readonly check: (what: string) => void;
};

export type DeadlineHandle = Deadline & { readonly dispose: () => void };

export const deadlineFrom = (
  signal: AbortSignal,
  timeoutMs: number | undefined,
  monotonicMs: () => number,
): Deadline => {
  const startedAt = monotonicMs();
  const remainingMs = () =>
    timeoutMs === undefined ? undefined : timeoutMs - (monotonicMs() - startedAt);
  const expired = () => {
    const remaining = remainingMs();
    return remaining !== undefined && remaining <= 0;
  };
  return {
    signal,
    remainingMs,
    expired,
    check: (what: string) => {
      if (signal.aborted) throw cancelledError(what);
      if (expired() && timeoutMs !== undefined) throw timeoutError(what, timeoutMs);
    },
  };
};

/**
 * Creates a deadline backed by a timer, linked to an optional parent signal. The handle must be
 * disposed so the timer cannot keep the process alive.
 */
export const createDeadline = (
  timeoutMs: number | undefined,
  monotonicMs: () => number,
  parent?: AbortSignal,
): DeadlineHandle => {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent !== undefined) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(timeoutError('operation', timeoutMs)), timeoutMs);
  timer?.unref?.();
  const deadline = deadlineFrom(controller.signal, timeoutMs, monotonicMs);
  return {
    ...deadline,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      if (parent !== undefined) parent.removeEventListener('abort', onParentAbort);
    },
  };
};

/** Never expiring deadline, for operations that are only cancellable. */
export const unboundedDeadline = (signal: AbortSignal, monotonicMs: () => number): Deadline =>
  deadlineFrom(signal, undefined, monotonicMs);

/**
 * Races a promise against a deadline. The underlying work is not killed by this helper: callers that
 * own a resource must also react to the signal, which is why the signal travels with the deadline.
 */
export const withDeadline = async <T>(
  deadline: Deadline,
  what: string,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  deadline.check(what);
  const remaining = deadline.remainingMs();
  if (remaining === undefined) return work(deadline.signal);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(deadline.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(what, remaining)), Math.max(0, remaining));
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const isCancellation = (error: unknown): boolean =>
  error instanceof OrchescopeError && error.code === 'CANCELLED';
