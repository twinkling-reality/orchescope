import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { McpServerDetails } from '@orchescope/schema';
import {
  booleanValue,
  dotted,
  findEntry,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { asRecord, asString, asStringArray, jsonPointer } from '../config-files.ts';
import { configIdentity, createDrafts, sourceIdentity } from '../drafts.ts';
import { matchCalls, projectUses } from '../matching.ts';

/**
 * Model Context Protocol discovery, from configuration files and from SDK call sites.
 *
 * Four configuration shapes are read and they do not agree on the top level key: `.mcp.json`,
 * `.cursor/mcp.json` and `claude_desktop_config.json` use `mcpServers`, while `.vscode/mcp.json` uses
 * `servers`. A parser keyed only on `mcpServers` silently misses every VS Code workspace, so both keys
 * are read.
 *
 * Two limits are recorded rather than papered over. A configured server is a declaration, not proof
 * that the server ever ran, so these components start as declared and only reconciliation can promote
 * them to observed. And tool annotations such as `readOnlyHint` are self declared by the server: the
 * specification requires clients to treat them as untrusted, so they are stored as declarations to be
 * checked against behaviour.
 */

const SDK_PACKAGES = ['@modelcontextprotocol/sdk', 'mcp', 'fastmcp'];
const ADAPTER_ID = 'adapter:mcp';
const drafts = createDrafts(ADAPTER_ID);

const CONFIG_KEYS = ['mcpServers', 'servers'] as const;

/** Environment variable placeholders that configuration files may contain. */
const PLACEHOLDER = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;

const placeholders = (value: string): readonly string[] => {
  const names: string[] = [];
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (match[1] !== undefined) names.push(match[1]);
  }
  return names;
};

type Transport = NonNullable<McpServerDetails['transport']>;

const transportOf = (entry: Record<string, unknown>): Transport => {
  const declared = asString(entry['type']) ?? asString(entry['transport']);
  if (declared === 'stdio' || declared === 'http' || declared === 'sse') return declared;
  if (asString(entry['url']) !== undefined) return 'http';
  if (asString(entry['command']) !== undefined) return 'stdio';
  return 'unknown';
};

/**
 * A placeholder in a command, a url or an environment value means the declaration is incomplete: the server cannot be
 * reached without something this repository does not contain. That is recorded rather than resolved.
 */
const unresolvedNamesIn = (
  command: string | undefined,
  url: string | undefined,
  env: Record<string, unknown> | undefined,
): readonly string[] => [
  ...placeholders(command ?? ''),
  ...placeholders(url ?? ''),
  ...(env === undefined
    ? []
    : Object.values(env).flatMap((value) =>
        typeof value === 'string' ? placeholders(value) : [],
      )),
];

const addDeclaredServer = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  where: { readonly configFile: string; readonly configKey: string; readonly name: string },
  entry: Record<string, unknown>,
): { readonly unresolved: boolean } => {
  const command = asString(entry['command']);
  const url = asString(entry['url']);
  const args = asStringArray(entry['args']);
  const env = asRecord(entry['env']);
  const envKeys = env === undefined ? [] : Object.keys(env);
  const unresolvedNames = unresolvedNamesIn(command, url, env);

  builder.addComponent(
    drafts.configComponent({
      kind: 'mcp_server',
      configFile: where.configFile,
      pointer: jsonPointer([where.configKey, where.name]),
      name: where.name,
      ...(command === undefined && url === undefined ? {} : { value: command ?? url ?? '' }),
      details: {
        for: 'mcp_server',
        transport: transportOf(entry),
        ...(command === undefined ? {} : { command }),
        ...(url === undefined ? {} : { url }),
        argsCount: args.length,
        ...(envKeys.length === 0 ? {} : { envKeys }),
      },
      permissions:
        url === undefined
          ? [{ kind: 'process', scope: command ?? 'unknown', mode: 'execute' }]
          : [{ kind: 'network', scope: url, mode: 'write' }],
      metadata: {
        declaredIn: where.configFile,
        configKey: where.configKey,
        ...(unresolvedNames.length === 0
          ? {}
          : { unresolvedPlaceholders: [...new Set(unresolvedNames)] }),
        ...(entry['envFile'] === undefined ? {} : { envFile: String(entry['envFile']) }),
        runtimeName: where.name,
      },
      tags: ['mcp', 'declared'],
    }),
  );
  context.bindings.register(
    where.configFile,
    where.name,
    configIdentity('mcp_server', where.configFile, where.name),
  );
  return { unresolved: unresolvedNames.length > 0 || entry['envFile'] !== undefined };
};

const discoverFromConfig = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { components: number; unresolved: number } => {
  let components = 0;
  let unresolved = 0;

  for (const document of context.configs) {
    const root = asRecord(document.data);
    if (root === undefined) continue;
    for (const configKey of CONFIG_KEYS) {
      const servers = asRecord(root[configKey]);
      if (servers === undefined) continue;
      for (const [name, rawEntry] of Object.entries(servers)) {
        const entry = asRecord(rawEntry);
        if (entry === undefined) continue;
        const added = addDeclaredServer(
          context,
          builder,
          { configFile: document.path, configKey, name },
          entry,
        );
        components += 1;
        if (added.unresolved) unresolved += 1;
      }
    }
  }
  return { components, unresolved };
};

type SdkMatch = ReturnType<typeof matchCalls>[number];

const serverNameOf = (match: SdkMatch): string => {
  const entries = objectArgument(match.call);
  const positional = match.call.args[0];
  return (
    stringValue(findEntry(entries, 'name')?.value) ??
    (positional !== undefined && positional.kind === 'string' ? positional.value : undefined) ??
    'mcp-server'
  );
};

/**
 * Tool annotations as the server declares them.
 *
 * These are the server's own claims about its tools, not facts about their behaviour, which is why the component records
 * `annotationsAreSelfDeclared` alongside them.
 */
const annotationDetails = (
  config: SdkMatch['call']['args'][number] | undefined,
): Record<string, boolean> => {
  const annotations =
    config !== undefined && config.kind === 'object'
      ? findEntry(config.entries, 'annotations')?.value
      : undefined;
  const entries =
    annotations !== undefined && annotations.kind === 'object' ? annotations.entries : [];
  const details: Record<string, boolean> = {};
  for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
    const value = booleanValue(findEntry(entries, hint)?.value);
    if (value !== undefined) details[hint] = value;
  }
  return details;
};

const discoverServers = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  files: Set<string>,
): { readonly components: number; readonly matches: readonly SdkMatch[] } => {
  const matches = matchCalls(context.modules, {
    names: ['McpServer', 'Server', 'FastMCP'],
    packages: SDK_PACKAGES,
  });
  for (const match of matches) {
    const name = serverNameOf(match);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'mcp_server',
        file: match.module.file,
        name,
        location: match.call.location,
        symbol: dotted(match.call.calleePath),
        confidence: match.confidence,
        details: { for: 'mcp_server', transport: 'stdio' },
        metadata: { role: 'server', runtimeName: name },
        tags: ['mcp', 'server'],
      }),
    );
    files.add(match.module.file);
    context.bindings.register(
      match.module.file,
      name,
      sourceIdentity('mcp_server', match.module.file, name),
    );
  }
  return { components: matches.length, matches };
};

const discoverTools = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  servers: readonly SdkMatch[],
  files: Set<string>,
): { components: number; edges: number } => {
  let components = 0;
  let edges = 0;
  const registrations = matchCalls(context.modules, {
    names: ['registerTool', 'tool', 'setRequestHandler', 'add_tool'],
    packages: SDK_PACKAGES,
  });

  for (const match of registrations) {
    const first = match.call.args[0];
    if (first === undefined || first.kind !== 'string') continue;
    const toolName = first.value;
    const config = match.call.args[1];
    const description =
      config !== undefined && config.kind === 'object'
        ? stringValue(findEntry(config.entries, 'description')?.value)
        : undefined;

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'tool',
        file: match.module.file,
        name: toolName,
        location: match.call.location,
        symbol: dotted(match.call.calleePath),
        confidence: match.confidence,
        ...(description === undefined ? {} : { description }),
        details: { for: 'tool', ...annotationDetails(config) },
        metadata: {
          declaredBy: 'mcp-server',
          runtimeName: toolName,
          annotationsAreSelfDeclared: true,
        },
        tags: ['mcp', 'tool'],
      }),
    );
    components += 1;
    files.add(match.module.file);
    const toolIdentity = sourceIdentity('tool', match.module.file, toolName);
    context.bindings.register(match.module.file, toolName, toolIdentity);

    const server = servers.find((candidate) => candidate.module.file === match.module.file);
    if (server === undefined) continue;
    builder.addEdge(
      drafts.edge({
        kind: 'provides_tool',
        from: sourceIdentity('mcp_server', match.module.file, serverNameOf(server)),
        to: toolIdentity,
        location: match.call.location,
        symbol: `${dotted(match.call.calleePath)}("${toolName}")`,
        confidence: CONFIDENCE_BANDS.strongStructural,
      }),
    );
    edges += 1;
  }
  return { components, edges };
};

const discoverFromSdk = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { components: number; edges: number; files: Set<string> } => {
  const files = new Set<string>();
  const servers = discoverServers(context, builder, files);
  const tools = discoverTools(context, builder, servers.matches, files);
  return { components: servers.components + tools.components, edges: tools.edges, files };
};

export const mcpAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'configuration',
  appliesTo: (context) =>
    projectUses(context, SDK_PACKAGES) ||
    context.configs.some((document) => {
      const root = asRecord(document.data);
      return root !== undefined && CONFIG_KEYS.some((key) => root[key] !== undefined);
    }),
  discover: (context, builder): AdapterFindings => {
    const fromConfig = discoverFromConfig(context, builder);
    const fromSdk = discoverFromSdk(context, builder);
    return {
      componentsFound: fromConfig.components + fromSdk.components,
      edgesFound: fromSdk.edges,
      filesInspected: fromSdk.files.size + context.configs.length,
      ...(fromConfig.unresolved === 0
        ? {}
        : {
            note: `${fromConfig.unresolved} server entries contain placeholders or an env file, so their full configuration cannot be resolved statically`,
          }),
    };
  },
};
