import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OrchescopeError, stableJson } from '@orchescope/domain';

/**
 * Registering Orchescope with a coding agent.
 *
 * Each client keeps its server list in a different file under a different top level key, so the shape is written
 * per client rather than guessed. An existing file is merged rather than replaced, and an existing entry is left
 * alone unless the caller asked to overwrite it, because clobbering a user's configuration to save a prompt is not
 * a trade worth making.
 */

export type McpClient = 'claude-code' | 'vscode' | 'cursor' | 'claude-desktop';

export type InstallTarget = {
  readonly client: McpClient;
  readonly file: string;
  readonly key: 'mcpServers' | 'servers';
  readonly description: string;
};

export const installTargets = (repositoryRoot: string, home: string): readonly InstallTarget[] => [
  {
    client: 'claude-code',
    file: join(repositoryRoot, '.mcp.json'),
    key: 'mcpServers',
    description: 'project scoped, shared with anyone who checks out this repository',
  },
  {
    client: 'vscode',
    file: join(repositoryRoot, '.vscode', 'mcp.json'),
    key: 'servers',
    description: 'workspace scoped for editors that read .vscode/mcp.json',
  },
  {
    client: 'cursor',
    file: join(repositoryRoot, '.cursor', 'mcp.json'),
    key: 'mcpServers',
    description: 'project scoped for Cursor',
  },
  {
    client: 'claude-desktop',
    file: join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    key: 'mcpServers',
    description: 'user scoped on macOS',
  },
];

export type InstallResult = {
  readonly file: string;
  readonly action: 'created' | 'updated' | 'unchanged';
  readonly detail: string;
};

export type InstallOptions = {
  readonly target: InstallTarget;
  readonly command: string;
  readonly args: readonly string[];
  readonly overwrite: boolean;
  readonly serverName?: string;
};

export const installServer = (options: InstallOptions): InstallResult => {
  const name = options.serverName ?? 'orchescope';
  const entry = {
    command: options.command,
    args: [...options.args],
    env: {},
  };

  let document: Record<string, unknown> = {};
  if (existsSync(options.target.file)) {
    try {
      const parsed = JSON.parse(readFileSync(options.target.file, 'utf8')) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        document = parsed as Record<string, unknown>;
      }
    } catch (error) {
      throw new OrchescopeError(
        'CONFIG_INVALID',
        `${options.target.file} exists but is not valid JSON, so it was left untouched.`,
        { cause: error, remediation: 'Fix the file by hand, then run the install again.' },
      );
    }
  }

  const existing = document[options.target.key];
  const servers =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if (servers[name] !== undefined && !options.overwrite) {
    return {
      file: options.target.file,
      action: 'unchanged',
      detail: `an entry named ${name} already exists; pass the overwrite option to replace it`,
    };
  }

  const created = !existsSync(options.target.file);
  servers[name] = entry;
  document[options.target.key] = servers;
  mkdirSync(dirname(options.target.file), { recursive: true });
  writeFileSync(options.target.file, `${stableJson(document)}\n`, { mode: 0o600 });

  return {
    file: options.target.file,
    action: created ? 'created' : 'updated',
    detail: `registered ${name} under ${options.target.key}`,
  };
};
