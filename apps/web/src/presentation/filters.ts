/**
 * Filtering, grouping and sorting. Kept pure so the behaviour the reader depends on when they narrow a
 * large report is covered by tests rather than by clicking.
 */

import type { Component, ComponentRunMetrics, Edge, Finding } from '@orchescope/schema';
import { severityRank } from './basis.ts';

export function matchesQuery(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return haystack.toLowerCase().includes(needle);
}

/** Total order over strings that does not depend on the machine's locale. */
export function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

export interface FindingFilter {
  readonly severities: readonly string[];
  readonly categories: readonly string[];
  readonly polarities: readonly string[];
  readonly bases: readonly string[];
  readonly goalReadiness: readonly string[];
  readonly query: string;
}

export const EMPTY_FINDING_FILTER: FindingFilter = {
  severities: [],
  categories: [],
  polarities: [],
  bases: [],
  goalReadiness: [],
  query: '',
};

function allows(selected: readonly string[], value: string): boolean {
  return selected.length === 0 || selected.includes(value);
}

function findingHaystack(finding: Finding): string {
  return [
    finding.id,
    finding.title,
    finding.explanation,
    finding.impact,
    finding.ruleId,
    ...finding.components,
    ...finding.tags,
    ...finding.taxonomy,
  ].join(' ');
}

export function filterFindings(
  findings: readonly Finding[],
  filter: FindingFilter,
): readonly Finding[] {
  return findings.filter(
    (finding) =>
      allows(filter.severities, finding.severity) &&
      allows(filter.categories, finding.category) &&
      allows(filter.polarities, finding.polarity) &&
      allows(filter.bases, finding.basis) &&
      allows(filter.goalReadiness, finding.goalReadiness.eligible ? 'eligible' : 'not_eligible') &&
      matchesQuery(findingHaystack(finding), filter.query),
  );
}

/** Highest severity first, then most confident, then by identifier so the order is stable. */
export function sortFindings(findings: readonly Finding[]): readonly Finding[] {
  return [...findings].sort((left, right) => {
    const bySeverity = severityRank(right.severity) - severityRank(left.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byConfidence = right.confidence - left.confidence;
    if (byConfidence !== 0) {
      return byConfidence;
    }
    return compareStrings(left.id, right.id);
  });
}

/**
 * The order for a work queue. A finding that can become a bounded, verifiable goal comes before one
 * that still needs runtime evidence or a design decision. Severity and confidence retain their
 * existing order within each group.
 */
export function sortFindingsForAction(findings: readonly Finding[]): readonly Finding[] {
  return [...findings].sort((left, right) => {
    const byEligibility =
      Number(right.goalReadiness.eligible) - Number(left.goalReadiness.eligible);
    if (byEligibility !== 0) {
      return byEligibility;
    }
    const bySeverity = severityRank(right.severity) - severityRank(left.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byConfidence = right.confidence - left.confidence;
    if (byConfidence !== 0) {
      return byConfidence;
    }
    return compareStrings(left.id, right.id);
  });
}

export function countValues<T>(
  items: readonly T[],
  pick: (item: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = pick(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function distinctValues<T>(
  items: readonly T[],
  pick: (item: T) => string,
): readonly string[] {
  return [...new Set(items.map(pick))].sort(compareStrings);
}

export interface ComponentFilter {
  readonly query: string;
  readonly kinds: readonly string[];
}

export const EMPTY_COMPONENT_FILTER: ComponentFilter = { query: '', kinds: [] };

function componentHaystack(component: Component): string {
  return [
    component.id,
    component.displayName,
    component.kind,
    component.description ?? '',
    component.identity.namespace,
    component.identity.localName,
    ...component.tags,
    ...component.sourceLocations.map((location) => location.file),
    ...component.configLocations.map((location) => location.file),
  ].join(' ');
}

export function filterComponents(
  components: readonly Component[],
  filter: ComponentFilter,
): readonly Component[] {
  return components.filter(
    (component) =>
      allows(filter.kinds, component.kind) &&
      matchesQuery(componentHaystack(component), filter.query),
  );
}

/** An edge survives only when its kind is selected and both endpoints are still visible. */
export function filterEdges(
  edges: readonly Edge[],
  edgeKinds: readonly string[],
  visibleComponentIds: ReadonlySet<string>,
): readonly Edge[] {
  return edges.filter(
    (edge) =>
      allows(edgeKinds, edge.kind) &&
      visibleComponentIds.has(edge.from) &&
      visibleComponentIds.has(edge.to),
  );
}

export interface MetricRow {
  readonly componentId: string;
  readonly displayName: string;
  readonly kind: string;
  readonly executionCount: number;
  readonly selfDurationMs: number;
  readonly totalDurationMs: number;
  readonly p95DurationMs: number | null;
  readonly tokens: number;
  readonly costUsd: number | null;
  readonly errorCount: number;
  readonly retryCount: number;
}

export interface ComponentLabel {
  readonly displayName: string;
  readonly kind: string;
}

export function buildMetricRows(
  metrics: readonly ComponentRunMetrics[],
  describe: (componentId: string) => ComponentLabel,
): readonly MetricRow[] {
  return metrics.map((metric) => {
    const label = describe(metric.componentId);
    return {
      componentId: metric.componentId,
      displayName: label.displayName,
      kind: label.kind,
      executionCount: metric.executionCount,
      selfDurationMs: metric.selfDurationMs,
      totalDurationMs: metric.totalDurationMs,
      p95DurationMs: metric.p95DurationMs ?? null,
      tokens: metric.inputTokens + metric.outputTokens,
      costUsd: metric.costUsd ?? null,
      errorCount: metric.errorCount,
      retryCount: metric.retryCount,
    };
  });
}

export const METRIC_SORT_KEYS = [
  'displayName',
  'executionCount',
  'selfDurationMs',
  'totalDurationMs',
  'tokens',
  'costUsd',
  'errorCount',
] as const;

export type MetricSortKey = (typeof METRIC_SORT_KEYS)[number];

function metricSortValue(row: MetricRow, key: MetricSortKey): number | string {
  switch (key) {
    case 'displayName':
      return row.displayName;
    case 'executionCount':
      return row.executionCount;
    case 'selfDurationMs':
      return row.selfDurationMs;
    case 'totalDurationMs':
      return row.totalDurationMs;
    case 'tokens':
      return row.tokens;
    case 'costUsd':
      return row.costUsd ?? Number.NEGATIVE_INFINITY;
    case 'errorCount':
      return row.errorCount;
    default:
      return 0;
  }
}

function compareMetricRows(
  left: MetricRow,
  right: MetricRow,
  key: MetricSortKey,
  direction: number,
): number {
  const a = metricSortValue(left, key);
  const b = metricSortValue(right, key);
  const primary =
    typeof a === 'string' || typeof b === 'string'
      ? compareStrings(String(a), String(b))
      : Math.sign(a - b);
  return primary * direction || compareStrings(left.componentId, right.componentId);
}

/**
 * Sorts by one column, breaking ties on the component identifier so that two components with the same
 * measurement never swap places between renders.
 */
export function sortMetricRows(
  rows: readonly MetricRow[],
  key: MetricSortKey,
  ascending: boolean,
): readonly MetricRow[] {
  const direction = ascending ? 1 : -1;
  return [...rows].sort((left, right) => compareMetricRows(left, right, key, direction));
}

export interface BarRow {
  readonly componentId: string;
  readonly label: string;
  readonly value: number;
  /** Share of the largest value in the set, on the unit interval, for the bar width. */
  readonly share: number;
}

/** Descending bar rows. The share is relative to the largest value present, not to a fixed ceiling. */
export function buildBarRows(
  entries: readonly { readonly componentId: string; readonly value: number }[],
  describe: (componentId: string) => string,
): readonly BarRow[] {
  const finite = entries.filter((entry) => Number.isFinite(entry.value));
  const max = finite.reduce((peak, entry) => Math.max(peak, entry.value), 0);
  return finite
    .map((entry) => ({
      componentId: entry.componentId,
      label: describe(entry.componentId),
      value: entry.value,
      share: max > 0 ? Math.min(1, Math.max(0, entry.value / max)) : 0,
    }))
    .sort(
      (left, right) =>
        right.value - left.value || compareStrings(left.componentId, right.componentId),
    );
}

export interface ReasonGroup {
  readonly reason: string;
  readonly count: number;
  readonly examples: readonly string[];
}

const MAX_EXAMPLES = 5;

/** Groups skipped files by reason, keeping a bounded sample so the block stays readable. */
export function groupByReason(
  entries: readonly { readonly reason: string; readonly file: string }[],
): readonly ReasonGroup[] {
  const byReason = new Map<string, string[]>();
  for (const entry of entries) {
    const bucket = byReason.get(entry.reason);
    if (bucket === undefined) {
      byReason.set(entry.reason, [entry.file]);
    } else {
      bucket.push(entry.file);
    }
  }
  return [...byReason]
    .map(([reason, files]) => ({
      reason,
      count: files.length,
      examples: files.slice(0, MAX_EXAMPLES),
    }))
    .sort((left, right) => right.count - left.count || compareStrings(left.reason, right.reason));
}
