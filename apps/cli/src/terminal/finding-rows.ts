/**
 * What the audit found: one heading sentence, a bounded list, and what the list left out.
 *
 * This is the one region that answers "what did you find". The default surface is for a human glance:
 * severity weight first, then the problem in words, then the evidence basis. Finding identifiers stay
 * off that surface because they are arguments for agents and for `goal create`, not nouns a reader
 * needs to scan. Under `--verbose`, and on the `run` line when a goal is the next step, the identifier
 * is still available.
 *
 * Severity that matters is shouted: `HIGH` / `MEDIUM` in uppercase, and on a colour TTY inside a
 * background chip. `low` and `info` stay quiet. An optional unit meter under the heading draws one
 * letter per risk so the mix is visible without inventing a score. No rule is suppressed here.
 */

import { formatCount } from '@orchescope/domain';
import { ZERO_RISK_CAVEAT } from '@orchescope/report';
import type { Finding, Severity } from '@orchescope/schema';
import { padTo, visibleWidth } from './display-width.ts';
import { STATE_WIDTH, type Region, type Row } from './document-grid.ts';
import { createStyle, type Style } from './style.ts';
import { severityUnitMeter } from './unit-meter.ts';

/**
 * Six rows.
 *
 * Fourteen of the sixteen cached repositories hold six or fewer risk findings, so on fourteen of them
 * this list is complete and the overflow line never renders. The two that overflow hold nineteen and
 * eight. Seven is where a list stops being read as a set and starts being read as a log, which is what
 * nineteen findings over thirty eight lines was.
 */
const ROW_CEILING = 6;

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

/** Loud severities keep uppercase under `NO_COLOR` so weight is not colour alone. */
const severityWord = (severity: Severity): string =>
  severity === 'critical' || severity === 'high' || severity === 'medium'
    ? severity.toUpperCase()
    : severity;

const headingSeverity = (severity: Severity, count: number): string =>
  `${count} ${severityWord(severity)}`;

/**
 * The counts, in one sentence, one line above the rows they describe.
 *
 * The severity block this replaces spent up to six lines saying what a clause says, and it said the
 * strength count a second and third time. Here every count appears once.
 */
const headingSentence = (risks: readonly Finding[], strengths: number): string => {
  const present = SEVERITY_ORDER.map(
    (severity) =>
      [severity, risks.filter((finding) => finding.severity === severity).length] as const,
  ).filter(([, count]) => count > 0);
  const strengthPart = strengths === 0 ? 'no strengths' : formatCount(strengths, 'strength');
  if (risks.length === 0) return `no risks, ${strengthPart}`;
  const only = present.length === 1 ? present[0] : undefined;
  const riskPart =
    only === undefined
      ? `${formatCount(risks.length, 'risk')}: ${present.map(([severity, count]) => headingSeverity(severity, count)).join(', ')}`
      : risks.length === 1
        ? `1 risk, ${severityWord(only[0])}`
        : `${risks.length} risks, all ${severityWord(only[0])}`;
  return `${riskPart}; ${strengthPart}`;
};

const severityBuckets = (risks: readonly Finding[]) => ({
  critical: risks.filter((finding) => finding.severity === 'critical').length,
  high: risks.filter((finding) => finding.severity === 'high').length,
  medium: risks.filter((finding) => finding.severity === 'medium').length,
  low: risks.filter((finding) => finding.severity === 'low').length,
  info: risks.filter((finding) => finding.severity === 'info').length,
});

/**
 * The right aligned field: how many evidence records stand behind the row, and how they were
 * established.
 *
 * A finding title is itself a numeric claim, and a metric without a sample size is not reported. So the
 * sample size travels with the row rather than with the report, and it travels beside the word that
 * says what kind of evidence was counted, because a bare integer at the right edge of a row is a number
 * with no basis.
 */
const basisField = (finding: Finding): string => `${finding.evidence.length} ${finding.basis}`;

/**
 * Severity chip: symbol + word always; background fill only when colour is on.
 *
 * The padded field is painted as one chip so the background reads as a block behind `! HIGH`, not as
 * coloured letters floating in the state column. Under plain style the same glyphs remain.
 */
const paintSeverity = (style: Style, severity: Severity): string => {
  const label = `! ${severityWord(severity)}`;
  if (style.mode === 'plain') {
    if (severity === 'low' || severity === 'info') return style.dim(label);
    return label;
  }
  const chip = padTo(label, STATE_WIDTH);
  if (severity === 'critical' || severity === 'high') return style.chipBad(chip);
  if (severity === 'medium') return style.chipWarn(chip);
  return style.dim(label);
};

const riskRow = (finding: Finding, tailWidth: number, style: Style): Row => ({
  kind: 'keyed',
  key: 'problem',
  state: paintSeverity(style, finding.severity),
  text: finding.title,
  tail: basisField(finding),
  tailWidth,
});

const strengthRow = (finding: Finding, tailWidth: number, style: Style): Row => ({
  kind: 'keyed',
  key: 'ok',
  state: style.good('+ strength'),
  text: finding.title,
  tail: basisField(finding),
  tailWidth,
});

/**
 * Under verbose, the identifier and the two fields a row cannot carry come back on a line of their own.
 *
 * The identifier is an argument, not a headline: agents take it from `--json` or MCP, and a human who
 * asked for verbose is the one who wants to paste it.
 */
const verboseDetail = (finding: Finding): Row => ({
  kind: 'detail',
  text: `${finding.id}, ${finding.category}, confidence ${finding.confidence.toFixed(2)}`,
});

export interface FindingInput {
  readonly risks: readonly Finding[];
  readonly strengths: readonly Finding[];
  readonly verbose: boolean;
  readonly style?: Style;
}

export const findingRegion = (input: FindingInput): Region => {
  const style = input.style ?? createStyle('plain');
  const shownRisks = input.risks.slice(0, ROW_CEILING);
  const shownStrengths = input.verbose ? input.strengths.slice(0, ROW_CEILING) : [];
  const anchored = [...shownRisks, ...shownStrengths];
  const tailWidth = anchored.reduce(
    (width, finding) => Math.max(width, visibleWidth(basisField(finding))),
    0,
  );

  const rows: Row[] = [
    { kind: 'keyed', key: 'findings', text: headingSentence(input.risks, input.strengths.length) },
  ];
  const mix = severityUnitMeter(severityBuckets(input.risks));
  if (mix !== undefined) {
    rows.push({ kind: 'keyed', key: 'findings', text: mix });
  }
  /*
   * A caveat renders at column one, full width, ignoring the key anchor, because it qualifies the whole
   * region rather than any row in it. It is never shortened: what it guards against is a reader taking
   * an empty list for a clean bill of health.
   */
  if (input.risks.length === 0) rows.push({ kind: 'caveat', text: ZERO_RISK_CAVEAT });
  for (const finding of shownRisks) {
    rows.push(riskRow(finding, tailWidth, style));
    if (input.verbose) rows.push(verboseDetail(finding));
  }
  for (const finding of shownStrengths) {
    rows.push(strengthRow(finding, tailWidth, style));
    rows.push(verboseDetail(finding));
  }
  /*
   * One overflow line, never more. Agents read the full set from `--json` or MCP; the terminal does not
   * pretend to be that list.
   */
  const remaining = input.risks.length - shownRisks.length;
  if (remaining > 0) {
    rows.push({
      kind: 'keyed',
      key: 'findings',
      text: `${formatCount(remaining, 'more risk')}; full list: orchescope audit --json`,
    });
  }
  return rows;
};
