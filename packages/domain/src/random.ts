/**
 * Randomness as a port, always seeded.
 *
 * Fault injection has to be reproducible: "this fault fired on attempt three" is only useful if the
 * next run makes the same decision. Orchescope therefore never calls a global random source.
 */
export type Rng = {
  /** Uniform value in [0, 1). */
  readonly nextFloat: () => number;
  /** Uniform integer in [0, boundExclusive). */
  readonly nextInt: (boundExclusive: number) => number;
};

/**
 * mulberry32. Chosen because it is small, fast, has a documented period of 2^32 and produces the
 * same stream on every platform, which matters more here than statistical quality.
 */
export const seededRng = (seed: number): Rng => {
  let state = seed >>> 0;
  const nextFloat = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    nextFloat,
    nextInt: (boundExclusive: number) => Math.floor(nextFloat() * boundExclusive),
  };
};

/**
 * Deterministic decision for "does this fault apply to this occurrence". Derived from the seed and
 * the occurrence key rather than from a running stream, so decisions do not depend on evaluation order.
 */
export const decideByKey = (seed: number, key: string, probability: number): boolean => {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  let hash = seed >>> 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (Math.imul(hash ^ key.charCodeAt(index), 0x01000193) + 1) >>> 0;
  }
  return hash / 4294967296 < probability;
};
