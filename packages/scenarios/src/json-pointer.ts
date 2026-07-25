/**
 * JSON pointer resolution, RFC 6901.
 *
 * Escapes are decoded in the order the specification requires, `~1` before `~0`, otherwise a pointer
 * containing an encoded tilde followed by a one would decode to the wrong key. A pointer that does not
 * resolve reports that it was not found rather than returning undefined, because a key whose value is
 * genuinely null is a different fact from a key that is absent.
 */

export type PointerResolution = { readonly found: boolean; readonly value: unknown };

const NOT_FOUND: PointerResolution = { found: false, value: undefined };

const decodeToken = (token: string): string => token.replaceAll('~1', '/').replaceAll('~0', '~');

const stepInto = (current: unknown, key: string): PointerResolution => {
  if (Array.isArray(current)) {
    if (!/^(?:0|[1-9]\d*)$/.test(key)) return NOT_FOUND;
    const index = Number(key);
    return index < current.length ? { found: true, value: current[index] } : NOT_FOUND;
  }
  if (typeof current !== 'object' || current === null) return NOT_FOUND;
  const record = current as Record<string, unknown>;
  return Object.hasOwn(record, key) ? { found: true, value: record[key] } : NOT_FOUND;
};

export const resolvePointer = (document: unknown, pointer: string): PointerResolution => {
  if (document === undefined) return NOT_FOUND;
  if (pointer === '') return { found: true, value: document };
  if (!pointer.startsWith('/')) return NOT_FOUND;
  let current: unknown = document;
  for (const token of pointer.slice(1).split('/')) {
    const step = stepInto(current, decodeToken(token));
    if (!step.found) return NOT_FOUND;
    current = step.value;
  }
  return { found: true, value: current };
};
