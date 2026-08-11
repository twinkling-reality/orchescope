/**
 * The sibling reports this page was rendered beside, when it was rendered beside any.
 *
 * A shipped report is one repository at a time. That is a product boundary rather than a limitation
 * nobody got round to lifting: identity and revision pinning are defined relative to one working tree,
 * so a report that offered to switch to another repository would be offering something the analysis
 * behind it cannot support.
 *
 * The gallery is the exception, and it is a development surface. `pnpm states` renders every cached
 * bundle into one directory so a change can be judged against sixteen reports rather than one, and
 * moving between them by going back to an index is friction that hides regressions. So the generator
 * embeds the list of what it wrote, exactly the way the bundle itself is embedded, and the chrome grows
 * a picker only when it finds one. An audit served by the real command embeds nothing here, so the
 * control is absent rather than present and inert.
 */

export const GALLERY_ELEMENT_ID = 'orchescope-gallery';

export interface GalleryEntry {
  /** The file to open, relative to this page. */
  readonly page: string;
  readonly project: string;
  readonly components: number;
  readonly runs: number;
  /** True for the page this list is embedded in. */
  readonly current: boolean;
}

function isEntry(value: unknown): value is GalleryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['page'] === 'string' &&
    entry['page'].length > 0 &&
    // A page reference that leaves the directory, names a scheme or starts at the root is not a
    // sibling. The generator writes plain file names, so anything else came from somewhere else.
    !entry['page'].includes('/') &&
    !entry['page'].includes(':') &&
    typeof entry['project'] === 'string' &&
    typeof entry['components'] === 'number' &&
    typeof entry['runs'] === 'number' &&
    typeof entry['current'] === 'boolean'
  );
}

/**
 * Reads the embedded list, or returns nothing at all. Anything malformed is nothing rather than a
 * partial list: a picker missing half its entries is worse than no picker, because it reads as a
 * complete answer.
 */
export interface GallerySource {
  getElementById(id: string): { readonly textContent: string | null } | null;
}

export function readGallery(source: GallerySource): readonly GalleryEntry[] {
  const element = source.getElementById(GALLERY_ELEMENT_ID);
  if (element === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(element.textContent ?? '');
    if (!Array.isArray(parsed) || !parsed.every(isEntry)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}
