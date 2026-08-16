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
