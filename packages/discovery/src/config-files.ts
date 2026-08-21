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
 * A caller may name further paths, and `namedConfigPaths` derives them from the bounded traversal by file name so
 * that a deployment manifest in a workspace package is read as well as one at the root. That keeps the guarantee the
 * explicit list exists for: every path read is one the traversal already walked, under the same exclusions and the
 * same file limit, and the count of them is capped.
 */

export type ConfigFormat = 'json' | 'yaml' | 'toml';

/**
 * Why a document was opened, which decides who may read it by its content.
 *
 * A path on the fixed list below was opened because this build knows the name. A path found by file name in
 * the traversal was opened for the one kind whose name it carries, and handing it to a reader of another
 * kind is how a generic key in somebody else's document becomes a declaration. `servers` is such a key: an
 * inventory of hosts under `deploy/agents.yaml` was read as two MCP servers, one of them carrying permission
 * to execute `/usr/sbin/nginx`, and an application depending on express and nothing else was reported as a
 * detected agent system. That is the `.mcp.json` failure below, arriving through a different door.
 */
export type ConfigOrigin = 'known_path' | 'platform_manifest' | 'agent_declaration';

export type ConfigDocument = {
  readonly path: string;
  readonly origin: ConfigOrigin;
  readonly format: ConfigFormat;
  readonly data: unknown;
  readonly byteLength: number;
};

export type NamedConfigPath = { readonly path: string; readonly origin: ConfigOrigin };

/**
 * A configuration document the scan opened and could not use.
 *
 * Carried out of this module with the reason, because a document that failed to parse is a document this
 * build did not read and the reader has to be told which. Reported as `parse_error` and `unreadable`, the
 * two names the coverage vocabulary already has for exactly those two failures.
 */
export type ConfigProblem = {
  readonly file: string;
  readonly reason: 'parse_error' | 'unreadable';
  readonly detail: string;
};

/**
 * Configuration paths read on every scan, relative to the repository root.
 *
 * Every name here is one some adapter opens. `config/tasks.yaml` was on this list and no adapter read it,
 * which is a file opened on every scan of every repository and thrown away. Reading a CrewAI task needs a
 * component kind for a task and `COMPONENT_KINDS` has none, so what it costs to add is a schema decision and
 * not a parser.
 */
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
 * Documents found by file name in the traversal rather than at a fixed path, in kinds that do not share a cap.
 *
 * A Cloudflare Workers manifest sits beside the worker it deploys, which in a workspace is not the repository root.
 * Reading only the root missed every binding in one repository: a D1 database, two KV namespaces and a cron trigger
 * declared in `packages/worker/wrangler.toml`, while fifty seven prepared statements ran against the first of them.
 * An agents document is the same problem from another direction: `crewai create crew` writes one into
 * `src/<package>/config/`, and the twenty in the pinned CrewAI examples repository sit at no fixed path at all.
 *
 * **Each kind carries its own cap, because one cap over both is a cap that a repository full of one kind spends on
 * that kind.** Measured on that examples repository, putting the agent and task document names into the deployment
 * manifest's set of three produced forty candidates under its cap of thirty two and dropped eight of them. Adding a
 * root `wrangler.toml` and a `packages/worker/wrangler.toml` to the same repository dropped both of those as well:
 * the candidates sort by path, `c` and `f` and `i` sort before `w`, and the two manifests the cap exists to protect
 * are the first things a shared cap discards. That is the fix 0.6.0 made, undone by a name added to the wrong set.
 *
 * Only names on a list are read, the candidates come from the bounded traversal so the exclusions and the file limit
 * already applied, and the count read is capped per kind. A repository with more documents of one kind than its cap
 * is a repository whose extra documents are not read, which is why each cap is stated here beside the population it
 * was measured against rather than left as a number in a slice.
 */
type NamedConfigKind = {
  readonly origin: ConfigOrigin;
  readonly names: ReadonlySet<string>;
  readonly max: number;
};

/** Deployment manifests. Thirty two against a field repository that declares two. */
const PLATFORM_CONFIG_NAMES: ReadonlySet<string> = new Set([
  'wrangler.toml',
  'wrangler.json',
  'wrangler.jsonc',
]);

export const MAX_PLATFORM_CONFIGS = 32;

/** Documents that declare agents where a framework's own layout puts them, which is inside the package. */
const AGENT_DECLARATION_NAMES: ReadonlySet<string> = new Set(['agents.yaml']);

/** Agent declaration documents. Sixty four against the twenty the pinned CrewAI examples repository declares. */
export const MAX_AGENT_DECLARATIONS = 64;

const NAMED_CONFIG_KINDS: readonly NamedConfigKind[] = [
  { origin: 'platform_manifest', names: PLATFORM_CONFIG_NAMES, max: MAX_PLATFORM_CONFIGS },
  { origin: 'agent_declaration', names: AGENT_DECLARATION_NAMES, max: MAX_AGENT_DECLARATIONS },
];

export type NamedConfigSelection = {
  readonly paths: readonly NamedConfigPath[];
  /**
   * How many candidates a cap declined.
   *
   * Returned rather than dropped inside, because a scan that read sixty four of seventy agents documents and
   * a scan of a repository that declares sixty four produce the same graph, and nothing else in the report
   * separates them.
   */
  readonly declined: number;
};

export const namedConfigPaths = (paths: readonly string[]): NamedConfigSelection => {
  const selected: NamedConfigPath[] = [];
  let declined = 0;
  for (const kind of NAMED_CONFIG_KINDS) {
    const candidates = paths.filter((path) => kind.names.has(path.split('/').at(-1) ?? '')).sort();
    declined += Math.max(0, candidates.length - kind.max);
    for (const path of candidates.slice(0, kind.max)) selected.push({ path, origin: kind.origin });
  }
  return { paths: selected, declined };
};

export const readConfigDocuments = (
  root: string,
  extraPaths: readonly NamedConfigPath[] = [],
): {
  readonly documents: readonly ConfigDocument[];
  readonly problems: readonly ConfigProblem[];
} => {
  const documents: ConfigDocument[] = [];
  const problems: ConfigProblem[] = [];
  /*
   * A name on the explicit list is also a name the traversal finds, so `agents.yaml` at the root arrives twice.
   * Reading it twice would hand every adapter the same document twice and double what each one reports having
   * found in it. The fixed list wins, because a path this build knows the name of was not opened on the
   * strength of the name a traversal happened to see.
   */
  const read = new Set<string>();
  const candidates: readonly NamedConfigPath[] = [
    ...KNOWN_CONFIG_PATHS.map((path) => ({ path, origin: 'known_path' as const })),
    ...extraPaths,
  ];

  for (const candidate of candidates) {
    const relativePath = candidate.path;
    if (read.has(relativePath)) continue;
    read.add(relativePath);
    let text: string;
    try {
      text = readFileSync(join(root, relativePath), 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        problems.push({
          file: relativePath,
          reason: 'unreadable',
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
        origin: candidate.origin,
        format,
        data,
        byteLength: Buffer.byteLength(text, 'utf8'),
      });
    } catch (error) {
      problems.push({
        file: relativePath,
        reason: 'parse_error',
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
