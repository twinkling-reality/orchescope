/**
 * The reconciliation: how much of the system a run has ever reached, and the four deltas.
 *
 * This is the join the product exists to compute, so it gets its own key and its own region rather than
 * being folded into a step's sentence. It renders only when a run has been ingested. When none has, the
 * MEASURE step already prices that absence, names how many checks it blocks and carries the command
 * that lifts it, so a second copy here would be one absence reported as two faults.
 */

import { formatCount } from '@orchescope/domain';
import type { AuditResult } from '@orchescope/usecases';
import type { Region, Row } from './document-grid.ts';

type Reconciliation = NonNullable<AuditResult['reconciliation']>;

/**
 * The fraction, labelled for the set it actually counts.
 *
 * `declaredComponents` counts every component a run could have reached, which on a repository with an
 * undeclared component includes one nothing declared. Calling that set the declared parts would be
 * false of it, and quietly correcting the pair to exclude it would contradict the finding whose own
 * explanation text states the uncorrected pair. So the number is printed for the set it counts and no
 * percentage is derived from it: a rate printed beside a fraction is the same measurement twice, and a
 * rate printed only when it flatters is worse than either.
 */
const fractionRow = (delta: Reconciliation): Row => ({
  kind: 'keyed',
  key: 'join',
  text: `${delta.coverage.exercisedComponents} of ${delta.coverage.declaredComponents} parts a run could reach`,
});

/**
 * One row per delta, each keeping the noun the product uses for it everywhere else.
 *
 * `1 duplicated` does not say what was duplicated, and three surfaces using three names for one delta is
 * how a reader stops believing any of them. Four rows rather than one packed line because the phrases
 * are what makes them mean anything, and four counts with their nouns do not fit a single line at
 * eighty columns once any of them reaches four figures.
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
  ].map((text) => ({ kind: 'keyed', key: 'join', text }) as const);

/**
 * Five lines, fixed, or none.
 *
 * One for the fraction and one for each of the four deltas. None at all when no run has been ingested,
 * and that absence is not a silent one: the MEASURE step states it, and an empty region may not stand in
 * for a refusal.
 */
export const joinRegion = (reconciliation: AuditResult['reconciliation']): Region =>
  reconciliation === undefined ? [] : [fractionRow(reconciliation), ...deltaRows(reconciliation)];
