import type { ClaimBasis, RunRecord } from '@orchescope/schema';

/**
 * The difference between a run happening and a run measuring something.
 *
 * A recorded run is evidence that a command executed. It is not evidence that anything was observed:
 * a target with no OpenTelemetry SDK loaded exports nothing, and the run that wrapped it carries a
 * zero for every span derived counter. Those zeros are the absence of a measurement, not a
 * measurement of zero, and reading them the second way is how an audit came to report six tools as
 * never exercised on a run containing nothing.
 *
 * The vocabulary is here rather than beside any one consumer because three layers need the same word
 * for it: the rules decide whether they may speak, the report decides where the loop stands, and the
 * comparison decides whether a metric has a value at all.
 */

/** A run whose trace bundle held no span at all. It measured nothing, so nothing may be derived from it. */
export const runIsSilent = (spanCount: number): boolean => spanCount === 0;

/**
 * Whether a claim may present itself as an observation.
 *
 * `observed` is the strongest basis this product has and the only one that means a machine watched it
 * happen. Every other basis names a weaker route to the same sentence, so a claim with nothing
 * observed behind it is not merely overconfident: it is a different claim wearing the wrong word.
 */
export const basisIsSupportable = (basis: ClaimBasis, observationCount: number): boolean =>
  basis !== 'observed' || observationCount > 0;

/** A run paired with how much it observed, which is what anything reasoning over runs actually needs. */
export type RunObservation = {
  readonly run: RunRecord;
  readonly spanCount: number;
};

/**
 * A run that no mechanism reported anything about.
 *
 * Two mechanisms can measure a run and this asks whether either did. Spans are one. The target result
 * document is the other, and it exists so that a target with no tracing at all can still be evaluated;
 * its `success` field is required, so a run whose outcome is unknown is a run whose result document was
 * never read. A run with neither carries a zero for every counter, and those zeros are the shape of the
 * bug this exists to prevent: a comparison of two such runs reported `duplicateSideEffects` moving from
 * zero to zero, and an acceptance criterion banked it as satisfied.
 *
 * A run measured by only one of the two still counts. Dropping it would discard a real measurement,
 * which is the same error pointed the other way.
 */
export const runMeasuredNothing = (observation: RunObservation): boolean =>
  observation.spanCount === 0 && observation.run.metrics.taskSuccess === undefined;
