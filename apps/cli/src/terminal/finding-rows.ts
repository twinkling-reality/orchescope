/**
 * What the audit found: one heading sentence, a bounded list, and what the list left out.
 *
 * This is the one region that answers "what did you find". The default surface is for a human glance:
 * severity, the problem in words, and the evidence basis. Finding identifiers stay off that surface
 * because they are arguments for agents and for `goal create`, not nouns a reader needs to scan. Under
 * `--verbose`, and on the `run` line when a goal is the next step, the identifier is still available.
 *
 * No rule is suppressed here. A finding whose rule fired is a finding, and a renderer that decided some
 * of them were not worth a row would be the renderer analysing, which is the one thing a presentation
 * module may not do. The list is bounded by a ceiling and by nothing else: in particular it is not
 * filtered by whether a finding can become an automated goal, because that flag means a person is
 * needed, and hiding those from the person is the exact inversion of what it is for.
 */

import { formatCount } from '@orchescope/domain';
import { ZERO_RISK_CAVEAT } from '@orchescope/report';
import type { Finding, Severity } from '@orchescope/schema';
import { visibleWidth } from './display-width.ts';
import type { Region, Row } from './document-grid.ts';
import { createStyle, type Style } from './style.ts';

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
      ? `${formatCount(risks.length, 'risk')}: ${present.map(([severity, count]) => `${count} ${severity}`).join(', ')}`
      : risks.length === 1
        ? `1 risk, ${only[0]}`
        : `${risks.length} risks, all ${only[0]}`;
  return `${riskPart}; ${strengthPart}`;
};

/**
 * The right aligned field: how many evidence records stand behind the row, and how they were
 * established.
 *
 * A finding title is itself a numeric claim, and a metric without a sample size is not reported. So the
 * sample size travels with the row rather than with the report, and it travels beside the word that
 * says what kind of evidence was counted, because a bare integer at the right edge of a row is a number
 * with no basis. The pair is one field with one anchor: two right aligned fields would be two anchors,
 * and this region is allowed exactly one.
 *
 * The field is as wide as the widest pair among the rows actually listed, and those columns come out of
 * the title budget: at eighty columns the widest pair in the corpus is `20 discovered`, which leaves
 * thirty six columns for a title against the thirty nine a bare basis word would have left. That is the
 * trade named. Two of a title's words buy the sample size of every row.
 */
const basisField = (finding: Finding): string => `${finding.evidence.length} ${finding.basis}`;

/**
 * Colour reinforces the symbol and word already on the row. Under plain style every painter is identity,
 * so NO_COLOR and pipes keep the same glyphs.
 */
const paintSeverity = (style: Style, severity: Severity): string => {
  const label = `! ${severity}`;
  if (severity === 'critical' || severity === 'high') return style.bad(label);
  if (severity === 'medium') return style.warn(label);
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
  /*
   * A caveat renders at column one, full width, ignoring the key anchor, because it qualifies the whole
   * region rather than any row in it. It is seventy nine characters and has never rendered on the
   * corpus only because the one repository with no risk finding also has no agent system, so it drew no
   * frame; inside the frame it would not have fitted. It is never shortened: what it guards against is a
   * reader taking an empty list for a clean bill of health.
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
   * One overflow line, never more. It names the remainder and where the rest of them are, and it does
   * not restate the strength count: that is in the heading sentence, one line above, and stating it
   * twice is how the count came to be stated three times before. Agents read the full set from
   * `--json` or MCP; the terminal does not pretend to be that list.
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
