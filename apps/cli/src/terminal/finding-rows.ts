/**
 * What the audit found, said in the order a reader would ask.
 *
 * Severity is the key rather than a state, which is three separate decisions and worth stating.
 * `problem  ! HIGH  <title>` spent two fields saying one thing, and it spent them in the widest columns
 * on the page: at eighty columns a title had fifty left, so every sentence that named a component and
 * its consequence was cut before it reached the consequence. The severity word alone is what a reader
 * greps for and the only part of that pair a non-expert can act on. And a key is painted and then
 * padded by the grid, so a coloured severity is a chip the width of the word rather than an eleven
 * column bar with the word at one end of it.
 *
 * `serious / medium / minor` are the three buckets a reader needs. `high` and `critical` are the same
 * instruction, and `low` and `info` are the same instruction; the five the engine records are exact and
 * they are in `--verbose`, `--json` and MCP, where an exact severity is what the reader is for.
 */

import { formatCount } from '@orchescope/domain';
import { ZERO_RISK_CAVEAT } from '@orchescope/report';
import type { Finding, Severity } from '@orchescope/schema';
import { visibleWidth } from './display-width.ts';
import type { Region, Row } from './document-grid.ts';
import { createStyle, type Style } from './style.ts';

/** Three worst problems on the glance. More is a log, not a glance. */
const GLANCE_CEILING = 3;
/** Verbose may list more before the overflow line. */
const VERBOSE_CEILING = 6;

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

const bucketWord = (severity: Severity): string => {
  if (severity === 'critical' || severity === 'high') return 'serious';
  if (severity === 'medium') return 'medium';
  return 'minor';
};

const paintBucket =
  (style: Style, severity: Severity) =>
  (text: string): string => {
    if (severity === 'critical' || severity === 'high') return style.chipBad(text);
    if (severity === 'medium') return style.chipWarn(text);
    return style.dim(text);
  };

/**
 * The mix, and the promise that the rows under it are ordered.
 *
 * "Worst first" is the one sentence that makes a truncated list honest: a reader who stops after the
 * first row has still read the worst thing this scan found.
 */
const headingSentence = (
  risks: readonly Finding[],
  strengths: number,
  shown: number,
  verbose: boolean,
): string => {
  if (risks.length === 0) {
    return verbose
      ? `no problems${strengths === 0 ? '' : `, ${formatCount(strengths, 'strength')}`}`
      : 'no problems found';
  }
  const counts = new Map<string, number>();
  for (const severity of SEVERITY_ORDER) {
    const count = risks.filter((finding) => finding.severity === severity).length;
    if (count > 0)
      counts.set(bucketWord(severity), (counts.get(bucketWord(severity)) ?? 0) + count);
  }
  const mix = [...counts.entries()].map(([word, count]) => `${count} ${word}`).join(', ');
  if (!verbose) return shown > 1 ? `${mix}, worst first` : mix;
  const strengthPart = strengths === 0 ? '' : `; ${formatCount(strengths, 'strength')}`;
  return `${formatCount(risks.length, 'problem')} (${mix})${strengthPart}`;
};

const basisField = (finding: Finding): string => `${finding.evidence.length} ${finding.basis}`;

const riskRow = (finding: Finding, style: Style, tailWidth: number | undefined): Row => ({
  kind: 'keyed',
  key: bucketWord(finding.severity),
  text: finding.title,
  paintKey: paintBucket(style, finding.severity),
  ...(tailWidth === undefined ? {} : { tail: basisField(finding), tailWidth }),
});

const strengthRow = (finding: Finding, style: Style, tailWidth: number): Row => ({
  kind: 'keyed',
  key: 'ok',
  text: finding.title,
  paintKey: style.good,
  tail: basisField(finding),
  tailWidth,
});

/** Verbose is where the exact severity, the identifier and the confidence live. */
const verboseDetail = (finding: Finding): Row => ({
  kind: 'detail',
  align: 'value',
  text: `${finding.id}, ${finding.severity}, ${finding.category}, confidence ${finding.confidence.toFixed(2)}`,
});

export interface FindingInput {
  readonly risks: readonly Finding[];
  readonly strengths: readonly Finding[];
  readonly verbose: boolean;
  readonly style?: Style;
}

export const findingRegion = (input: FindingInput): Region => {
  const style = input.style ?? createStyle('plain');
  const ceiling = input.verbose ? VERBOSE_CEILING : GLANCE_CEILING;
  const shownRisks = input.risks.slice(0, ceiling);
  const shownStrengths = input.verbose ? input.strengths.slice(0, VERBOSE_CEILING) : [];
  const showTails = input.verbose;
  const anchored = showTails ? [...shownRisks, ...shownStrengths] : [];
  const tailWidth = showTails
    ? anchored.reduce((width, finding) => Math.max(width, visibleWidth(basisField(finding))), 0)
    : undefined;

  const rows: Row[] = [
    {
      kind: 'keyed',
      key: 'problems',
      text: headingSentence(input.risks, input.strengths.length, shownRisks.length, input.verbose),
    },
  ];
  if (input.risks.length === 0) rows.push({ kind: 'caveat', text: ZERO_RISK_CAVEAT });
  for (const finding of shownRisks) {
    rows.push(riskRow(finding, style, tailWidth));
    if (input.verbose) rows.push(verboseDetail(finding));
  }
  for (const finding of shownStrengths) {
    rows.push(strengthRow(finding, style, tailWidth ?? 0));
    rows.push(verboseDetail(finding));
  }
  const remaining = input.risks.length - shownRisks.length;
  if (remaining > 0) {
    rows.push({
      kind: 'keyed',
      key: 'more',
      text: input.verbose
        ? `${formatCount(remaining, 'more problem')}; full list: orchescope audit --json`
        : `${formatCount(remaining, 'more problem')}: orchescope audit --verbose`,
    });
  }
  return rows;
};
