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
import { unitMeter } from './unit-meter.ts';

type Reconciliation = NonNullable<AuditResult['reconciliation']>;

/**
 * The fraction, labelled for the declared set the coverage pair counts.
 *
 * Undeclared components sit in the four deltas, not in this denominator. No percentage is printed
 * beside the fraction: a rate next to a fraction is the same measurement twice, and a rate printed
 * only when it flatters is worse than either. When the declared count fits a unit meter, a second row
 * draws one cell per declared component so the glance weighs filled against empty without a score.
 */
const fractionRows = (delta: Reconciliation): readonly Row[] => {
  const exercised = delta.coverage.exercisedComponents;
  const declared = delta.coverage.declaredComponents;
  const rows: Row[] = [
    {
      kind: 'keyed',
      key: 'system',
      text: `${exercised} of ${declared} declared components exercised`,
    },
  ];
  const meter = unitMeter(exercised, declared);
  if (meter !== undefined) {
    rows.push({ kind: 'keyed', key: 'system', text: meter });
  }
  return rows;
};

/**
 * One row per delta, each keeping the noun the product uses for it everywhere else.
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
 * Fraction, optional unit meter, four deltas; or none.
 *
 * None at all when no run has been recorded, and that absence is not a silent one: the MEASURE step
 * states it, and an empty region may not stand in for a refusal.
 */
export const joinRegion = (reconciliation: AuditResult['reconciliation']): Region =>
  reconciliation === undefined
    ? []
    : [...fractionRows(reconciliation), ...deltaRows(reconciliation)];
