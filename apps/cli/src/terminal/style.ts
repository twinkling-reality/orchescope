/**
 * Terminal styling.
 *
 * Colour is an enhancement, never the carrier of meaning: every state also has a distinct symbol and a word, so
 * the output reads correctly in a pipe, in a log file, under NO_COLOR and for a reader who cannot distinguish the
 * hues. Severity uses text plus symbol for the same reason.
 */

export type StyleMode = 'color' | 'plain';

export type Style = {
  readonly mode: StyleMode;
  readonly bold: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly good: (text: string) => string;
  readonly warn: (text: string) => string;
  readonly bad: (text: string) => string;
  readonly accent: (text: string) => string;
  readonly link: (text: string) => string;
  /**
   * Background chip for a high/critical severity label. The text inside still carries `!` and the
   * severity word so a pipe or `NO_COLOR` reader who never saw the chip loses nothing essential.
   */
  readonly chipBad: (text: string) => string;
  /** Background chip for a medium severity label. Same contract as `chipBad`. */
  readonly chipWarn: (text: string) => string;
};

const CODES = {
  reset: '[0m',
  bold: '[1m',
  dim: '[2m',
  green: '[32m',
  yellow: '[33m',
  red: '[31m',
  cyan: '[36m',
  underline: '[4m',
  /** Red background, bright white, bold: a high severity chip. */
  chipBad: '[41;97;1m',
  /** Yellow background, black, bold: a medium severity chip. */
  chipWarn: '[43;30;1m',
} as const;

/**
 * Colour precedence, strongest first.
 *
 *  1. JSON mode is never coloured. An escape sequence inside the document would break every consumer of it.
 *  2. An explicit `--color` wins over the environment, because a flag on this invocation is a stronger signal than a
 *     setting that applies to every program.
 *  3. `NO_COLOR`, a `--no-color` flag, or output that is not a terminal all disable colour.
 */
export const detectStyleMode = (input: {
  readonly isTty: boolean;
  readonly noColor: boolean;
  readonly forceColor: boolean;
  readonly jsonMode: boolean;
}): StyleMode => {
  if (input.jsonMode) return 'plain';
  if (input.forceColor) return 'color';
  if (input.noColor || !input.isTty) return 'plain';
  return 'color';
};

export const createStyle = (mode: StyleMode): Style => {
  if (mode === 'plain') {
    const identity = (text: string): string => text;
    return {
      mode,
      bold: identity,
      dim: identity,
      good: identity,
      warn: identity,
      bad: identity,
      accent: identity,
      link: identity,
      chipBad: identity,
      chipWarn: identity,
    };
  }
  const wrap = (code: string) => (text: string) => `${code}${text}${CODES.reset}`;
  return {
    mode,
    bold: wrap(CODES.bold),
    dim: wrap(CODES.dim),
    good: wrap(CODES.green),
    warn: wrap(CODES.yellow),
    bad: wrap(CODES.red),
    accent: wrap(CODES.cyan),
    link: wrap(CODES.underline),
    chipBad: wrap(CODES.chipBad),
    chipWarn: wrap(CODES.chipWarn),
  };
};

/** Symbols carry the state so that colour is never the only signal. */
export const SYMBOLS = {
  done: '+',
  active: '>',
  pending: '.',
  skipped: '-',
  failed: 'x',
  warning: '!',
  bullet: '*',
} as const;

export const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1) return '<1ms';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
};

export const padRight = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length);
