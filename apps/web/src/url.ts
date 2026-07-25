/**
 * Link safety.
 *
 * Every string in a report bundle came from a repository or from a language model, so a URL in the
 * bundle is untrusted input. A link is only ever bound to an `href` after its parsed protocol has
 * been checked against this list; anything else is rendered as plain text instead.
 */

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'file:']);

export function safeHref(raw: string): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }
  return parsed.href;
}

export function isSafeHref(raw: string): boolean {
  return safeHref(raw) !== null;
}

export function allowedProtocols(): readonly string[] {
  return [...ALLOWED_PROTOCOLS];
}
