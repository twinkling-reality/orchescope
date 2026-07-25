import { differenceIsMeaningful, mean } from '@orchescope/domain';
import type { VariantResult } from '@orchescope/schema';

/**
 * What a benchmark report is not allowed to imply.
 *
 * Orchescope never claims statistical significance. It reports what it measured, states how far apart the
 * samples are in units a reader can check, and names every reason the comparison could be misleading: a
 * variant that spent noticeably more compute than another, a sample too small to compare, a quantile that was
 * withheld because too few points existed to compute it.
 */

/** Token totals within this fraction of each other are treated as comparable compute. */
const COMPUTE_TOLERANCE = 0.1;
const RUNS_FOR_A_COMPARISON = 5;

const meanTokens = (variant: VariantResult): number => mean(variant.totalTokens.values) ?? 0;

const computeNormalisationNote = (variants: readonly VariantResult[]): string | undefined => {
  if (variants.length < 2) return undefined;
  const totals = variants.map((variant) => ({
    id: variant.variantId,
    tokens: meanTokens(variant),
  }));
  const lowest = totals.reduce((left, right) => (right.tokens < left.tokens ? right : left));
  const highest = totals.reduce((left, right) => (right.tokens > left.tokens ? right : left));
  if (highest.tokens === 0) return undefined;
  if (lowest.tokens === 0) {
    return `this comparison is not compute normalised: variant ${lowest.id} reported no tokens while variant ${highest.id} reported ${Math.round(highest.tokens)} per run`;
  }
  const difference = (highest.tokens - lowest.tokens) / lowest.tokens;
  if (difference <= COMPUTE_TOLERANCE) return undefined;
  return `this comparison is not compute normalised: variant ${highest.id} used ${Math.round(difference * 100)} percent more tokens per run than variant ${lowest.id}`;
};

const smallSampleNote = (variants: readonly VariantResult[]): string | undefined => {
  const small = variants.filter((variant) => variant.completedRuns < RUNS_FOR_A_COMPARISON);
  if (small.length === 0) return undefined;
  const described = small
    .map((variant) => `${variant.variantId} (${variant.completedRuns} completed)`)
    .join(', ');
  return `fewer than ${RUNS_FOR_A_COMPARISON} completed runs on ${described}, which is too few to compare variants`;
};

const withheldQuantileNote = (variants: readonly VariantResult[]): string | undefined => {
  const names = new Set<string>();
  for (const variant of variants) {
    for (const entry of variant.durationMs.withheld) names.add(entry.quantile);
    for (const entry of variant.totalTokens.withheld) names.add(entry.quantile);
  }
  if (names.size === 0) return undefined;
  return `quantiles ${[...names].sort().join(', ')} are withheld because the samples are smaller than they require`;
};

/**
 * How far apart the first and the last variant are, in units of the combined standard error. Reported as a
 * measurement of the samples, never as a significance test.
 */
const spreadNote = (variants: readonly VariantResult[]): string | undefined => {
  const first = variants[0];
  const last = variants[variants.length - 1];
  if (first === undefined || last === undefined || first === last) return undefined;
  const check = differenceIsMeaningful(first.durationMs.values, last.durationMs.values);
  const relation = check.meaningful
    ? 'larger than the noise in the samples'
    : 'within the noise of the samples';
  return `the duration difference between ${first.variantId} and ${last.variantId} is ${relation}: ${check.reason}`;
};

export const limitationsFor = (variants: readonly VariantResult[]): readonly string[] => {
  const notes = [
    computeNormalisationNote(variants),
    smallSampleNote(variants),
    withheldQuantileNote(variants),
    spreadNote(variants),
    'measured on one machine in one environment, so these numbers compare variants within this report and not across machines',
  ];
  return notes.filter((note): note is string => note !== undefined);
};
