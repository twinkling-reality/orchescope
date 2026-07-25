/**
 * Determinism primitives.
 *
 * Nothing in this system is allowed to be random: identifiers, token counts, queue waits, scripted model
 * replies and fault decisions are all derived from the seed, so two runs with the same seed produce
 * identical spans and identical side effects. That is why there is no `Math.random` and no
 * `crypto.randomUUID` anywhere in this application.
 */

const MASK_64 = (1n << 64n) - 1n;
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

/** SplitMix64 finalisation: a bijection on 64 bits, so distinct inputs stay distinct. */
export const mix64 = (value: bigint): bigint => {
  let state = (value + GOLDEN_GAMMA) & MASK_64;
  state = ((state ^ (state >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  state = ((state ^ (state >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (state ^ (state >> 31n)) & MASK_64;
};

/** FNV-1a over UTF-16 code units, widened to 64 bits so text can be mixed with numeric seeds. */
export const hashText = (text: string): bigint => {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash ^ BigInt(text.charCodeAt(index))) * FNV_PRIME) & MASK_64;
  }
  return hash;
};

export const hexOf = (value: bigint, digits: number): string =>
  (value & MASK_64).toString(16).padStart(digits, '0').slice(-digits);

const widen = (part: string | number | bigint): bigint => {
  if (typeof part === 'string') return hashText(part);
  return typeof part === 'bigint' ? part & MASK_64 : BigInt(Math.trunc(part));
};

const foldParts = (parts: readonly (string | number | bigint)[]): bigint => {
  let state = 0n;
  for (const part of parts) {
    state = mix64(state ^ widen(part));
  }
  return state;
};

/** A stable value in [0, 1) derived from the given parts. Used wherever a probability is needed. */
export const unitOf = (...parts: readonly (string | number | bigint)[]): number =>
  Number(foldParts(parts) >> 11n) / Number(1n << 53n);

/** A stable integer in [0, bound) derived from the given parts. */
export const indexOf = (bound: number, ...parts: readonly (string | number | bigint)[]): number =>
  bound <= 1 ? 0 : Number(foldParts(parts) % BigInt(bound));
