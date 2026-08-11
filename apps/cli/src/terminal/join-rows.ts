/**
 * The reconciliation: how much of the declared system a run has ever reached, and the four deltas.
 *
 * This is the join the product exists to compute, so it gets its own key and its own region rather than
 * being folded into a step's sentence. It renders only when a run has been recorded. When none has, the
 * MEASURE step already prices that absence, names how many checks it blocks and carries the command
 * that lifts it, so a second copy here would be one absence reported as two faults.
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
  key: 'join',
  text: `${delta.coverage.exercisedComponents} of ${delta.coverage.declaredComponents} declared components exercised`,
});

/**
 * The four deltas packed onto two lines, each keeping the noun the product uses for it everywhere else.
 *
 * Pairing declared-against-exercised on one line and contradiction-against-duplicate on the next keeps
 * the region short without inventing a percentage or dropping a zero. A zero here is as much news as a
 * one: it is the difference between a contradiction nobody found and a contradiction nobody looked for,
 * and the reader can tell which because the region only renders when a run was reconciled.
 *
 * Two lines rather than one: four counts with their nouns do not fit eighty columns once any of them
 * reaches four figures, and truncating a packed single line would strip the trailing nouns first.
 */
const deltaRows = (delta: Reconciliation): readonly Row[] => {
  const notExercised = delta.declaredNotExercised.components.length;
  const notDeclared = delta.exercisedNotDeclared.components.length;
  const contradictions = delta.contradictions.length;
  const duplicates = delta.duplicateSideEffects.length;
  return [
    `${notExercised} declared never exercised · ${notDeclared} exercised never declared`,
    `${contradictions} contradicted · ${formatCount(duplicates, 'duplicated external effect')}`,
  ].map((text) => ({ kind: 'keyed', key: 'join', text }) as const);
};

/**
 * Three lines, fixed, or none.
 *
 * One for the fraction and two for the four deltas. None at all when no run has been recorded, and that
 * absence is not a silent one: the MEASURE step states it, and an empty region may not stand in for a
 * refusal.
 */
export const joinRegion = (reconciliation: AuditResult['reconciliation']): Region =>
  reconciliation === undefined ? [] : [fractionRow(reconciliation), ...deltaRows(reconciliation)];
