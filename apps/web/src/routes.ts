/**
 * Hash routing. The report is one page served from a local origin or opened from a file, so the route
 * lives in the fragment and every view is linkable, including a selected component on the map.
 */

export const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'map', label: 'System map' },
  { id: 'findings', label: 'Findings' },
  { id: 'performance', label: 'Performance' },
  { id: 'resilience', label: 'Resilience' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'comparisons', label: 'Comparisons' },
  { id: 'goals', label: 'Goals' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export const DEFAULT_SECTION: SectionId = 'overview';

const SECTION_IDS: readonly string[] = SECTIONS.map((section) => section.id);

export interface Route {
  readonly section: SectionId;
  readonly params: Readonly<Record<string, string>>;
}

export function sectionLabel(id: SectionId): string {
  return SECTIONS.find((section) => section.id === id)?.label ?? id;
}

function isSectionId(value: string): value is SectionId {
  return SECTION_IDS.includes(value);
}

/** A malformed escape is kept as literal text: a bad fragment must not stop the report rendering. */
function decodeOrKeep(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseQuery(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (pair.length === 0) {
      continue;
    }
    const separator = pair.indexOf('=');
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? '' : pair.slice(separator + 1);
    params[decodeOrKeep(rawKey)] = decodeOrKeep(rawValue);
  }
  return params;
}

export function parseHash(hash: string): Route {
  const trimmed = hash.replace(/^#/, '').replace(/^\//, '');
  const [path = '', query = ''] = trimmed.split('?', 2);
  return {
    section: isSectionId(path) ? path : DEFAULT_SECTION,
    params: parseQuery(query),
  };
}

export function formatHash(
  section: SectionId,
  params: Readonly<Record<string, string>> = {},
): string {
  const entries = Object.entries(params).filter(([, value]) => value.length > 0);
  if (entries.length === 0) {
    return `#/${section}`;
  }
  const query = entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `#/${section}?${query}`;
}
