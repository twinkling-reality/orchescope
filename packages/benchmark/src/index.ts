/**
 * Benchmarking one named dimension of an agent system.
 *
 * The package owns the shape of an experiment and the honesty of its report: variants that differ in exactly
 * one field, warmup runs excluded from every number, raw values kept alongside every summary, and a written
 * list of the statements the data does not support.
 */

export { limitationsFor } from './limitations.ts';
export { type RunBenchmarkInput, runBenchmark } from './run.ts';
export { buildVariants, parseDimensionValues } from './variants.ts';
