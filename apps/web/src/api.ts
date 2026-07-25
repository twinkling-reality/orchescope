/**
 * The contract between this page and the local report server.
 *
 * Every request is a POST to a fixed path with a small JSON body and is only ever issued when the
 * matching capability in the bundle says it is available. Responses are parsed defensively: a server
 * that answers with something unexpected produces a visible message rather than a silent no-op.
 */

export const ENDPOINTS = {
  report: '/api/report',
  goals: '/api/goals',
  scenarioRuns: '/api/scenario-runs',
  comparisons: '/api/comparisons',
  openLocation: '/api/open-location',
} as const;

export interface CreateGoalRequest {
  readonly findingId: string;
}

export interface CreateGoalResult {
  readonly goalId: string;
}

export interface RerunScenarioRequest {
  readonly scenarioId: string;
}

export interface RerunScenarioResult {
  readonly runId: string;
  readonly status: string | null;
}

export interface CreateComparisonRequest {
  readonly findingId: string;
  readonly scenarioId?: string;
}

export interface CreateComparisonResult {
  readonly comparisonId: string;
  readonly verdict: string | null;
}

export interface OpenLocationRequest {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}

export interface OpenLocationResult {
  readonly opened: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readString(value: unknown, key: string): string | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const raw = record[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Accepts `error`, then `message`, then `detail`, so any of the usual server shapes is surfaced. */
export function extractServerMessage(value: unknown): string | null {
  return (
    readString(value, 'error') ??
    readString(value, 'message') ??
    readString(value, 'detail') ??
    null
  );
}

export function parseCreateGoal(value: unknown): CreateGoalResult | null {
  const record = asRecord(value);
  const direct = readString(value, 'goalId');
  if (direct !== null) {
    return { goalId: direct };
  }
  const nested = record === null ? null : readString(record['goal'], 'id');
  return nested === null ? null : { goalId: nested };
}

export function parseRerunScenario(value: unknown): RerunScenarioResult | null {
  const runId = readString(value, 'runId');
  if (runId === null) {
    return null;
  }
  return { runId, status: readString(value, 'status') };
}

export function parseCreateComparison(value: unknown): CreateComparisonResult | null {
  const record = asRecord(value);
  const comparisonId =
    readString(value, 'comparisonId') ??
    (record === null ? null : readString(record['comparison'], 'id'));
  if (comparisonId === null) {
    return null;
  }
  const verdict =
    readString(value, 'verdict') ??
    (record === null ? null : readString(record['comparison'], 'verdict'));
  return { comparisonId, verdict };
}

export function parseOpenLocation(value: unknown): OpenLocationResult | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const opened = record['opened'];
  if (typeof opened !== 'boolean') {
    return null;
  }
  return { opened };
}
