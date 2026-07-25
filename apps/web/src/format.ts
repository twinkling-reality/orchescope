/**
 * Formatting helpers. Deliberately locale independent so that the same bundle reads the same on
 * every machine and so that the unit tests do not depend on an ICU build.
 */

const GROUP_SIZE = 3;

/**
 * What a value reads as when there is nothing to render. A word rather than a dash: a screen reader announces it, and
 * an empty looking cell is indistinguishable from a rendering bug.
 */
export const UNKNOWN = 'unknown';

function groupDigits(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % GROUP_SIZE === 0) {
      out += ' ';
    }
    out += digits[i];
  }
  return out;
}

export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) {
    return UNKNOWN;
  }
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + groupDigits(String(Math.abs(rounded)));
}

export function formatNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) {
    return UNKNOWN;
  }
  if (Number.isInteger(value)) {
    return formatInteger(value);
  }
  const fixed = Math.abs(value).toFixed(decimals);
  const dot = fixed.indexOf('.');
  const whole = dot === -1 ? fixed : fixed.slice(0, dot);
  const fraction = dot === -1 ? '' : fixed.slice(dot);
  return `${value < 0 ? '-' : ''}${groupDigits(whole)}${fraction}`;
}

/**
 * Always renders `decimals` places, unlike `formatNumber`, which leaves a whole number whole.
 *
 * A scaled unit states the precision of its own scaling: "1.0 MiB" says the value was rounded to a tenth of a
 * mebibyte, where "1 MiB" would read as exact. A count has no scaling to state, so it stays integral.
 */
export function formatFixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return UNKNOWN;
  }
  const fixed = Math.abs(value).toFixed(decimals);
  const dot = fixed.indexOf('.');
  const whole = dot === -1 ? fixed : fixed.slice(0, dot);
  const fraction = dot === -1 ? '' : fixed.slice(dot);
  return `${value < 0 ? '-' : ''}${groupDigits(whole)}${fraction}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return UNKNOWN;
  }
  if (ms < 1) {
    return `${formatNumber(ms, 3)} ms`;
  }
  if (ms < 1000) {
    return `${formatNumber(ms, 1)} ms`;
  }
  if (ms < 60_000) {
    return `${formatNumber(ms / 1000, 2)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms - minutes * 60_000) / 1000;
  return `${formatInteger(minutes)} min ${formatFixed(seconds, 1)} s`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return UNKNOWN;
  }
  const decimals = Math.abs(value) < 1 ? 4 : 2;
  return `USD ${formatNumber(value, decimals)}`;
}

/** `fraction` is a ratio, so 0.15 renders as 15%. */
export function formatPercent(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) {
    return UNKNOWN;
  }
  return `${formatFixed(fraction * 100, decimals)}%`;
}

export function formatConfidence(value: number): string {
  if (!Number.isFinite(value)) {
    return UNKNOWN;
  }
  return formatNumber(value, 2);
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value)) {
    return UNKNOWN;
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? formatInteger(scaled) : formatFixed(scaled, 1)} ${units[unit]}`;
}

/**
 * Renders a metric with its unit. Units that are already carried by the formatter are not repeated,
 * so a millisecond metric reads "12.4 ms" rather than "12.4 ms ms".
 */
export function formatMetricValue(value: number, unit: string): string {
  const normalised = unit.trim().toLowerCase();
  if (normalised === 'ms' || normalised === 'milliseconds') {
    return formatDuration(value);
  }
  if (normalised === 'usd' || normalised === 'dollars') {
    return formatUsd(value);
  }
  if (normalised === 'ratio' || normalised === 'fraction') {
    return formatPercent(value);
  }
  if (normalised === 'percent' || normalised === '%') {
    return `${formatNumber(value, 1)}%`;
  }
  if (normalised === 'bytes') {
    return formatBytes(value);
  }
  return `${formatNumber(value)} ${unit}`;
}

/** `agent_group` becomes `Agent group`; an already readable label is left alone. */
export function humanise(token: string): string {
  const spaced = token.replaceAll('_', ' ').trim();
  if (spaced.length === 0) {
    return token;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Timestamps are shown exactly as the bundle recorded them, in UTC, because a locale rendering of a
 * report that will be pasted into a review invites disagreement about which day it was.
 */
export function formatTimestamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.\d{3}Z$/.exec(iso);
  if (!match) {
    return iso;
  }
  return `${match[1]} ${match[2]} UTC`;
}

export function formatSourceLocation(file: string, startLine: number, endLine?: number): string {
  if (endLine !== undefined && endLine !== startLine) {
    return `${file}:${startLine}-${endLine}`;
  }
  return `${file}:${startLine}`;
}

export function pluralise(count: number, singular: string, plural: string): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`;
}

/** Quotes an argv element only when it needs quoting, so copied commands can be pasted as is. */
export function quoteArg(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export function formatArgv(argv: readonly string[]): string {
  return argv.map(quoteArg).join(' ');
}
