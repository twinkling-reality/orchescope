import type { FindingCategory } from '@orchescope/schema';
import { shortHash, shortHashOfJson } from './hash.ts';

/**
 * Identifier construction.
 *
 * Every identifier is derived from explicit inputs rather than a random source, so the same audit of
 * the same tree produces the same identifiers. Tests therefore compare whole documents without
 * masking, and two machines can talk about the same scan.
 */

export const projectId = (repositoryPathHash: string): string =>
  `prj_${repositoryPathHash.slice(0, 16)}`;

export const scanId = (input: {
  readonly projectId: string;
  readonly startedAt: string;
  readonly sourceDigest: string;
}): string => `scan_${shortHashOfJson(input)}`;

export const graphId = (input: {
  readonly scanId: string;
  readonly componentCount: number;
  readonly edgeCount: number;
  readonly contentDigest: string;
}): string => `graph_${shortHashOfJson(input)}`;

export const runId = (input: {
  readonly projectId: string;
  readonly kind: string;
  readonly label: string;
  readonly startedAt: string;
  readonly sequence: number;
}): string => `run_${shortHashOfJson(input)}`;

export const evidenceId = (evidenceWithoutId: unknown): string =>
  `ev_${shortHashOfJson(evidenceWithoutId)}`;

export const faultPlanId = (input: { readonly seed: number; readonly faults: unknown }): string =>
  `fp_${shortHashOfJson(input)}`;

export const benchmarkId = (input: {
  readonly scenarioId: string;
  readonly dimension: string;
  readonly startedAt: string;
}): string => `bench_${shortHashOfJson(input)}`;

export const chaosReportId = (input: {
  readonly scenarioId: string;
  readonly startedAt: string;
}): string => `chaos_${shortHashOfJson(input)}`;

export const comparisonId = (input: {
  readonly baseline: string;
  readonly candidate: string;
  readonly createdAt: string;
}): string => `cmp_${shortHashOfJson(input)}`;

export const scenarioResultId = (input: {
  readonly scenarioId: string;
  readonly startedAt: string;
}): string => `sres_${shortHashOfJson(input)}`;

export const reportId = (input: {
  readonly scanId: string;
  readonly generatedAt: string;
  readonly runIds: readonly string[];
}): string => `rpt_${shortHashOfJson(input)}`;

export const artifactRef = (content: string | Uint8Array): string => shortHash(content, 64);

const CATEGORY_ABBREVIATIONS: Readonly<Record<FindingCategory, string>> = {
  architecture: 'ARCH',
  performance: 'PERF',
  cost: 'COST',
  reliability: 'REL',
  resilience: 'RES',
  security: 'SEC',
  permissions: 'PERM',
  agent_complexity: 'CPLX',
  maintainability: 'MAINT',
  scenario_coverage: 'COV',
  observability: 'OBS',
};

export const findingCategoryAbbreviation = (category: FindingCategory): string =>
  CATEGORY_ABBREVIATIONS[category];

export const goalId = (sequence: number): string => `OSC-GOAL-${String(sequence).padStart(4, '0')}`;

export const parseGoalSequence = (id: string): number | undefined => {
  const match = /^OSC-GOAL-(\d{4})$/.exec(id);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
};
