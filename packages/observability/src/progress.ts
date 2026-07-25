/**
 * Progress reporting.
 *
 * The core emits phase and step events. It does not know whether anything is listening, whether the listener
 * is a terminal, a server sent event stream or a test, and it never formats output. That separation is what
 * lets the CLI render a calm progress display and the report server stream the same events to a browser
 * without the analysis code knowing either exists.
 *
 * Progress is honest by construction: a phase reports `total` only when the amount of work is actually known,
 * so a renderer cannot invent a percentage.
 */

export type PhaseName =
  | 'inspect'
  | 'index'
  | 'discover'
  | 'ingest'
  | 'reconcile'
  | 'analyse'
  | 'interpret'
  | 'report'
  | 'execute'
  | 'compare';

export type ProgressEvent =
  | {
      readonly type: 'phase_started';
      readonly phase: PhaseName;
      readonly label: string;
      readonly total?: number;
    }
  | {
      readonly type: 'phase_progress';
      readonly phase: PhaseName;
      readonly completed: number;
      readonly total?: number;
      readonly detail?: string;
    }
  | {
      readonly type: 'phase_finished';
      readonly phase: PhaseName;
      readonly label: string;
      readonly summary: string;
      readonly durationMs: number;
    }
  | {
      readonly type: 'phase_skipped';
      readonly phase: PhaseName;
      readonly label: string;
      readonly reason: string;
    }
  | { readonly type: 'note'; readonly level: 'info' | 'warning'; readonly message: string };

export type ProgressReporter = {
  readonly emit: (event: ProgressEvent) => void;
  /** Starts a phase and returns a handle that reports its own completion exactly once. */
  readonly phase: (
    phase: PhaseName,
    label: string,
    total?: number,
  ) => {
    readonly step: (completed: number, detail?: string) => void;
    readonly finish: (summary: string) => void;
    readonly skip: (reason: string) => void;
  };
};

export type ProgressSink = (event: ProgressEvent) => void;

export const createProgressReporter = (
  sink: ProgressSink,
  monotonicMs: () => number,
): ProgressReporter => {
  const emit = (event: ProgressEvent): void => {
    sink(event);
  };
  return {
    emit,
    phase: (phase, label, total) => {
      const startedAt = monotonicMs();
      emit({
        type: 'phase_started',
        phase,
        label,
        ...(total === undefined ? {} : { total }),
      });
      let closed = false;
      return {
        step: (completed, detail) => {
          if (closed) return;
          emit({
            type: 'phase_progress',
            phase,
            completed,
            ...(total === undefined ? {} : { total }),
            ...(detail === undefined ? {} : { detail }),
          });
        },
        finish: (summary) => {
          if (closed) return;
          closed = true;
          emit({
            type: 'phase_finished',
            phase,
            label,
            summary,
            durationMs: monotonicMs() - startedAt,
          });
        },
        skip: (reason) => {
          if (closed) return;
          closed = true;
          emit({ type: 'phase_skipped', phase, label, reason });
        },
      };
    },
  };
};

export const silentProgress: ProgressReporter = createProgressReporter(
  () => {
    // A silent reporter is the default so that a library caller never gets unexpected output.
  },
  () => 0,
);

/** Collects events, for tests and for the report server's replay buffer. */
export const collectingProgress = (
  monotonicMs: () => number = () => 0,
): ProgressReporter & { readonly events: readonly ProgressEvent[] } => {
  const events: ProgressEvent[] = [];
  const reporter = createProgressReporter((event) => events.push(event), monotonicMs);
  return { ...reporter, events };
};
