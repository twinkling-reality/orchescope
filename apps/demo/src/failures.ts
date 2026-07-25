/**
 * Failure vocabulary and the two timing helpers the rest of the system uses.
 *
 * Every call that leaves an agent, a model call or a tool call, runs under an explicit deadline. The
 * deadline is short because the scripted provider and the in process tools answer immediately: a fault is
 * the only thing that makes them slow, and a short deadline keeps a faulted run fast without changing which
 * code path runs.
 */

export type FailureKind = 'timed_out' | 'failed' | 'rate_limited' | 'unavailable' | 'malformed';

export class DemoFailure extends Error {
  readonly kind: FailureKind;

  constructor(kind: FailureKind, message: string) {
    super(message);
    this.name = 'DemoFailure';
    this.kind = kind;
  }
}

/** An injected delay is capped so that a fault plan cannot stall an offline run. */
export const MAX_INJECTED_DELAY_MS = 250;

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });

export const sleepBounded = (milliseconds: number): Promise<void> =>
  sleep(Math.min(milliseconds, MAX_INJECTED_DELAY_MS));

export const withDeadline = async <T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DemoFailure('timed_out', message)), timeoutMs);
  });
  // The losing work promise stays pending. Its rejection is absorbed here so that a call which exceeded
  // its deadline and then failed cannot surface as an unhandled rejection.
  void work.catch(() => undefined);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
