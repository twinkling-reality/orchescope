import type { ProgressEvent, ProgressSink } from '@orchescope/observability';
import { durableLine, transientLine } from './progress-line.ts';
import { formatDuration, type Style, SYMBOLS } from './style.ts';

/**
 * Progress rendering.
 *
 * The rules this implements, in the order they matter:
 *
 *  - an animated indicator appears only while work is actually running, and only on a terminal;
 *  - a determinate count appears only when the phase reported a total, so there are no invented
 *    percentages;
 *  - the line is erased rather than overwritten, so a finished phase leaves nothing behind at all: the
 *    facts every phase line used to carry are lines of the document on standard output, with their
 *    denominators, which the phase lines never had;
 *  - nothing is written at all when the output is not a terminal, in JSON mode, or under CI, unless the
 *    reader asked for a log with verbose output, in which case each phase leaves one durable line.
 *
 * Warnings and refusals are not progress. Anything durable erases the transient line, writes itself, and
 * lets the transient line be drawn again, which is what stops a message built from repository data
 * landing in the middle of a half drawn one.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const FRAME_INTERVAL_MS = 90;
/**
 * The floor between two repaints.
 *
 * A phase that reports every file it parsed reports twelve hundred times, and a redraw per event is
 * twelve hundred writes to render about thirty distinct frames. The frame is a function of the clock
 * rather than of the event, so dropping the ones in between costs nothing on screen.
 */
const REPAINT_INTERVAL_MS = 60;

/**
 * How long work has to run before it is worth saying it is running.
 *
 * A loader for something that did not take time is a small lie, and it is also where the sediment came
 * from: a phase that finishes inside the gate draws nothing, so there is nothing to erase and nothing
 * left in the scrollback. Eighty milliseconds is the reference implementation's own gate and is about
 * where a person starts to notice a pause.
 */
const FIRST_FRAME_MS = 80;

/**
 * Return to column one and erase the row, by escape code rather than by the characters it looks like.
 *
 * The version before this wrote the sequence with the ESC byte missing, so a terminal read the four
 * printable characters that follow it and every surviving line began with them. Spelled as a code
 * point escape rather than as a raw byte, an editor, a diff and a reviewer can all see it is there.
 */
const ERASE_ROW = '\r\u001b[2K';

export type ProgressRendererOptions = {
  readonly style: Style;
  readonly animate: boolean;
  readonly verbose: boolean;
  /** Columns of the stream this writes to, which is standard error and not the document's stream. */
  readonly columns: number | undefined;
  readonly write: (text: string) => void;
  readonly monotonicMs: () => number;
};

export type ProgressRenderer = {
  readonly sink: ProgressSink;
  /** Writes a durable line without the transient line corrupting it, or being corrupted by it. */
  readonly emitLine: (text: string) => void;
  readonly stop: () => void;
};

export const createProgressRenderer = (options: ProgressRendererOptions): ProgressRenderer => {
  const { style } = options;
  let active:
    | {
        readonly label: string;
        readonly startedAt: number;
        completed: number;
        total: number | undefined;
      }
    | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lineOpen = false;
  let paintedAt = 0;

  const activeLine = (): string => {
    if (active === undefined) return '';
    const elapsed = options.monotonicMs() - active.startedAt;
    /*
     * The frame comes from the clock, not from a counter the timer advances.
     *
     * Most of the work behind these phases is synchronous, so the interval cannot fire while it runs:
     * measured on `crewai`, a 2.8 second discovery drew two frames, and every phase after it redrew the
     * same glyph once and never moved. A counter only advances when the loop is free, which is exactly
     * when there is nothing to wait for. Elapsed time advances regardless, so any repaint at all, from
     * the timer or from the work reporting a file, lands on the frame that belongs to the current
     * instant.
     */
    const glyph = FRAMES[Math.floor(elapsed / FRAME_INTERVAL_MS) % FRAMES.length] ?? SYMBOLS.active;
    return transientLine({
      label: active.label,
      completed: active.completed,
      total: active.total,
      elapsedMs: elapsed,
      glyph: style.accent(glyph),
      columns: options.columns,
    });
  };

  const clearLine = (): void => {
    if (!lineOpen) return;
    options.write(ERASE_ROW);
    lineOpen = false;
  };

  const redraw = (): void => {
    if (!options.animate || active === undefined) return;
    const now = options.monotonicMs();
    if (now - active.startedAt < FIRST_FRAME_MS) return;
    if (lineOpen && now - paintedAt < REPAINT_INTERVAL_MS) return;
    paintedAt = now;
    options.write(`${ERASE_ROW}${activeLine()}`);
    lineOpen = true;
  };

  const startTimer = (): void => {
    if (!options.animate || timer !== undefined) return;
    timer = setInterval(() => {
      redraw();
    }, FRAME_INTERVAL_MS);
    timer.unref();
  };

  const stopTimer = (): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const emitLine = (text: string): void => {
    const wasOpen = lineOpen;
    clearLine();
    options.write(`${durableLine(text, '', options.columns).trimStart()}\n`);
    if (wasOpen) redraw();
  };

  /** The log a reader asked for, one line per phase, keyed like every other line this product prints. */
  const emitPhaseLine = (text: string): void => {
    clearLine();
    options.write(`${durableLine(text, 'phase', options.columns)}\n`);
  };

  const sink: ProgressSink = (event: ProgressEvent) => {
    switch (event.type) {
      case 'phase_started': {
        active = {
          label: event.label,
          startedAt: options.monotonicMs(),
          completed: 0,
          total: event.total,
        };
        paintedAt = 0;
        startTimer();
        redraw();
        return;
      }
      case 'phase_progress': {
        if (active === undefined) return;
        active.completed = event.completed;
        active.total = event.total ?? active.total;
        redraw();
        return;
      }
      case 'phase_finished': {
        stopTimer();
        clearLine();
        if (options.verbose) {
          const duration = event.durationMs > 1500 ? `  ${formatDuration(event.durationMs)}` : '';
          emitPhaseLine(`${event.label}: ${event.summary}${duration}`);
        }
        active = undefined;
        return;
      }
      case 'phase_skipped': {
        stopTimer();
        clearLine();
        if (options.verbose) emitPhaseLine(`${event.label}: skipped, ${event.reason}`);
        active = undefined;
        return;
      }
      /*
       * A note is not progress. It survives whether or not anything is animating, because a warning that
       * only a terminal reader sees is a warning nobody acted on.
       */
      case 'note': {
        const symbol = event.level === 'warning' ? SYMBOLS.warning : SYMBOLS.bullet;
        emitLine(`${symbol} ${event.message}`);
        return;
      }
      default:
        return;
    }
  };

  return {
    sink,
    emitLine,
    stop: () => {
      stopTimer();
      clearLine();
    },
  };
};
