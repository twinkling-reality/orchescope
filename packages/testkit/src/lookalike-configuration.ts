/**
 * Configuration documents that look like an agent system declaration and are not.
 *
 * Every one of these has fooled this build, or is the shape one directory away from what did. They live
 * here rather than beside either of their two readers because both need the same table: the corpus harness
 * writes each of them into every pinned repository that is not an agent system, and the discovery tests
 * cross them with a repository that declares one ordinary web framework and nothing else. What a shape
 * costs to add is a row, and it applies to every negative and every reader at once.
 *
 * A name a framework owns outright does not belong here. `crew.jsonc` is CrewAI's own, written by its
 * generator and named in its `pyproject.toml`, and a repository holding one is declaring a crew whatever
 * else it depends on. These are the names that belong to nobody: `agents.yaml` is a word, `servers` is a
 * word, and a `.mcp.json` belongs to whoever is reading this repository rather than to the repository.
 */

/**
 * What a shape is allowed to do to a repository that is not an agent system.
 *
 * `declines` is no component of an agent system kind at all. `developer_tooling` is components of such a
 * kind where every one of them carries the role saying whose they are, which is the fix for the `.mcp.json`
 * failure and the only reason a server may be declared without the repository becoming a system.
 *
 * Declared per row rather than left as the disjunction of the two, because "declines or carries the role"
 * is satisfied by a reader that has stopped reading the document altogether, and a row whose reader went
 * quiet is a row that tests nothing.
 */
export type LookalikeOutcome = 'declines' | 'developer_tooling';

export type LookalikeConfiguration = {
  readonly name: string;
  /** Where the shape is written, relative to the repository root. */
  readonly file: string;
  readonly outcome: LookalikeOutcome;
  /** What went wrong when this shape was read as a declaration, so removing the row is a decision. */
  readonly why: string;
  readonly contents: string;
};

export const LOOKALIKE_CONFIGURATIONS: readonly LookalikeConfiguration[] = [
  {
    name: 'developer-mcp-config',
    file: '.mcp.json',
    outcome: 'developer_tooling',
    why: 'a coding agent told where to connect, read as a declaration and reported as a 220 component Workers application that was a detected agent system holding no agent, no tool and no model',
    contents: `${JSON.stringify(
      { mcpServers: { docs: { command: 'uvx', args: ['docs-mcp-server'] } } },
      undefined,
      2,
    )}\n`,
  },
  {
    name: 'host-inventory',
    file: 'agents.yaml',
    outcome: 'declines',
    why: 'a monitoring inventory under a name no framework owns, which two constructed repositories were reported as detected agent systems on the strength of',
    contents: `node-exporter:
  host: metrics.internal
  port: 9100
otel-collector:
  host: collector.internal
  port: 4318
`,
  },
  {
    name: 'sales-roster',
    file: 'deploy/agents.yaml',
    outcome: 'declines',
    why: 'a roster whose entries carry a role and a goal, which passes the shape test completely and is caught only by asking whether the repository declares the framework whose layout puts a document there',
    contents: `east:
  role: Account Executive
  goal: Close the quarter.
west:
  role: Account Executive
  goal: Open the territory.
`,
  },
  {
    name: 'servers-inventory',
    file: 'deploy/agents.yaml',
    outcome: 'declines',
    why: 'hosts under a key anything may use, read as two MCP servers one of which declared permission to execute a binary, and caught by asking why a document was opened rather than what is in it',
    contents: `servers:
  web-01:
    command: /usr/sbin/nginx
    args: ['-g', 'daemon off;']
  db-01:
    url: https://db.internal:5432
`,
  },
  {
    name: 'declared-mcp-servers',
    file: 'deploy/agents.yaml',
    outcome: 'declines',
    why: 'the key an MCP client configuration writes, in a document opened for another kind entirely, which is the inventory above arriving through the door the key opens rather than the one the file name opens',
    contents: `mcpServers:
  fetch:
    command: uvx
    args: ['mcp-server-fetch']
`,
  },
  {
    name: 'root-mcp-servers',
    file: 'agents.yaml',
    outcome: 'declines',
    why: 'the same key, in the document CrewAI names, at the one path this build opens without waiting for the traversal, which is the door being on a fixed list opened and the origin could not see',
    contents: `mcpServers:
  fetch:
    command: uvx
    args: ['mcp-server-fetch']
`,
  },
  {
    name: 'root-roster',
    file: 'agents.yaml',
    outcome: 'declines',
    why: 'the roster above at the root instead of under deploy, which is the express failure at the path that was exempt from the gate that fixed it',
    contents: `east:
  role: Account Executive
  goal: Close the quarter.
west:
  role: Account Executive
  goal: Open the territory.
`,
  },
  {
    name: 'packaged-roster',
    file: 'config/agents.yaml',
    outcome: 'declines',
    why: 'the same roster where a CrewAI project keeps its agents, which is the other path the gate exempted',
    contents: `east:
  role: Account Executive
  goal: Close the quarter.
`,
  },
  {
    name: 'packaged-mcp-servers',
    file: 'config/agents.yaml',
    outcome: 'declines',
    why: "the same key at the same path, so that neither reader may read the other reader's document wherever this build knows the name",
    contents: `mcpServers:
  fetch:
    command: uvx
    args: ['mcp-server-fetch']
`,
  },
  {
    name: 'manifest-mcp-servers',
    file: '.orchescope/manifest.yaml',
    outcome: 'declines',
    why: "this build's own manifest carrying another reader's key, which is the same door and the one path the traversal never walks, so what proves this shape arrived is the manifest reader refusing it rather than a file count",
    contents: `mcpServers:
  fetch:
    command: uvx
    args: ['mcp-server-fetch']
`,
  },
  {
    name: 'workers-manifest',
    file: 'wrangler.toml',
    outcome: 'declines',
    why: 'the deployment manifest of the application the first recorded precision failure was reported against, so that what a platform binding declares stays a binding',
    contents: `name = "deployments"
main = "src/index.js"
compatibility_date = "2026-01-01"

[[queues.producers]]
queue = "jobs"
binding = "JOBS"
`,
  },
];
