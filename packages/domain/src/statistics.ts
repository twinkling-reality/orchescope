import { type Distribution, QUANTILE_MIN_SAMPLES } from '@orchescope/schema';

/**
 * Summary statistics with explicit honesty about sample size. A p95 computed from four samples is
 * not a p95, so quantiles below their threshold are withheld and the threshold is reported.
 */

type QuantileName = 'p50' | 'p90' | 'p95' | 'p99';

const QUANTILE_FRACTIONS: Readonly<Record<QuantileName, number>> = {
  p50: 0.5,
  p90: 0.9,
  p95: 0.95,
  p99: 0.99,
};

/** Nearest rank quantile on the sorted sample. No interpolation, so the value is always observed. */
export const quantile = (sortedValues: readonly number[], fraction: number): number | undefined => {
  if (sortedValues.length === 0) return undefined;
  const rank = Math.ceil(fraction * sortedValues.length);
  const index = Math.min(sortedValues.length - 1, Math.max(0, rank - 1));
  return sortedValues[index];
};

export const mean = (values: readonly number[]): number | undefined =>
  values.length === 0
    ? undefined
    : values.reduce((total, value) => total + value, 0) / values.length;

export const standardDeviation = (values: readonly number[]): number | undefined => {
  if (values.length < 2) return undefined;
  const average = mean(values);
  if (average === undefined) return undefined;
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

export const summarize = (rawValues: readonly number[]): Distribution => {
  const values = [...rawValues];
  const sorted = [...values].sort((left, right) => left - right);
  const withheld: Distribution['withheld'] = [];
  const quantiles: Partial<Record<QuantileName, number>> = {};

  for (const name of Object.keys(QUANTILE_FRACTIONS) as QuantileName[]) {
    const required = QUANTILE_MIN_SAMPLES[name];
    if (sorted.length >= required) {
      const value = quantile(sorted, QUANTILE_FRACTIONS[name]);
      if (value !== undefined) quantiles[name] = value;
    } else {
      withheld.push({ quantile: name, requiredSamples: required });
    }
  }

  const average = mean(values);
  const deviation = standardDeviation(values);

  return {
    sampleSize: values.length,
    ...(sorted.length > 0 ? { min: sorted[0], max: sorted[sorted.length - 1] } : {}),
    ...(average === undefined ? {} : { mean: average }),
    ...(deviation === undefined ? {} : { stdDev: deviation }),
    ...quantiles,
    withheld,
    values,
  } as Distribution;
};

/**
 * Relative change from baseline to candidate, as a fraction. Returns undefined when the baseline is
 * zero, because "infinite improvement" is not a measurement.
 */
export const relativeChange = (baseline: number, candidate: number): number | undefined =>
  baseline === 0 ? undefined : (candidate - baseline) / baseline;

/**
 * A conservative check for whether two samples differ enough to be worth reporting. Orchescope does
 * not claim statistical significance: this compares the difference of means against the pooled
 * spread and requires a minimum sample count on both sides.
 */
export const differenceIsMeaningful = (
  baseline: readonly number[],
  candidate: readonly number[],
  minimumSamplesPerSide = 5,
): { readonly meaningful: boolean; readonly reason: string } => {
  if (baseline.length < minimumSamplesPerSide || candidate.length < minimumSamplesPerSide) {
    return {
      meaningful: false,
      reason: `needs at least ${minimumSamplesPerSide} samples per side, has ${baseline.length} and ${candidate.length}`,
    };
  }
  const baselineMean = mean(baseline);
  const candidateMean = mean(candidate);
  if (baselineMean === undefined || candidateMean === undefined) {
    return { meaningful: false, reason: 'no samples' };
  }
  const baselineSpread = standardDeviation(baseline) ?? 0;
  const candidateSpread = standardDeviation(candidate) ?? 0;
  const pooled = Math.sqrt(
    baselineSpread ** 2 / baseline.length + candidateSpread ** 2 / candidate.length,
  );
  const difference = Math.abs(candidateMean - baselineMean);
  if (pooled === 0) {
    return difference === 0
      ? { meaningful: false, reason: 'both samples are identical' }
      : { meaningful: true, reason: 'no variance within either sample' };
  }
  const ratio = difference / pooled;
  return ratio >= 2
    ? {
        meaningful: true,
        reason: `difference is ${ratio.toFixed(1)} times the combined standard error`,
      }
    : {
        meaningful: false,
        reason: `difference is only ${ratio.toFixed(1)} times the combined standard error`,
      };
};
