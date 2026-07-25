import type { QueueSlot, RefundQueue } from './context.ts';
import { DemoFailure, sleepBounded } from './failures.ts';
import type { FaultDecision, FaultEngine } from './faults.ts';
import { indexOf } from './random.ts';

/**
 * The refund queue and its worker pool.
 *
 * Pending refunds are not executed inline: they are queued and drained by a pool whose size is
 * `ORCHESCOPE_WORKERS`, which is what makes the pool observable as a bottleneck when several requests run
 * concurrently. The queue is bounded, so a run cannot grow it without limit.
 *
 * The reported wait is derived from the seed rather than measured, because a measured wait would make two
 * runs of the same seed differ. An injected `queue_delay` is also slept for real, capped, so the delay shows
 * up in the run as well as in the attribute.
 */

export const QUEUE_NAME = 'refunds';
const MAX_PENDING_JOBS = 64;
const BASE_WAIT_MS = 6;
const WAIT_SPREAD_MS = 9;

type QueueJob = {
  readonly key: string;
  readonly execute: (workerName: string) => Promise<void>;
};

type PendingQueue = {
  readonly name: string;
  readonly depth: () => number;
  readonly push: (job: QueueJob) => void;
  readonly next: () => Promise<QueueJob | undefined>;
  readonly close: () => void;
};

const Queue = (name: string, options: { readonly capacity: number }): PendingQueue => {
  const jobs: QueueJob[] = [];
  const waiters: ((job: QueueJob | undefined) => void)[] = [];
  let closed = false;

  return {
    name,
    depth: () => jobs.length,
    push: (job) => {
      if (closed) throw new DemoFailure('unavailable', `the ${name} queue is closed`);
      if (jobs.length >= options.capacity) {
        throw new DemoFailure('unavailable', `the ${name} queue is full`);
      }
      const waiter = waiters.shift();
      if (waiter === undefined) jobs.push(job);
      else waiter(job);
    },
    next: async () => {
      const ready = jobs.shift();
      if (ready !== undefined) return ready;
      if (closed) return undefined;
      return await new Promise<QueueJob | undefined>((resolve) => {
        waiters.push(resolve);
      });
    },
    close: () => {
      closed = true;
      for (const waiter of waiters.splice(0)) waiter(undefined);
    },
  };
};

const Worker = async (
  queue: PendingQueue,
  options: { readonly concurrency: number },
): Promise<void> => {
  const loop = async (slot: number): Promise<void> => {
    for (;;) {
      const job = await queue.next();
      if (job === undefined) return;
      await job.execute(`${queue.name}-worker-${slot + 1}`);
    }
  };
  await Promise.all(Array.from({ length: options.concurrency }, (_unused, slot) => loop(slot)));
};

const slotFor = (
  workerName: string,
  waitMs: number,
  delay: FaultDecision | undefined,
): QueueSlot => ({
  workerName,
  waitMs,
  ...(delay === undefined ? {} : { injectedFault: delay.kind }),
});

const asError = (error: unknown, message: string): Error =>
  error instanceof Error ? error : new DemoFailure('failed', message);

export type RefundQueueHandle = {
  readonly queue: RefundQueue;
  readonly close: () => Promise<void>;
};

export const createRefundQueue = (options: {
  readonly workers: number;
  readonly seed: number;
  readonly faults: FaultEngine;
}): RefundQueueHandle => {
  const pending = Queue(QUEUE_NAME, { capacity: MAX_PENDING_JOBS });
  const pool = Worker(pending, { concurrency: options.workers });

  const submit = <T>(key: string, job: (slot: QueueSlot) => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const delay = options.faults.decide('queue_delay', QUEUE_NAME, 1);
      const waitMs =
        BASE_WAIT_MS +
        indexOf(WAIT_SPREAD_MS, options.seed, key) +
        pending.depth() * BASE_WAIT_MS +
        (delay?.delayMs ?? 0);
      const execute = async (workerName: string): Promise<void> => {
        if (delay !== undefined) await sleepBounded(delay.delayMs);
        try {
          resolve(await job(slotFor(workerName, waitMs, delay)));
        } catch (error) {
          reject(asError(error, 'the refund job failed'));
        }
      };
      try {
        pending.push({ key, execute });
      } catch (error) {
        reject(asError(error, 'the queue refused the job'));
      }
    });

  return {
    queue: { submit },
    close: async () => {
      pending.close();
      await pool;
    },
  };
};
