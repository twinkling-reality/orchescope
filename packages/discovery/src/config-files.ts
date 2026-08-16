import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

/**
 * Configuration documents that discovery reads directly.
 *
 * The list is explicit rather than a glob, because reading every JSON file in a repository would be
 * both slow and a way for a hostile repository to feed a parser arbitrary input. Each document keeps
 * its raw text length and a JSON pointer helper so evidence can point at the exact key.
 *
 * A caller may name further paths, and `platformConfigPaths` derives them from the bounded traversal by file name so
 * that a deployment manifest in a workspace package is read as well as one at the root. That keeps the guarantee the
 * explicit list exists for: every path read is one the traversal already walked, under the same exclusions and the
 * same file limit, and the count of them is capped.
 */

export type ConfigFormat = 'json' | 'yaml' | 'toml';

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
 * Configuration that belongs to a coding agent or an editor rather than to the system in the repository.
 *
 * A `.mcp.json` naming a server is a developer telling their own tool where to connect. It is not the
 * repository declaring part of the system under audit, and reading it as one reported a 220 component
 * Cloudflare Workers application as a detected agent system with no agent, tool or model in it, on the
 * strength of a single entry naming Orchescope. The reachability rule then raised a finding against the
 * repository for the contradiction, which is the tool noticing something is wrong and blaming the wrong
 * party.
 *
 * What is declared in these files is still read and still appears in the graph. A developer's own tooling
 * is a true fact about a repository; it is not evidence that the repository builds an agent system.
 */
const AGENT_CLIENT_CONFIG_PATHS: ReadonlySet<string> = new Set([
  '.mcp.json',
  '.vscode/mcp.json',
  '.cursor/mcp.json',
  'claude_desktop_config.json',
  '.claude/settings.json',
]);

export const isAgentClientConfig = (path: string): boolean => AGENT_CLIENT_CONFIG_PATHS.has(path);

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

const formatOf = (path: string): ConfigFormat => {
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  if (path.endsWith('.toml')) return 'toml';
  return 'json';
};

/**
 * Deployment manifests that declare infrastructure, found by file name in the traversal rather than at a fixed path.
 *
 * A Cloudflare Workers manifest sits beside the worker it deploys, which in a workspace is not the repository root.
 * Reading only the root missed every binding in one repository: a D1 database, two KV namespaces and a cron trigger
 * declared in `packages/worker/wrangler.toml`, while fifty seven prepared statements ran against the first of them.
 *
 * Only names on this list are read, the candidates come from the bounded traversal so the exclusions and the file
 * limit already applied, and the count read is capped. A repository with more of them than the cap is a repository
 * whose extra manifests are not read, which is why the cap is stated rather than silent.
 */
const PLATFORM_CONFIG_NAMES = new Set(['wrangler.toml', 'wrangler.json', 'wrangler.jsonc']);

export const MAX_PLATFORM_CONFIGS = 32;

export const platformConfigPaths = (paths: readonly string[]): readonly string[] =>
  paths
    .filter((path) => PLATFORM_CONFIG_NAMES.has(path.split('/').at(-1) ?? ''))
    .sort()
    .slice(0, MAX_PLATFORM_CONFIGS);

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
    const format = formatOf(relativePath);
    try {
      const data =
        format === 'yaml'
          ? (parseYaml(text) as unknown)
          : format === 'toml'
            ? (parseToml(text) as unknown)
            : (JSON.parse(stripJsonComments(text)) as unknown);
      documents.push({
        path: relativePath,
        format,
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
