import type { Timestamp } from '@orchescope/schema';

/**
 * Time as a port. Nothing in Orchescope reads the wall clock directly, so tests control time and
 * generated documents are reproducible.
 */
export type Clock = {
  /** Wall clock instant, formatted as the canonical Orchescope timestamp. */
  readonly now: () => Timestamp;
  /** Monotonic milliseconds, for measuring durations across suspend and clock adjustment. */
  readonly monotonicMs: () => number;
};

/** `Date.prototype.toISOString` already emits millisecond precision UTC, which is the canonical form. */
export const formatTimestamp = (epochMs: number): Timestamp =>
  new Date(epochMs).toISOString() as Timestamp;

/** A clock that starts at a fixed instant and only moves when told to. Used by every test. */
export const fixedClock = (
  startEpochMs: number,
  tickMs = 0,
): Clock & { advance: (ms: number) => void } => {
  let current = startEpochMs;
  let monotonic = 0;
  return {
    now: () => {
      const value = formatTimestamp(current);
      current += tickMs;
      return value;
    },
    monotonicMs: () => {
      const value = monotonic;
      monotonic += tickMs;
      return value;
    },
    advance: (ms: number) => {
      current += ms;
      monotonic += ms;
    },
  };
};
