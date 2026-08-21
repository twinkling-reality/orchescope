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
import {
  asRecord,
  asString,
  asStringArray,
  type ConfigOrigin,
  isAgentClientConfig,
  jsonPointer,
} from '../config-files.ts';
import { configIdentity, createDrafts, sourceIdentity } from '../drafts.ts';
import { decoratedDefinitions, definitionForCall, matchCalls, projectUses } from '../matching.ts';

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
        /*
         * A coding agent's configuration file is the developer's, not the repository's. Any other file
         * carrying an `mcpServers` key is the repository declaring a server it connects to, which is
         * part of the system whether or not this repository implements it.
         */
        role: isAgentClientConfig(where.configFile) ? 'developer_tooling' : 'consumed',
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

/**
 * Documents this adapter is entitled to read by their content.
 *
 * `mcpServers` is a key nothing else writes, and `servers` is a word anything may use for anything. A
 * document opened because it carried some other kind's file name is not this adapter's to interpret: a
 * `servers` inventory of hosts and ports under a `deploy/agents.yaml` produced two MCP servers, one of them
 * declaring permission to execute `/usr/sbin/nginx`, and made a repository depending on express and nothing
 * else a detected agent system. A path on the fixed list was opened because this build knows the name, which
 * is the entitlement this asks for.
 */
const readableHere = (document: { readonly origin: ConfigOrigin }): boolean =>
  document.origin === 'known_path';

/** Only the documents that declare a server, because the rest were parsed by the scan and read by nobody. */
const discoverFromConfig = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
): { components: number; unresolved: number; files: readonly string[] } => {
  let components = 0;
  let unresolved = 0;
  const files: string[] = [];

  for (const document of context.configs) {
    if (!readableHere(document)) continue;
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
        // Counted where a server was read, so a document holding an empty server map is not claimed as read.
        files.push(document.path);
        if (added.unresolved) unresolved += 1;
      }
    }
  }
  return { components, unresolved, files: [...new Set(files)] };
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
        details: { for: 'mcp_server', transport: 'stdio', role: 'implemented' },
        metadata: { role: 'server', runtimeName: name },
        tags: ['mcp', 'server'],
      }),
    );
    files.add(match.module.file);
    const identity = sourceIdentity('mcp_server', match.module.file, name);
    context.bindings.register(match.module.file, name, identity);
    // The variable too, because `@mcp.tool()` names the variable rather than the server.
    const variable = definitionForCall(match.module, match.call);
    if (variable !== undefined)
      context.bindings.register(match.module.file, variable.name, identity);
  }
  return { components: matches.length, matches };
};

/** The variable a server was assigned to, per file, so a decorator on it can be attributed. */
const serversByVariable = (
  servers: readonly SdkMatch[],
): ReadonlyMap<string, { readonly server: SdkMatch; readonly name: string }> => {
  const byVariable = new Map<string, { server: SdkMatch; name: string }>();
  for (const server of servers) {
    const variable = definitionForCall(server.module, server.call);
    if (variable === undefined) continue;
    byVariable.set(`${server.module.file}|${variable.name}`, {
      server,
      name: serverNameOf(server),
    });
  }
  return byVariable;
};

/**
 * Tools registered by decorating a function, which is how the Python SDK documents it.
 *
 * `@mcp.tool()` takes its name from the function unless the decorator overrides it, exactly as the library does at
 * run time, and the decorated function's own docstring is not read as a description because a docstring is written
 * for a developer while a tool description is written for a model. A decorator whose receiver is not a server this
 * adapter found is left alone: `tool` is too common a name to claim on its own.
 */
const discoverDecoratedTools = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  servers: readonly SdkMatch[],
  files: Set<string>,
): { components: number; edges: number } => {
  let components = 0;
  let edges = 0;
  const byVariable = serversByVariable(servers);

  for (const decorated of decoratedDefinitions(context.modules, ['tool'], SDK_PACKAGES)) {
    for (const decorator of decorated.definition.decorators) {
      const method = decorator.path[decorator.path.length - 1];
      const owner = decorator.path[0];
      if (method !== 'tool' || owner === undefined || decorator.path.length < 2) continue;
      const server = byVariable.get(`${decorated.module.file}|${owner}`);
      if (server === undefined) continue;

      const first = decorator.args[0];
      const entries = first !== undefined && first.kind === 'object' ? first.entries : [];
      const toolName = stringValue(findEntry(entries, 'name')?.value) ?? decorated.definition.name;
      const description = stringValue(findEntry(entries, 'description')?.value);
      const identity = sourceIdentity('tool', decorated.module.file, toolName);

      builder.addComponent(
        drafts.sourceComponent({
          kind: 'tool',
          file: decorated.module.file,
          name: toolName,
          location: decorated.definition.location,
          symbol: `@${owner}.${method} ${decorated.definition.name}`,
          confidence: decorated.resolved
            ? CONFIDENCE_BANDS.deterministic
            : CONFIDENCE_BANDS.heuristic,
          ...(description === undefined ? {} : { description }),
          details: { for: 'tool', ...annotationDetails(first) },
          metadata: {
            declaredBy: 'mcp-server',
            runtimeName: toolName,
            annotationsAreSelfDeclared: true,
          },
          tags: ['mcp', 'tool'],
        }),
      );
      components += 1;
      files.add(decorated.module.file);
      context.bindings.register(decorated.module.file, decorated.definition.name, identity);
      context.bindings.register(decorated.module.file, toolName, identity);
      // A decorated tool states its body exactly: the definition the decorator is attached to.
      context.implementations.record({
        identity,
        file: decorated.module.file,
        body: decorated.definition.location,
        symbol: `@${owner}.${method} ${decorated.definition.name}`,
      });

      builder.addEdge(
        drafts.edge({
          kind: 'provides_tool',
          from: sourceIdentity('mcp_server', decorated.module.file, server.name),
          to: identity,
          location: decorated.definition.location,
          symbol: `@${owner}.${method} ${toolName}`,
          confidence: CONFIDENCE_BANDS.strongStructural,
        }),
      );
      edges += 1;
      break;
    }
  }
  return { components, edges };
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
    /*
     * The registration call is the tool's body: the handler is an argument to it, and an inline
     * function argument carries no location of its own. What that body reaches is the tool's own
     * behaviour, and nothing joined the two until it was recorded here.
     */
    context.implementations.record({
      identity: toolIdentity,
      file: match.module.file,
      body: match.call.location,
      symbol: `${dotted(match.call.calleePath)}("${toolName}")`,
    });

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
  const decorated = discoverDecoratedTools(context, builder, servers.matches, files);
  return {
    components: servers.components + tools.components + decorated.components,
    edges: tools.edges + decorated.edges,
    files,
  };
};

export const mcpAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  packages: SDK_PACKAGES,
  appliesTo: (context) =>
    projectUses(context, SDK_PACKAGES) ||
    context.configs.some((document) => {
      if (!readableHere(document)) return false;
      const root = asRecord(document.data);
      return root !== undefined && CONFIG_KEYS.some((key) => root[key] !== undefined);
    }),
  discover: (context, builder): AdapterFindings => {
    const fromConfig = discoverFromConfig(context, builder);
    const fromSdk = discoverFromSdk(context, builder);
    return {
      componentsFound: fromConfig.components + fromSdk.components,
      edgesFound: fromSdk.edges,
      filesInspected: [...fromSdk.files, ...fromConfig.files],
      ...(fromConfig.unresolved === 0
        ? {}
        : {
            note: `${fromConfig.unresolved} server entries contain placeholders or an env file, so their full configuration cannot be resolved statically`,
          }),
    };
  },
};
