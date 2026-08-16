import type { ClaimBasis } from '@orchescope/schema';

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
