import type { Deadline } from './deadline.ts';

/**
 * Bounded parallelism.
 *
 * Analysis fans out over files and runs, and unbounded fan out is how a tool starves the machine it
 * is trying to measure. Every parallel section in Orchescope goes through here with an explicit limit
 * and an explicit deadline.
 */

export type ParallelOptions = {
  readonly concurrency: number;
  readonly deadline: Deadline;
  readonly what: string;
};

export const mapWithConcurrency = async <TIn, TOut>(
  items: readonly TIn[],
  options: ParallelOptions,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> => {
  const limit = Math.max(1, Math.floor(options.concurrency));
  const results = new Array<TOut>(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      options.deadline.check(options.what);
      const item = items[index] as TIn;
      results[index] = await worker(item, index);
    }
  };

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
};

/**
 * Like `mapWithConcurrency` but a failing item does not abort the batch. Used where one unparseable
 * file must not end a repository scan, and the failures are reported as coverage gaps.
 */
export const settleWithConcurrency = async <TIn, TOut>(
  items: readonly TIn[],
  options: ParallelOptions,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<
  Array<{ item: TIn; index: number } & ({ ok: true; value: TOut } | { ok: false; error: unknown })>
> =>
  mapWithConcurrency(items, options, async (item, index) => {
    try {
      return { item, index, ok: true as const, value: await worker(item, index) };
    } catch (error) {
      return { item, index, ok: false as const, error };
    }
  });
