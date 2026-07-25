import type { ProgressEvent, ProgressSink } from '@orchescope/observability';
import { formatDuration, type Style, SYMBOLS } from './style.ts';

/**
 * Progress rendering.
 *
 * The rules this implements, in the order they matter:
 *
 *  - an animated indicator appears only while work is actually running, and only on a terminal;
 *  - a determinate count appears only when the phase reported a total, so there are no invented percentages;
 *  - a finished phase collapses to one line that states what it found, because the useful information is the
 *    result rather than the fact that something happened;
 *  - nothing animates when the output is not a terminal, in JSON mode, or under CI, where a redrawn line becomes
 *    thousands of lines in a log.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const FRAME_INTERVAL_MS = 90;

export type ProgressRendererOptions = {
  readonly style: Style;
  readonly animate: boolean;
  readonly verbose: boolean;
  readonly write: (text: string) => void;
  readonly monotonicMs: () => number;
};

export type ProgressRenderer = {
  readonly sink: ProgressSink;
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
        detail: string | undefined;
      }
    | undefined;
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lineOpen = false;

  const activeLine = (): string => {
    if (active === undefined) return '';
    const spinner = options.animate
      ? (FRAMES[frame % FRAMES.length] ?? SYMBOLS.active)
      : SYMBOLS.active;
    const elapsed = options.monotonicMs() - active.startedAt;
    const counter =
      active.total === undefined
        ? active.completed > 0
          ? ` ${active.completed}`
          : ''
        : ` ${active.completed}/${active.total}`;
    const detail =
      options.verbose && active.detail !== undefined ? style.dim(` ${active.detail}`) : '';
    const duration = elapsed > 1500 ? style.dim(` ${formatDuration(elapsed)}`) : '';
    return `${style.accent(spinner)} ${active.label}${counter}${duration}${detail}`;
  };

  const clearLine = (): void => {
    if (!lineOpen) return;
    options.write('\r[2K');
    lineOpen = false;
  };

  const redraw = (): void => {
    if (!options.animate || active === undefined) return;
    options.write(`\r[2K${activeLine()}`);
    lineOpen = true;
  };

  const startTimer = (): void => {
    if (!options.animate || timer !== undefined) return;
    timer = setInterval(() => {
      frame += 1;
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
    clearLine();
    options.write(`${text}\n`);
  };

  const sink: ProgressSink = (event: ProgressEvent) => {
    switch (event.type) {
      case 'phase_started': {
        active = {
          label: event.label,
          startedAt: options.monotonicMs(),
          completed: 0,
          total: event.total,
          detail: undefined,
        };
        if (options.animate) {
          startTimer();
          redraw();
        } else {
          emitLine(`${style.dim(SYMBOLS.active)} ${event.label}`);
        }
        return;
      }
      case 'phase_progress': {
        if (active === undefined) return;
        active.completed = event.completed;
        active.total = event.total ?? active.total;
        active.detail = event.detail;
        redraw();
        return;
      }
      case 'phase_finished': {
        stopTimer();
        const duration =
          event.durationMs > 1500 ? style.dim(` ${formatDuration(event.durationMs)}`) : '';
        emitLine(`${style.good(SYMBOLS.done)} ${event.label}: ${event.summary}${duration}`);
        active = undefined;
        return;
      }
      case 'phase_skipped': {
        stopTimer();
        emitLine(`${style.dim(SYMBOLS.skipped)} ${style.dim(`${event.label}: ${event.reason}`)}`);
        active = undefined;
        return;
      }
      case 'note': {
        const symbol =
          event.level === 'warning' ? style.warn(SYMBOLS.warning) : style.dim(SYMBOLS.bullet);
        emitLine(`${symbol} ${event.message}`);
        return;
      }
      default:
        return;
    }
  };

  return {
    sink,
    stop: () => {
      stopTimer();
      clearLine();
    },
  };
};
