import type { Comparison } from '@orchescope/schema';
import { padRight, type Style, SYMBOLS } from './style.ts';

/**
 * What `orchescope compare` reports.
 *
 * The verdict comes from `packages/comparison` and is never recomputed here. Every metric row carries the
 * sample size behind each side of it, because a change measured on one run per side is not a change.
 */

const VERDICT_PAINTERS: Readonly<Record<string, (style: Style) => (text: string) => string>> = {
  improved: (style) => style.good,
  regressed: (style) => style.bad,
};

const DIRECTION_MARKERS: Readonly<Record<string, (style: Style) => string>> = {
  improved: (style) => style.good(SYMBOLS.done),
  regressed: (style) => style.bad(SYMBOLS.failed),
};

const metricRow = (
  style: Style,
  delta: Comparison['metricDeltas'][number],
  nameWidth: number,
): string => {
  const change =
    delta.relativeChange === undefined
      ? '-'
      : `${delta.relativeChange > 0 ? '+' : ''}${(delta.relativeChange * 100).toFixed(1)}%`;
  const marker = (
    DIRECTION_MARKERS[delta.direction] ?? ((inner: Style) => inner.dim(SYMBOLS.pending))
  )(style);
  const value = (amount: number | undefined): string =>
    amount === undefined ? '-' : amount.toFixed(2);
  return `  ${marker} ${padRight(delta.metric, nameWidth - 2)} ${padRight(value(delta.baseline), 12)} ${padRight(value(delta.candidate), 12)} ${padRight(change, 12)} ${delta.baselineSamples}/${delta.candidateSamples}`;
};

export const comparisonSummary = (style: Style, comparison: Comparison): string => {
  const lines: string[] = [];
  const verdictStyle = (VERDICT_PAINTERS[comparison.verdict] ?? ((inner: Style) => inner.warn))(
    style,
  );
  lines.push('');
  lines.push(`${verdictStyle(comparison.verdict.replace(/_/g, ' '))}: ${comparison.verdictReason}`);
  lines.push(
    style.dim(
      `  ${comparison.baseline.label} (${comparison.baseline.reference}) against ${comparison.candidate.label} (${comparison.candidate.reference})`,
    ),
  );
  lines.push('');
  const nameWidth = Math.max(...comparison.metricDeltas.map((delta) => delta.metric.length), 8) + 1;
  lines.push(
    style.dim(
      `  ${padRight('metric', nameWidth)} ${padRight('baseline', 12)} ${padRight('candidate', 12)} ${padRight('change', 12)} samples`,
    ),
  );
  for (const delta of comparison.metricDeltas) {
    lines.push(metricRow(style, delta, nameWidth));
    if (delta.caveat !== undefined) lines.push(style.dim(`      ${delta.caveat}`));
  }
  for (const limitation of comparison.limitations) {
    lines.push(style.dim(`  ${SYMBOLS.pending} ${limitation}`));
  }
  return lines.join('\n');
};
