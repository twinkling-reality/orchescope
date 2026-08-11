/**
 * Determinate unit meters for known totals.
 *
 * A cell is one unit of the denominator. The filled count is the numerator. There is no percentage and
 * no score: the glyphs are the same fraction the prose already states, drawn so a glance can weigh
 * filled against empty. When the total is zero, or wider than the line budget, the meter is absent
 * rather than scaled into an approximate picture.
 */

/** One cell per unit of `total`, filled for `taken`, labeled `taken/total`. */
export const unitMeter = (taken: number, total: number, maxCells = 32): string | undefined => {
  if (total <= 0 || total > maxCells) return undefined;
  const filled = Math.max(0, Math.min(taken, total));
  return `[${'#'.repeat(filled)}${'.'.repeat(total - filled)}] ${filled}/${total}`;
};

export type SeverityBucket = {
  readonly critical: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly info: number;
};

/**
 * One letter per risk, grouped by severity, so the strip's length equals the risk count.
 *
 * Letters carry the mix under `NO_COLOR`. Colour, when present, is applied by the caller around the
 * whole strip or left plain; the letters alone still say which severities dominate.
 */
export const severityUnitMeter = (buckets: SeverityBucket, maxCells = 40): string | undefined => {
  const total = buckets.critical + buckets.high + buckets.medium + buckets.low + buckets.info;
  if (total <= 0 || total > maxCells) return undefined;
  const body = [
    'C'.repeat(buckets.critical),
    'H'.repeat(buckets.high),
    'M'.repeat(buckets.medium),
    'L'.repeat(buckets.low),
    'i'.repeat(buckets.info),
  ].join('');
  return `|${body}| ${total}`;
};
