import type { PresentationRefusal } from '../presentation-refusal.ts';

export type DepthSectionId =
  | 'map'
  | 'findings'
  | 'performance'
  | 'resilience'
  | 'scenarios'
  | 'comparisons'
  | 'goals';

/**
 * Three slots, and **each one refuses in its own words**.
 *
 * The shape before this carried two refusals for three slots, so every section rendered
 * `primaryRefusal` in the band and again in the primary slot below it. Measured across the thirteen
 * cached reports that have no run, that produced twenty one refusals carrying eight facts, and on
 * four screens two of the three tiles were the same object with the same title, the same reason and
 * the same command. Goals printed `Nothing has been turned into work somebody can pick up.` twice on
 * fifteen of the sixteen reports.
 *
 * `docs/design/report-system.md` already required the opposite on both counts: the screen level
 * absence belongs to the band, and the commands are "named once, on the band, rather than once on
 * each of the three tiles ... Four copies of one command is a screen that reads as four faults
 * instead of one absence." A third field is what lets a section say that.
 *
 * So the band carries the screen's own statement and the commands that would produce the evidence,
 * and primary and detail each name the absence that belongs to that slot and carry no command,
 * unless the command that would fill that slot differs from the screen's.
 */
export interface SectionPresentation {
  readonly summary: { readonly count: number };
  readonly summaryRefusal: PresentationRefusal | null;
  readonly primaryRefusal: PresentationRefusal | null;
  readonly detailRefusal: PresentationRefusal | null;
}
