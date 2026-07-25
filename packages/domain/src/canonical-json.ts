import { OrchescopeError } from './errors.ts';

/**
 * Canonical JSON serialisation.
 *
 * Content addresses, evidence identifiers and artifact digests all depend on serialisation, so the
 * encoding is pinned here: object keys sorted by code unit, `undefined` properties dropped, no
 * insignificant whitespace, and non finite numbers rejected rather than silently turned into null.
 */

const MAX_DEPTH = 64;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

const encodeNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'Canonical JSON cannot encode a non finite number.',
      {
        detail: { value: String(value) },
      },
    );
  }
  // Normalise negative zero so two structurally equal documents hash equally.
  return JSON.stringify(value === 0 ? 0 : value);
};

const encode = (value: unknown, depth: number): string => {
  if (depth > MAX_DEPTH) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'Canonical JSON nesting limit exceeded.', {
      detail: { maxDepth: MAX_DEPTH },
    });
  }
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return encodeNumber(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      break;
    default:
      throw new OrchescopeError(
        'INVALID_ARGUMENT',
        `Canonical JSON cannot encode ${typeof value}.`,
      );
  }
  if (Array.isArray(value)) {
    // An absent array element encodes as null, matching JSON.stringify, because an array position is
    // significant: dropping it would change the meaning of the document being hashed.
    return `[${value.map((item) => (item === undefined ? 'null' : encode(item, depth + 1))).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${encode(item, depth + 1)}`).join(',')}}`;
};

export const canonicalJson = (value: unknown): string => encode(value, 0);

/** Pretty printing for artifacts a human reads. Key order is canonical so diffs stay small. */
export const stableJson = (value: unknown, indent = 2): string =>
  JSON.stringify(JSON.parse(canonicalJson(value)), null, indent);
