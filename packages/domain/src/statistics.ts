import { type Distribution, QUANTILE_MIN_SAMPLES } from '@orchescope/schema';

/**
 * Summary statistics with explicit honesty about sample size. A p95 computed from four samples is
 * not a p95, so quantiles below their threshold are withheld and the threshold is reported.
 */

export type QuantileName = 'p50' | 'p90' | 'p95' | 'p99';

const QUANTILE_FRACTIONS: Readonly<Record<QuantileName, number>> = {
  p50: 0.5,
  p90: 0.9,
  p95: 0.95,
  p99: 0.99,
};

/**
 * The quantile a metric name asks for, when it asks for one.
 *
 * `durationMs.p95` is the 95th percentile of the durations the runs reported: the base names what is read
 * from each run and the suffix names how the set is summarised. Asked here rather than where a metric is
 * compared, because two surfaces need the answer and a second copy of this table is a second answer.
 */
export const quantileOf = (metric: string): QuantileName | undefined => {
  const dot = metric.lastIndexOf('.');
  if (dot < 0) return undefined;
  const suffix = metric.slice(dot + 1);
  return suffix in QUANTILE_FRACTIONS ? (suffix as QuantileName) : undefined;
};

export const quantileFraction = (name: QuantileName): number => QUANTILE_FRACTIONS[name];

/**
 * How many samples one side must carry before this metric supports a direction.
 *
 * A quantile needs the samples that quantile needs, which this repository already decided at schema level
 * and which `summarize` above already honours when it withholds one from a scenario aggregate. The
 * comparison used to apply one floor of three to every metric, so a scenario result would print "p95
 * withheld: it needs at least 20 samples" while a comparison of the same runs computed a p95 from three
 * and called a direction on it. Measured on a real repository, that let an unchanged system report a
 * 15.3 per cent p95 improvement and bank an acceptance criterion with it, in the same document where the
 * mean of those three runs was reported indeterminate.
 *
 * A mean keeps the general floor, because what licenses a mean is the spread test rather than a rank.
 */
export const samplesRequiredFor = (metric: string): number => {
  const name = quantileOf(metric);
  return name === undefined ? MINIMUM_SAMPLES_PER_SIDE : QUANTILE_MIN_SAMPLES[name];
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
 * The fewest samples either side of a comparison may carry before a direction is refused.
 *
 * It lives here rather than beside the comparison because two packages have to agree on it and cannot
 * import each other: the comparison enforces it when it decides a direction, and goal creation asks it
 * before writing a criterion whose deciding command would come back indeterminate. Two independent
 * threes are two numbers that can drift apart, and the goal that promised evidence it could not produce
 * is what that drift looks like from the operator's side.
 */
export const MINIMUM_SAMPLES_PER_SIDE = 3;

/**
 * Metrics counting something that must not happen at all, where crossing zero is decided by presence.
 *
 * A duplicated payment that happened once and now happens never is a categorical change in behaviour, not
 * a claim about a distribution, so it needs no sample floor. Latency and token counts do, because there a
 * small sample genuinely cannot support a direction.
 *
 * This lives beside the floor because the same two packages need both and for the same reason: the
 * comparison applies it when it decides a direction, and goal creation asks it before writing a criterion.
 * Gating every metric criterion on the floor would have withdrawn the one criterion the improvement loop
 * actually closes on, from the one scenario shape that produces it.
 */
const DECIDED_BY_PRESENCE: ReadonlySet<string> = new Set([
  'duplicateSideEffects',
  'prohibitedSideEffects',
  'policyViolations',
  'userInterventions',
]);

export const metricDecidedByPresence = (metric: string): boolean => DECIDED_BY_PRESENCE.has(metric);

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
