/**
 * What kind of system this is, said in the nouns a person already owns.
 *
 * `32 parts` tells a reader nothing. `5 agents, 7 tools and 2 models` tells them what they are looking
 * at before they read another word, and the counts are already in the bundle: this module only names
 * and orders them.
 *
 * The names are this workspace's own, not the schema's. `mcp_server` is an identifier and `MCP server`
 * is a noun; `side_effect` is a classification and `something that changes the outside world` is what it
 * means. A kind this build does not have a name for keeps its own, spaced and pluralised, so a schema
 * that grows a kind degrades to a readable guess rather than to a blank.
 *
 * The order is by count and then by name, so the same repository always describes itself the same way.
 */

/** How many kinds are named before the rest become `and N more`. Three fits a sentence. */
const NAMED_KINDS = 3;

const NAMES: Readonly<Record<string, readonly [string, string]>> = {
  agent: ['agent', 'agents'],
  agent_group: ['team of agents', 'teams of agents'],
  approval_boundary: ['approval step', 'approval steps'],
  database: ['database', 'databases'],
  entrypoint: ['entry point', 'entry points'],
  evaluator: ['check', 'checks'],
  external_service: ['outside service', 'outside services'],
  guardrail: ['guardrail', 'guardrails'],
  mcp_server: ['MCP server', 'MCP servers'],
  memory: ['memory store', 'memory stores'],
  model: ['model', 'models'],
  project: ['project', 'projects'],
  prompt: ['prompt', 'prompts'],
  provider: ['provider', 'providers'],
  queue: ['queue', 'queues'],
  retrieval: ['retrieval store', 'retrieval stores'],
  side_effect: ['action on the outside world', 'actions on the outside world'],
  tool: ['tool', 'tools'],
  worker: ['worker', 'workers'],
};

export function nameKind(kind: string, count: number): string {
  const known = NAMES[kind];
  if (known !== undefined) {
    return count === 1 ? known[0] : known[1];
  }
  const spaced = kind.replaceAll('_', ' ').trim();
  const fallback = spaced.length === 0 ? kind : spaced;
  return count === 1 ? fallback : `${fallback}s`;
}

/**
 * `5 agents, 7 tools and 2 models, and 18 more`, or an empty string when there is nothing to describe.
 *
 * An empty string rather than a placeholder, because the sentence this goes into reads without it and a
 * repository that declares nothing has a different sentence anyway.
 */
export function describeShape(kinds: ReadonlyMap<string, number>): string {
  const ordered = [...kinds.entries()]
    .filter(([, count]) => count > 0)
    .sort(([leftKind, leftCount], [rightKind, rightCount]) =>
      leftCount === rightCount ? leftKind.localeCompare(rightKind) : rightCount - leftCount,
    );
  if (ordered.length === 0) {
    return '';
  }
  const named = ordered.slice(0, NAMED_KINDS);
  const rest = ordered.slice(NAMED_KINDS).reduce((sum, [, count]) => sum + count, 0);
  const phrases = named.map(([kind, count]) => `${count} ${nameKind(kind, count)}`);
  const head =
    phrases.length === 1
      ? (phrases[0] ?? '')
      : `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
  return rest === 0 ? head : `${head}, and ${rest} more`;
}

/** Counts every kind present, so the description is built from the graph rather than from a guess. */
export function countKinds(
  components: readonly { readonly kind: string }[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const component of components) {
    counts.set(component.kind, (counts.get(component.kind) ?? 0) + 1);
  }
  return counts;
}
