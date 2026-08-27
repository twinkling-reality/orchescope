import { OrchescopeError } from '@orchescope/domain';

/**
 * Row readers and the summary shapes a listing returns.
 *
 * A text column that is not text means the row does not match the schema this build wrote, which is corruption rather
 * than a missing value, so it is reported as such instead of being coerced into an empty string.
 */

export type ScanSummary = {
  readonly scanId: string;
  readonly graphId: string;
  readonly createdAt: string;
  readonly componentCount: number;
  readonly edgeCount: number;
  readonly gitCommit: string | undefined;
  readonly gitRef: string | undefined;
  readonly gitDirty: boolean;
  readonly digest: string;
};

export type RunSummary = {
  readonly runId: string;
  readonly kind: string;
  readonly label: string;
  readonly status: string;
  readonly startedAt: string;
  readonly scenarioId: string | undefined;
  readonly variantId: string | undefined;
  /**
   * The fault plan the run was made under, which is a condition of the measurement and not a label on it.
   *
   * A summary that carried the variant but not this could not tell a caller whether two runs measured the
   * same thing, so a caller comparing them had to read every full record back or compare them anyway.
   */
  readonly faultPlanId: string | undefined;
  readonly experimentId: string | undefined;
};

/**
 * A run that executed components a caller asked about, with how many of them it executed.
 *
 * The count is what lets a caller prefer the recorded work that covers more of what a finding is about.
 * A run that touched one of six components and a run that touched all six are both matches, and treating
 * them as equal would pick a baseline that measured a sixth of the thing being changed.
 */
export type ExercisingRun = RunSummary & {
  readonly exercisedComponents: number;
};

export const text = (row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new OrchescopeError('STORE_CORRUPT', `Column ${column} was not text.`, {
      detail: { column, type: typeof value },
    });
  }
  return value;
};

export const optionalText = (row: Record<string, unknown>, column: string): string | undefined => {
  const value = row[column];
  return typeof value === 'string' ? value : undefined;
};

export const integer = (row: Record<string, unknown>, column: string): number => {
  const value = row[column];
  return typeof value === 'number' ? value : 0;
};
