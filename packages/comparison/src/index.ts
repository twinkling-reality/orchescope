/**
 * Comparison: baseline against candidate, with per metric direction, sample sizes and a verdict that refuses to
 * call a latency win an improvement when task success fell.
 */

export {
  type CompareInput,
  compare,
  compareMetric,
  DEFAULT_COMPARED_METRICS,
  type MetricSample,
  samplesFromRuns,
} from './compare.ts';
