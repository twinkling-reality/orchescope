import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.ts';

/**
 * Hashing primitives. node:crypto is the single platform API the domain is allowed to use, because
 * identity and content addressing are domain concerns and a pure TypeScript SHA-256 would be slower
 * without being purer in any way that matters.
 */

export const sha256Hex = (input: string | Uint8Array): string =>
  createHash('sha256').update(input).digest('hex');

export const sha256OfJson = (value: unknown): string => sha256Hex(canonicalJson(value));

/** Truncated digest for readable identifiers. Sixteen hex characters is 64 bits of collision space. */
export const shortHash = (input: string | Uint8Array, length = 16): string =>
  sha256Hex(input).slice(0, length);

export const shortHashOfJson = (value: unknown, length = 16): string =>
  shortHash(canonicalJson(value), length);
