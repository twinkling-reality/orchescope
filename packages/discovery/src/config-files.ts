import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Configuration documents that discovery reads directly.
 *
 * The list is explicit rather than a glob, because reading every JSON file in a repository would be
 * both slow and a way for a hostile repository to feed a parser arbitrary input. Each document keeps
 * its raw text length and a JSON pointer helper so evidence can point at the exact key.
 */

export type ConfigFormat = 'json' | 'yaml';

export type ConfigDocument = {
  readonly path: string;
  readonly format: ConfigFormat;
  readonly data: unknown;
  readonly byteLength: number;
};

export type ConfigProblem = { readonly file: string; readonly detail: string };

/** Configuration paths read on every scan, relative to the repository root. */
export const KNOWN_CONFIG_PATHS: readonly string[] = [
  '.mcp.json',
  '.vscode/mcp.json',
  '.cursor/mcp.json',
  'claude_desktop_config.json',
  '.claude/settings.json',
  '.orchescope/manifest.yaml',
  '.orchescope/manifest.yml',
  'crew.jsonc',
  'agents.yaml',
  'config/agents.yaml',
  'config/tasks.yaml',
];

/**
 * Strips JSONC style comments and trailing commas so a `.jsonc` file can be parsed as JSON.
 *
 * Written as an explicit state machine rather than a set of regular expressions, because a comment marker inside a
 * string is not a comment and a quote inside a comment does not open a string. Each state decides what to emit and what
 * state follows, which keeps the two cases from interfering.
 */
type ScanState = 'text' | 'string' | 'string_escape' | 'line_comment' | 'block_comment';

type Step = { readonly state: ScanState; readonly emit: string; readonly skipNext: boolean };

const stepText = (character: string, next: string): Step => {
  if (character === '"') return { state: 'string', emit: character, skipNext: false };
  if (character === '/' && next === '/') return { state: 'line_comment', emit: '', skipNext: true };
  if (character === '/' && next === '*')
    return { state: 'block_comment', emit: '', skipNext: true };
  return { state: 'text', emit: character, skipNext: false };
};

const step = (state: ScanState, character: string, next: string): Step => {
  switch (state) {
    case 'line_comment':
      // The newline is kept so that line numbers in the stripped text still match the file.
      return character === '\n'
        ? { state: 'text', emit: character, skipNext: false }
        : { state, emit: '', skipNext: false };
    case 'block_comment':
      return character === '*' && next === '/'
        ? { state: 'text', emit: '', skipNext: true }
        : { state, emit: '', skipNext: false };
    case 'string_escape':
      return { state: 'string', emit: character, skipNext: false };
    case 'string':
      if (character === '\\') return { state: 'string_escape', emit: character, skipNext: false };
      return character === '"'
        ? { state: 'text', emit: character, skipNext: false }
        : { state, emit: character, skipNext: false };
    default:
      return stepText(character, next);
  }
};

export const stripJsonComments = (text: string): string => {
  let result = '';
  let state: ScanState = 'text';
  for (let index = 0; index < text.length; index += 1) {
    const taken = step(state, text[index] ?? '', text[index + 1] ?? '');
    state = taken.state;
    result += taken.emit;
    if (taken.skipNext) index += 1;
  }
  return result.replace(/,(\s*[}\]])/g, '$1');
};

export const jsonPointer = (segments: readonly (string | number)[]): string =>
  segments.length === 0
    ? ''
    : `/${segments
        .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
        .join('/')}`;

export const readConfigDocuments = (
  root: string,
  extraPaths: readonly string[] = [],
): {
  readonly documents: readonly ConfigDocument[];
  readonly problems: readonly ConfigProblem[];
} => {
  const documents: ConfigDocument[] = [];
  const problems: ConfigProblem[] = [];

  for (const relativePath of [...KNOWN_CONFIG_PATHS, ...extraPaths]) {
    let text: string;
    try {
      text = readFileSync(join(root, relativePath), 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        problems.push({
          file: relativePath,
          detail: error instanceof Error ? error.message : 'could not be read',
        });
      }
      continue;
    }
    const isYaml = relativePath.endsWith('.yaml') || relativePath.endsWith('.yml');
    try {
      const data = isYaml
        ? (parseYaml(text) as unknown)
        : (JSON.parse(stripJsonComments(text)) as unknown);
      documents.push({
        path: relativePath,
        format: isYaml ? 'yaml' : 'json',
        data,
        byteLength: Buffer.byteLength(text, 'utf8'),
      });
    } catch (error) {
      problems.push({
        file: relativePath,
        detail: error instanceof Error ? error.message : 'could not be parsed',
      });
    }
  }
  return { documents, problems };
};

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
