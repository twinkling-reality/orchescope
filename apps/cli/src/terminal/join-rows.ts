/**
 * The reconciliation: how much of the declared system a run has ever reached, and the four deltas.
 *
 * This is the join the product exists to compute. The surface key is `system`, not `join`, so a human
 * glance meets the thing being measured rather than the engine verb for measuring it. The region still
 * renders only when a run has been recorded. When none has, the MEASURE step already prices that
 * absence, names how many checks it blocks and carries the command that lifts it, so a second copy
 * here would be one absence reported as two faults.
 */

import { formatCount } from '@orchescope/domain';
import type { AuditResult } from '@orchescope/usecases';
import type { Region, Row } from './document-grid.ts';

type Reconciliation = NonNullable<AuditResult['reconciliation']>;

/**
 * The fraction, labelled for the declared set the coverage pair counts.
 *
 * Undeclared components sit in the four deltas, not in this denominator. No percentage is printed
 * beside the fraction: a rate next to a fraction is the same measurement twice, and a rate printed
 * only when it flatters is worse than either.
 */
const fractionRow = (delta: Reconciliation): Row => ({
  kind: 'keyed',
  key: 'system',
  text: `${delta.coverage.exercisedComponents} of ${delta.coverage.declaredComponents} declared components exercised`,
});

/**
 * One row per delta, each keeping the noun the product uses for it everywhere else.
 *
 * Packing the four phrases onto fewer lines forced shortened nouns (`declared never exercised`) that
 * no longer matched finding text and MCP delta summaries. Full nouns on four rows win: a reader who
 * has just been told what was found should meet the same words in the join. Eighty columns still
 * hold each row for ordinary counts; when a count grows past that, the grid cuts the line rather than
 * the product renaming the delta.
 *
 * A delta of zero renders. A zero here is as much news as a one: it is the difference between a
 * contradiction nobody found and a contradiction nobody looked for, and the reader can tell which
 * because the region only renders when a run was reconciled.
 */
const deltaRows = (delta: Reconciliation): readonly Row[] =>
  [
    `${formatCount(delta.declaredNotExercised.components.length, 'declared component')} never exercised`,
    `${formatCount(delta.exercisedNotDeclared.components.length, 'exercised component')} never declared`,
    formatCount(delta.contradictions.length, 'contradicted declaration'),
    formatCount(delta.duplicateSideEffects.length, 'duplicated external effect'),
  ].map((text) => ({ kind: 'keyed', key: 'system', text }) as const);

/**
 * Five lines, fixed, or none.
 *
 * One for the fraction and one for each of the four deltas. None at all when no run has been recorded,
 * and that absence is not a silent one: the MEASURE step states it, and an empty region may not stand
 * in for a refusal.
 */
export const joinRegion = (reconciliation: AuditResult['reconciliation']): Region =>
  reconciliation === undefined ? [] : [fractionRow(reconciliation), ...deltaRows(reconciliation)];
