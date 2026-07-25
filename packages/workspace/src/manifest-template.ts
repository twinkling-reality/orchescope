import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPONENT_KINDS,
  EDGE_KINDS,
  SCHEMA_VERSIONS,
  SIDE_EFFECT_CLASSES,
} from '@orchescope/schema';
import type { WorkspacePaths } from './paths.ts';

/**
 * The manifest template.
 *
 * The manifest is the only way to describe a system no bundled adapter can read, so the template has to be
 * usable without opening the documentation: the vocabulary is listed in the file, and the example is the
 * shape the validator accepts. The kind lists come from the schema rather than from prose, so the template
 * cannot drift away from what the validator will accept.
 *
 * It declares nothing. An empty manifest keeps the audit honest: a template on disk must not make a
 * repository look like a detected agent system.
 */

const wrap = (values: readonly string[], width: number): readonly string[] => {
  const lines: string[] = [];
  let current = '';
  for (const value of values) {
    const candidate = current.length === 0 ? value : `${current}, ${value}`;
    if (candidate.length > width) {
      lines.push(current);
      current = value;
      continue;
    }
    current = candidate;
  }
  if (current.length > 0) lines.push(current);
  return lines;
};

const commentedList = (heading: string, values: readonly string[]): readonly string[] => {
  const [first = '', ...rest] = wrap(values, 92);
  return [`# ${heading}: ${first}`, ...rest.map((line) => `#   ${line}`)];
};

export const manifestTemplate = (): string =>
  [
    '# Orchescope manifest.',
    '#',
    '# Declares the components and relations of a system that no bundled adapter can read from source, for',
    '# example an agent written in a language Orchescope does not parse. What you declare here is labelled',
    '# `discovered` with this file as its evidence, never `observed`, and it is merged with automatic',
    '# discovery rather than replacing it.',
    '#',
    '# `runtimeName` is what lets a run match a declaration whose telemetry name differs from its source name.',
    '# An edge endpoint is the `name` of a component, either declared below or discovered from source.',
    '#',
    ...commentedList('component kinds', COMPONENT_KINDS),
    ...commentedList('relation kinds', EDGE_KINDS),
    ...commentedList('side effect classes', SIDE_EFFECT_CLASSES),
    '#',
    '# Uncomment the example, replace it with your system, then run: orchescope audit',
    '',
    `schemaVersion: ${SCHEMA_VERSIONS.manifest}`,
    '',
    'components: []',
    '# components:',
    '#   - kind: agent',
    '#     name: triage',
    '#     runtimeName: triage',
    '#     definedIn: internal/agents/triage.go',
    '#     definedAtLine: 18',
    '#   - kind: tool',
    '#     name: issue_refund',
    '#     definedIn: internal/tools/refund.go',
    '#     sideEffect: financial',
    '',
    'edges: []',
    '# edges:',
    '#   - kind: calls_tool',
    '#     from: triage',
    '#     to: issue_refund',
    '#     policy:',
    '#       timeoutMs: 5000',
    '#       retry:',
    '#         maxAttempts: 3',
    '#         bounded: true',
    '#         backoff: exponential',
    '#         idempotency: absent',
    '',
    '# Paths to leave out of the scan, in addition to the defaults.',
    '# exclude:',
    '#   - vendor',
    '',
  ].join('\n');

export type ManifestTemplateResult = {
  readonly created: boolean;
  readonly manifestFile: string;
};

/**
 * Writes the template unless a manifest already exists, under either spelling of the extension: a hand
 * written declaration is never overwritten, and a second manifest is never created beside it.
 */
export const writeManifestTemplate = (paths: WorkspacePaths): ManifestTemplateResult => {
  for (const name of ['manifest.yaml', 'manifest.yml']) {
    const candidate = join(paths.orchescope, name);
    if (existsSync(candidate)) return { created: false, manifestFile: candidate };
  }
  writeFileSync(paths.manifestFile, manifestTemplate(), { mode: 0o600 });
  return { created: true, manifestFile: paths.manifestFile };
};
