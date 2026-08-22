import { MAX_MANIFEST_COMPONENTS } from '@orchescope/schema';
import type { CitationRequest } from '@orchescope/source-analysis';
import type { ConfigDocument } from './config-files.ts';

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/**
 * Extracts the bounded set of file lines a version 3 manifest asks discovery to snapshot.
 *
 * Schema validation remains the manifest reader's responsibility. This narrower pass decides only what
 * filesystem work is allowed before that reader runs, so malformed values contribute no request and a
 * component array longer than the published ceiling cannot cause more reads.
 */
export const manifestCitationRequests = (
  documents: readonly ConfigDocument[],
): readonly CitationRequest[] => {
  const manifest = documents.find((document) => document.origin === 'orchescope_manifest');
  const data = record(manifest?.data);
  if (data?.['schemaVersion'] !== 3 || !Array.isArray(data['components'])) return [];

  return data['components'].slice(0, MAX_MANIFEST_COMPONENTS).flatMap((value) => {
    const component = record(value);
    const path = component?.['definedIn'];
    const line = component?.['definedAtLine'];
    return typeof path === 'string' && typeof line === 'number' ? [{ path, line }] : [];
  });
};
