/**
 * How much of the code a run actually touched.
 *
 * Default glance hides this region: the words "declared" and "exercised" are graph talk, and the
 * findings plus the next command already answer what to do. `--verbose` shows the same facts in plain
 * language, with an honest unit meter when the declared count fits on one line.
 */

import { formatCount } from '@orchescope/domain';
import type { AuditResult } from '@orchescope/usecases';
import type { Region, Row } from './document-grid.ts';
import { unitMeter } from './unit-meter.ts';

type Reconciliation = NonNullable<AuditResult['reconciliation']>;

const fractionRows = (delta: Reconciliation): readonly Row[] => {
  const exercised = delta.coverage.exercisedComponents;
  const declared = delta.coverage.declaredComponents;
  const rows: Row[] = [
    {
      kind: 'keyed',
      key: 'system',
      text: `${exercised} of ${declared} parts in the code showed up in a run`,
    },
  ];
  const meter = unitMeter(exercised, declared);
  if (meter !== undefined) {
    rows.push({ kind: 'keyed', key: 'system', text: meter });
  }
  return rows;
};

const deltaRows = (delta: Reconciliation): readonly Row[] => {
  const neverRan = delta.declaredNotExercised.components.length;
  const missing = delta.exercisedNotDeclared.components.length;
  const disagreements = delta.contradictions.length;
  const duplicates = delta.duplicateSideEffects.length;
  return [
    `${formatCount(neverRan, 'part')} in the code never ran`,
    `${formatCount(missing, 'part')} ran without being in the code`,
    `${formatCount(disagreements, 'place')} where the code and a run disagreed`,
    `${formatCount(duplicates, 'outside effect')} that happened twice in one run`,
  ].map((text) => ({ kind: 'keyed', key: 'system', text }) as const);
};

/**
 * Verbose only. Empty when there is no reconciliation, or when the caller is drawing the glance.
 */
export const joinRegion = (
  reconciliation: AuditResult['reconciliation'],
  verbose = false,
): Region => {
  if (!verbose || reconciliation === undefined) return [];
  return [...fractionRows(reconciliation), ...deltaRows(reconciliation)];
};
