/**
 * Defensive loading of a report bundle.
 *
 * The page is handed a JSON document by a local server or by a standalone export. It is validated
 * shallowly before anything renders: a malformed bundle produces a readable explanation rather than
 * a blank page, and a bundle that is merely incomplete renders with the gaps named.
 */

import type { ReportBundle } from '@orchescope/schema';

export const REPORT_ELEMENT_ID = 'orchescope-report';
export const REPORT_ENDPOINT = '/api/report';

/**
 * Split so that a substitution pass over the built assets cannot accidentally rewrite this constant
 * inside the script bundle. Only `index.html` is meant to carry the placeholder.
 */
export const REPORT_PLACEHOLDER = `__ORCHESCOPE${'_'}REPORT__`;

/** Array fields that are safe to default to empty, with the gap reported to the reader. */
const OPTIONAL_ARRAYS = [
  'findings',
  'evidence',
  'runs',
  'scenarios',
  'scenarioRuns',
  'componentMetrics',
  'overlays',
  'benchmarks',
  'chaosReports',
  'comparisons',
  'goals',
  'capabilities',
] as const;

export interface BundleLoadOk {
  readonly ok: true;
  readonly bundle: ReportBundle;
  /** Fields that were absent and were defaulted, so the UI can say the data is partial. */
  readonly repaired: readonly string[];
}

export interface BundleLoadError {
  readonly ok: false;
  readonly problems: readonly string[];
}

export type BundleLoad = BundleLoadOk | BundleLoadError;

export function isPlaceholder(text: string): boolean {
  return text.trim() === REPORT_PLACEHOLDER;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkGraph(graph: unknown, problems: string[]): void {
  if (!isRecord(graph)) {
    problems.push('`graph` is missing or is not an object.');
    return;
  }
  if (!Array.isArray(graph['components'])) {
    problems.push('`graph.components` is missing or is not an array.');
  }
  if (!Array.isArray(graph['edges'])) {
    problems.push('`graph.edges` is missing or is not an array.');
  }
  if (!isRecord(graph['coverage'])) {
    problems.push('`graph.coverage` is missing or is not an object.');
  }
  if (!isRecord(graph['provenance'])) {
    problems.push('`graph.provenance` is missing or is not an object.');
  }
}

const SUMMARY_COUNTS = [
  'componentCount',
  'edgeCount',
  'observedComponentCount',
  'staticOnlyComponentCount',
  'runtimeOnlyComponentCount',
  'strengthCount',
  'runCount',
  'scenarioCount',
] as const;

function checkSummary(summary: unknown, problems: string[]): void {
  if (!isRecord(summary)) {
    problems.push('`summary` is missing or is not an object.');
    return;
  }
  for (const key of SUMMARY_COUNTS) {
    if (typeof summary[key] !== 'number') {
      problems.push(`\`summary.${key}\` is missing or is not a number.`);
    }
  }
  if (!isRecord(summary['findingCountBySeverity'])) {
    problems.push('`summary.findingCountBySeverity` is missing or is not an object.');
  }
}

function checkIdentity(value: Record<string, unknown>, problems: string[]): void {
  if (typeof value['schemaVersion'] !== 'number') {
    problems.push('`schemaVersion` is missing or is not a number.');
  }
  if (typeof value['reportId'] !== 'string' || value['reportId'].length === 0) {
    problems.push('`reportId` is missing or is empty.');
  }
  if (typeof value['projectName'] !== 'string' || value['projectName'].length === 0) {
    problems.push('`projectName` is missing or is empty.');
  }
  if (typeof value['generatedAt'] !== 'string' || value['generatedAt'].length === 0) {
    problems.push('`generatedAt` is missing or is empty.');
  }
}

/**
 * Shallow structural validation. This is not schema validation: the authoritative validator lives in
 * the schema package and runs before the bundle is written. This check exists so the page fails
 * legibly when it is handed something else entirely.
 */
export function validateBundle(value: unknown): BundleLoad {
  if (!isRecord(value)) {
    return { ok: false, problems: ['The report is not a JSON object.'] };
  }
  const problems: string[] = [];
  checkIdentity(value, problems);
  checkGraph(value['graph'], problems);
  checkSummary(value['summary'], problems);
  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const repaired: string[] = [];
  const filled: Record<string, unknown> = { ...value };
  for (const key of OPTIONAL_ARRAYS) {
    if (!Array.isArray(filled[key])) {
      filled[key] = [];
      repaired.push(key);
    }
  }
  if (!isRecord(filled['metadata'])) {
    filled['metadata'] = {};
    repaired.push('metadata');
  }
  return { ok: true, bundle: filled as unknown as ReportBundle, repaired };
}

export function parseBundleJson(text: string): BundleLoad {
  if (text.trim().length === 0) {
    return { ok: false, problems: ['The report document is empty.'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, problems: [`The report document is not valid JSON: ${detail}`] };
  }
  return validateBundle(parsed);
}
