/**
 * The transient line, and the durable line that replaces it under verbose output.
 *
 * A progress indicator is not a paragraph. It lives in its own region, on its own stream, occupying
 * exactly one terminal row, with the phase at column one and the motion glyph pinned to the right edge.
 * That is "at the side" achieved by an anchor rather than by a box, and it costs no cursor arithmetic:
 * one row is one row whatever the terminal does next, so a window resize, a terminal shorter than the
 * region and an exception thrown mid phase all leave nothing to repair.
 *
 * The line is sized from standard error, which is where it is written. Redirecting the document with
 * `orchescope audit > report.txt` in a terminal leaves standard output with no width at all while
 * standard error is still a terminal at its real width, so a region that measured the document's stream
 * would draw itself eighty columns wide in a hundred and twenty column window.
 */

import { cut, padTo, sanitiseCell, visibleWidth } from './display-width.ts';
import { KEY_WIDTH } from './document-grid.ts';
import { formatDuration } from './style.ts';

/**
 * One column short of the terminal.
 *
 * Writing the last column of a row leaves most terminals with a pending wrap, and a line that wrapped is
 * two rows, of which the erase sequence clears one. Stopping a column early is what makes the erase
 * total, which is the whole promise of a transient region.
 */
export const transientWidth = (columns: number | undefined): number =>
  Math.max(20, (columns ?? 80) - 1);

export interface TransientInput {
  readonly label: string;
  readonly completed: number;
  readonly total: number | undefined;
  readonly elapsedMs: number;
  readonly glyph: string;
  readonly columns: number | undefined;
}

/**
 * A determinate count only when the phase reported a total, and never a percentage.
 *
 * A phase that does not know its own size reports what it has done and nothing more. Turning that into
 * a share of an unknown whole is the invented percentage this product refuses everywhere, and here it
 * would be invented while the reader watches.
 */
const counterOf = (input: TransientInput): string => {
  if (input.total !== undefined) return ` ${input.completed}/${input.total}`;
  return input.completed > 0 ? ` ${input.completed}` : '';
};

/**
 * The elapsed time appears only once the work has been running long enough for it to be news.
 *
 * Under a second and a half it changes faster than it can be read and says nothing a moving glyph does
 * not already say.
 */
const DURATION_FLOOR_MS = 1500;

export const transientLine = (input: TransientInput): string => {
  const width = transientWidth(input.columns);
  const duration = input.elapsedMs > DURATION_FLOOR_MS ? ` ${formatDuration(input.elapsedMs)}` : '';
  const left = `${sanitiseCell(input.label)}${counterOf(input)}${duration}`;
  const glyphWidth = visibleWidth(input.glyph);
  return `${padTo(cut(left, width - glyphWidth - 1), width - glyphWidth)}${input.glyph}`;
};

/**
 * One durable line per phase, after the phase ends, for the reader who asked for a log.
 *
 * It uses the document's own key anchor rather than inventing a second one. The line is bounded to the
 * stream's width like everything else: a phase summary is built from repository data, and an unbounded
 * line built from repository data is how a terminal ends up with a two hundred and seventy one column
 * row in it.
 */
export const durableLine = (text: string, key: string, columns: number | undefined): string => {
  const width = transientWidth(columns);
  const prefix = `${padTo(key, KEY_WIDTH)}  `;
  return `${prefix}${cut(sanitiseCell(text), width - visibleWidth(prefix))}`;
};
