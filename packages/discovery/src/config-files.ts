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

/** Strips JSONC style comments and trailing commas so a `.jsonc` file can be parsed as JSON. */
export const stripJsonComments = (text: string): string => {
  let result = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    const next = text[index + 1] ?? '';
    if (inLineComment) {
      if (character === '\n') {
        inLineComment = false;
        result += character;
      }
      continue;
    }
    if (inBlockComment) {
      if (character === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    result += character;
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
): { readonly documents: readonly ConfigDocument[]; readonly problems: readonly ConfigProblem[] } => {
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
