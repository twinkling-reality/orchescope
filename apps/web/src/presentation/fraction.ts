/**
 * A count with a denominator, and the three things a reader wants from one.
 *
 * The Overview carries five of these and used to draw none of them: 14 of 21 parts seen running, 3 of 5
 * problems ready to hand off, 23 of 23 files read, 1 of 3 scenarios run, 0 of 2 goals verified. Each is
 * a whole of a known total, which is the one shape that can be drawn honestly here, because the total is
 * counted rather than estimated and the share follows from the two counts by division and nothing else.
 *
 * The refusal path is the reason this is a module rather than a formatting call. A total of zero has no
 * share: nought of nought is not nought per cent, it is a question with no answer, and a bar drawn at
 * empty there would say a thing was measured and found wanting. `orchescope-discovery` finds nothing at
 * all, so that path is not hypothetical.
 */

export interface Fraction {
  readonly done: number;
  readonly total: number;
  readonly remaining: number;
  /** Between 0 and 1, or null when the total is zero and there is no share to state. */
  readonly share: number | null;
  /** `100%`, or null alongside a null share. Rounded to whole numbers: a bar is not a measurement. */
  readonly percent: string | null;
}

const clamp = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

export function fractionOf(done: number, total: number): Fraction {
  const wholeTotal = clamp(total);
  // A count larger than its own total is a fault upstream, and reporting a share above one would hide
  // it. The counts stay as they are and the share is capped, so the numbers and the bar disagree
  // visibly rather than the bar quietly overflowing its track.
  const wholeDone = Math.min(wholeTotal, clamp(done));
  if (wholeTotal === 0) {
    return { done: wholeDone, total: 0, remaining: 0, share: null, percent: null };
  }
  const share = wholeDone / wholeTotal;
  return {
    done: wholeDone,
    total: wholeTotal,
    remaining: wholeTotal - wholeDone,
    share,
    percent: `${Math.round(share * 100)}%`,
  };
}
