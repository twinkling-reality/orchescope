/**
 * What this report found, split into the good news and the bad, and broken down by how serious it is.
 *
 * The Overview used to lead with how much of the system a run had reached, which is a fact about the
 * quality of our own measurement rather than a fact about the reader's system. A count of problems is
 * the other kind: it is about them, it has a breakdown worth drawing, and it has a most serious member
 * worth naming. The join has not gone anywhere; it is a tile further down.
 *
 * The split is the bundle's own `polarity`, so this module counts and orders and invents nothing. Both
 * sides are always built, including the empty one, because the control that switches between them has
 * to know whether the other side has anything in it before a reader presses it.
 */

import type { Finding } from '@orchescope/schema';
import { describeSeverity, SEVERITY_ORDER } from './basis.ts';
import { sortFindingsForAction } from './filters.ts';

export type Polarity = 'risk' | 'strength';

export interface SeveritySlice {
  readonly severity: string;
  readonly label: string;
  readonly count: number;
  /** Of the whole set, between 0 and 1. Zero slices are dropped, so this is never zero. */
  readonly share: number;
}

export interface FindingMix {
  readonly polarity: Polarity;
  readonly total: number;
  /** Worst first, and a severity nothing falls into is left out rather than drawn at zero width. */
  readonly slices: readonly SeveritySlice[];
  /** The one a reader should look at first, or null when the set is empty. */
  readonly worst: Finding | null;
  /** How many of them carry enough to hand straight to somebody. */
  readonly ready: number;
}

/**
 * A severity this build does not rank still gets counted, at the end, under its own name. Dropping it
 * would make the slices add up to less than the total, which is a picture that quietly disagrees with
 * the number above it.
 */
function orderSeverities(findings: readonly Finding[]): readonly string[] {
  const present = new Set(findings.map((finding) => finding.severity));
  const known = SEVERITY_ORDER.filter((severity) => present.has(severity));
  const unranked = [...present]
    .filter((severity) => !SEVERITY_ORDER.includes(severity as (typeof SEVERITY_ORDER)[number]))
    .sort();
  return [...known, ...unranked];
}

/**
 * Rules that report on this report rather than on the reader's system.
 *
 * `observability-coverage` fires on twelve of the sixteen cached reports and says "No runtime evidence
 * has been collected". On `flask`, `express` and `axios` it is the **only** finding in the bundle, so
 * the whole document was staged around it: a severity, a basis, an evidence count, a title, an impact
 * sentence and a disclosure, all to say the thing the preamble and the next action had each already
 * said. Four sentences for one fact, in the largest type on the screen.
 *
 * It is a true finding and it stays in the list, in the counts and in `--json`. It just cannot be the
 * thing the screen leads with, because leading with it is the fault the record already names: a fact
 * about the quality of our own measurement is not a fact about the reader's system.
 *
 * This is a selection over a bundle field, not a second analysis: the rule ids are read off the
 * findings the engine produced.
 */
const REPORTS_ON_THE_REPORT: ReadonlySet<string> = new Set(['observability-coverage']);

export function aboutTheReader(finding: Finding): boolean {
  return !REPORTS_ON_THE_REPORT.has(finding.ruleId);
}

export function buildFindingMix(findings: readonly Finding[], polarity: Polarity): FindingMix {
  const matching = findings.filter((finding) => finding.polarity === polarity);
  const total = matching.length;
  const slices = orderSeverities(matching)
    .map((severity) => {
      const count = matching.filter((finding) => finding.severity === severity).length;
      return {
        severity,
        label: describeSeverity(severity).label,
        count,
        share: count / total,
      };
    })
    .filter((slice) => slice.count > 0);
  const [worst] = sortFindingsForAction(matching.filter(aboutTheReader));
  return {
    polarity,
    total,
    slices,
    worst: worst ?? null,
    ready: matching.filter((finding) => finding.goalReadiness.eligible).length,
  };
}

export function buildFindingMixes(
  findings: readonly Finding[],
): Readonly<Record<Polarity, FindingMix>> {
  return {
    risk: buildFindingMix(findings, 'risk'),
    strength: buildFindingMix(findings, 'strength'),
  };
}
