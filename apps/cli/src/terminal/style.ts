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
} as const;

export const detectStyleMode = (input: {
  readonly isTty: boolean;
  readonly noColor: boolean;
  readonly forceColor: boolean;
  readonly jsonMode: boolean;
}): StyleMode => {
  if (input.forceColor) return 'color';
  if (input.noColor || input.jsonMode || !input.isTty) return 'plain';
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

export const SEVERITY_LABEL: Readonly<Record<string, string>> = {
  critical: 'critical',
  high: 'high    ',
  medium: 'medium  ',
  low: 'low     ',
  info: 'info    ',
};

export const paintSeverity = (style: Style, severity: string, text: string): string => {
  switch (severity) {
    case 'critical':
    case 'high':
      return style.bad(text);
    case 'medium':
      return style.warn(text);
    default:
      return style.dim(text);
  }
};

export const formatDuration = (milliseconds: number): string => {
  if (milliseconds < 1) return '<1ms';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
};

export const formatCount = (value: number, singular: string, plural = `${singular}s`): string =>
  `${value} ${value === 1 ? singular : plural}`;

export const truncate = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

export const padRight = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length);
