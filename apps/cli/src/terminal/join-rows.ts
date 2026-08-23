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
  for (const missing of delta.coverage.missingSpanAttributes ?? []) {
    const exactSourceIdentity =
      missing.purpose === 'source_identity' || missing.purpose === 'code_location';
    rows.push({
      kind: 'keyed',
      key: 'system',
      text: `${formatCount(missing.observedComponents, 'part')} ${missing.observedComponents === 1 ? 'lacks' : 'lack'} ${missing.attribute}; ${exactSourceIdentity ? 'exact source identity unavailable' : 'join unavailable'}`,
    });
  }
  if (delta.joins.byKindAndName > 0) {
    rows.push({
      kind: 'keyed',
      key: 'system',
      text: `${formatCount(delta.joins.byKindAndName, 'part')} joined by heuristic kind and name only`,
    });
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
    `${formatCount(missing, 'part')} ran without an exact static identity match`,
    `${formatCount(disagreements, 'place')} where the code and a run disagreed`,
    `${formatCount(duplicates, 'outside effect')} that happened twice in one run`,
  ].map((text) => ({ kind: 'keyed', key: 'system', text }) as const);
};

const behavioralRows = (delta: Reconciliation): readonly Row[] => {
  const account = delta.behavioralAccount;
  if (account === undefined || account.executedComponents === 0) return [];
  if (delta.coverage.edgeExerciseRate !== 0) return [];
  const structural =
    account.observedStructuralRelations === 0
      ? account.status === 'complete'
        ? 'complete accepted population contained no independent structural relation'
        : 'accepted subset reported 0 independent structural relations'
      : `${formatCount(account.observedStructuralRelations, 'independent structural relation')} observed`;
  const rows: Row[] = [
    {
      kind: 'keyed',
      key: 'behavior',
      text: `${formatCount(account.executedComponents, 'part')} executed in accepted subset of ${formatCount(account.acceptedSpans, 'span')}`,
    },
    {
      kind: 'keyed',
      key: 'behavior',
      text: structural,
    },
    {
      kind: 'keyed',
      key: 'behavior',
      text: '0 declared relations qualified for the strict exercise rate',
    },
  ];
  if (account.status === 'incomplete' || account.droppedSpans > 0 || account.rejectedSpans > 0) {
    rows.push({
      kind: 'keyed',
      key: 'behavior',
      text: `account incomplete: ${formatCount(account.droppedSpans, 'span')} dropped, ${formatCount(account.rejectedSpans, 'span')} rejected`,
    });
  }
  return rows;
};

/**
 * Verbose only. Empty when there is no reconciliation, or when the caller is drawing the glance.
 */
export const joinRegion = (
  reconciliation: AuditResult['reconciliation'],
  verbose = false,
): Region => {
  if (reconciliation === undefined) return [];
  const behavior = behavioralRows(reconciliation);
  if (!verbose) return behavior;
  return [...behavior, ...fractionRows(reconciliation), ...deltaRows(reconciliation)];
};
