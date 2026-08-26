import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { McpServerDetails } from '@orchescope/schema';
import {
  booleanValue,
  type CallFact,
  dotted,
  findEntry,
  type ModuleFacts,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import {
  asRecord,
  asString,
  asStringArray,
  type ConfigOrigin,
  jsonPointer,
} from '../config-files.ts';
import { configIdentity, createDrafts, sourceIdentity } from '../drafts.ts';
import { implementationBody } from '../implementation-span.ts';
import { localModules, namesLocalModule, namesLocalSpecifier } from '../local-modules.ts';
import { definitionForCall, projectUses } from '../matching.ts';
import {
  anchoredProtocolMethod,
  carriesHandshakeCapabilities,
  carriesStdioServerEntry,
  namesServerRole,
  namesTransportSymbol,
  receiverOf,
  serverCapabilityNamed,
  unanchoredProtocolMethod,
} from '../model-context-protocol.ts';

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

/**
 * The distributions this reader claims, which is an ownership table and not a gate.
 *
 * It was three things at once and two of them were defects. It decided whether this adapter ran at all, so
 * a repository using a fourth SDK never reached the reader; it decided which constructions were recognised,
 * so a server built with that SDK was invisible even once it did. Both of those now ask the protocol
 * instead. What is left is the claim: which names this reader says it reads, so that a distribution it
 * claims and finds nothing in is reported as a gap in Orchescope rather than as an empty repository.
 * [ADR 0015](../../../../docs/architecture/adr/0015-the-asymmetric-invariant.md) permits a name in that
 * role and requires it to be measurable, which is why the corpus now reports a name matching no pinned
 * repository. Two entries of the symbol and method lists this reader used to gate on matched nothing across
 * fifty six repositories, and nobody knew.
 */
const CLAIMED_PACKAGES = ['@modelcontextprotocol/sdk', 'mcp', 'fastmcp'];
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
         * Every document this adapter is entitled to read by its content is a coding agent's or an
         * editor's own configuration, so what is declared in one is the developer's and not the
         * repository's. A server the repository itself connects to is read from the source that
         * constructs the client, which is where `consumed` comes from and where it can be attributed to
         * the file making the connection rather than to a file naming a command.
         */
        role: 'developer_tooling',
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
 * else a detected agent system.
 *
 * Being on the fixed list is not the entitlement, because that list was collected for three readers. Asking
 * for it admitted `agents.yaml`, `config/agents.yaml`, `crew.jsonc` and this build's own manifest, and an
 * `mcpServers` key written into any of the four was read here as a declared server. The entitlement is that
 * the document was opened as a coding agent's own configuration, which is the one reason a key naming a
 * command belongs to this adapter at all.
 */
const readableHere = (document: { readonly origin: ConfigOrigin }): boolean =>
  document.origin === 'agent_client';

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

/**
 * A server construction and the module it sits in, which is all the rest of this reader needs of one.
 *
 * It was `ReturnType<typeof matchCalls>[number]` while the gate was a call matcher. The gate is now a
 * question about the protocol, so the shape is written out rather than borrowed from a matcher that is no
 * longer asked.
 */
type SdkMatch = {
  readonly call: CallFact;
  readonly module: ModuleFacts;
  readonly confidence: number;
  readonly resolved: boolean;
};

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

/** The scope and name a value was bound under, which is how one file may bind two servers. */
const receiverKeyOf = (enclosing: string | undefined, name: string): string =>
  `${enclosing ?? '<module>'}|${name}`;

/**
 * Servers this repository implements, recognised by the protocol they serve rather than by who published
 * the library.
 *
 * The gate was a conjunction of two name lists: three symbols and three distributions. Both were measured
 * against fifty six pinned repositories and both were partly dead. The symbol `Server` matched nothing; so
 * did the registration methods `setRequestHandler` and `add_tool`. A list nobody can see rot is a list that
 * rots.
 *
 * What replaces the distribution half is protocol evidence about the value that was built: a construction is
 * a server when something is registered on it whose name carries one of the specification's own server
 * capability nouns. The conjunction is what makes it precise. Measured without a registration, the symbol
 * test alone yields a hundred and thirty nine sites of `McpError`, `McpCapabilities` and `MCP` against
 * twenty one real servers.
 *
 * The provenance gate is the narrow one deliberately. The broad `namesDefinedPackage` reports `mcp` as this
 * repository's own on `openai-agents-python`, which writes `src/agents/mcp/`, and using it here loses all
 * six of that repository's real servers.
 *
 * Measured against the shipped allowlist: nineteen servers on eight of fifty six entries, zero on all eight
 * pinned negatives, recovering twenty of the twenty one sites the allowlist finds. The one it does not is a
 * `FastMCP` whose bound value carries no registration anywhere in its module, and about that value the
 * source says only which library it came from.
 */
/** Names bound to a transport construction, so a value connected to one can be recognised a line later. */
const transportsBoundIn = (module: ModuleFacts): ReadonlySet<string> => {
  const bound = new Set<string>();
  for (const definition of module.definitions) {
    const symbol = definition.initializer?.[0];
    if (definition.kind !== 'variable' || symbol === undefined) continue;
    if (namesTransportSymbol(symbol)) bound.add(definition.name);
  }
  for (const assignment of module.assignments) {
    const symbol = assignment.value?.kind === 'call' ? assignment.value.path[0] : undefined;
    if (symbol !== undefined && namesTransportSymbol(symbol)) {
      bound.add(assignment.target.join('.'));
    }
  }
  return bound;
};

/** The exported symbol a construction was made through, which is the name the protocol has to be in. */
const constructedSymbol = (call: CallFact): string | undefined => {
  const origin = call.origin;
  if (origin === undefined || origin.isType) return undefined;
  if (origin.imported !== '*' && origin.imported !== 'default') return origin.imported;
  return call.calleePath[call.calleePath.length - 1];
};

/** Values built from a distribution through a symbol naming the protocol's server role, by scope and name. */
const serverConstructionsIn = (
  module: ModuleFacts,
  local: ReturnType<typeof localModules>,
): ReadonlyMap<string, { readonly symbol: string; readonly call: CallFact }> => {
  const built = new Map<string, { readonly symbol: string; readonly call: CallFact }>();
  for (const call of module.calls) {
    const symbol = constructedSymbol(call);
    const origin = call.origin;
    if (symbol === undefined || origin === undefined || !namesServerRole(symbol)) continue;
    if (namesLocalSpecifier(origin.module, module.language)) continue;
    if (namesLocalModule(local, module, origin.module)) continue;
    const bound = definitionForCall(module, call);
    if (bound?.kind !== 'variable') continue;
    built.set(receiverKeyOf(bound.enclosing, bound.name), { symbol, call });
  }
  return built;
};

/** Receivers something was registered on whose name carries one of the specification's capability nouns. */
const capabilityRegistrationsIn = (module: ModuleFacts): ReadonlySet<string> => {
  const registered = new Set<string>();
  for (const call of module.calls) {
    const method = call.calleePath[call.calleePath.length - 1];
    const receiver = receiverOf(call);
    if (method === undefined || receiver === undefined) continue;
    if (serverCapabilityNamed(method) !== undefined) {
      registered.add(receiverKeyOf(call.enclosing, receiver));
    }
  }
  for (const definition of module.definitions) {
    for (const decorator of definition.decorators) {
      const method = decorator.path[decorator.path.length - 1];
      if (method === undefined || decorator.path.length < 2) continue;
      if (serverCapabilityNamed(method) === undefined) continue;
      registered.add(receiverKeyOf(definition.enclosing, decorator.path.slice(0, -1).join('.')));
    }
  }
  return registered;
};

const protocolServerMatches = (context: DiscoveryContext): readonly SdkMatch[] => {
  const local = localModules(context.modules);
  const matches: SdkMatch[] = [];
  for (const module of context.modules) {
    const built = serverConstructionsIn(module, local);
    if (built.size === 0) continue;
    const registered = capabilityRegistrationsIn(module);
    const transports = transportsBoundIn(module);
    for (const [key, construction] of built) {
      const name = key.slice(key.indexOf('|') + 1);
      if (!registered.has(key) && !transports.has(name)) continue;
      matches.push({
        call: construction.call,
        module,
        confidence: CONFIDENCE_BANDS.deterministic,
        resolved: true,
      });
    }
  }
  return matches;
};

const discoverServers = (
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  files: Set<string>,
): { readonly components: number; readonly matches: readonly SdkMatch[] } => {
  const matches = protocolServerMatches(context);
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
    if (variable?.kind === 'variable')
      context.bindings.register(match.module.file, variable.name, identity);
  }
  return { components: matches.length, matches };
};

/** The variable a server was assigned to, per file, so a decorator on it can be attributed. */
const receiverKey = (file: string, enclosing: string | undefined, name: string): string =>
  `${file}|${enclosing ?? '<module>'}|${name}`;

const serversByVariable = (
  servers: readonly SdkMatch[],
): ReadonlyMap<string, { readonly server: SdkMatch; readonly name: string }> => {
  const byVariable = new Map<string, { server: SdkMatch; name: string }>();
  for (const server of servers) {
    const variable = definitionForCall(server.module, server.call);
    if (variable?.kind !== 'variable') continue;
    const definitions = server.module.definitions.filter(
      (candidate) => candidate.name === variable.name && candidate.enclosing === variable.enclosing,
    );
    const reassigned = server.module.assignments.some(
      (assignment) => assignment.target.length === 1 && assignment.target[0] === variable.name,
    );
    if (definitions.length !== 1 || reassigned) continue;
    byVariable.set(receiverKey(server.module.file, variable.enclosing, variable.name), {
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

  for (const module of context.modules) {
    for (const definition of module.definitions) {
      for (const decorator of definition.decorators) {
        const method = decorator.path[decorator.path.length - 1];
        const owner = decorator.path[0];
        if (method !== 'tool' || owner === undefined || decorator.path.length < 2) continue;
        const server = byVariable.get(receiverKey(module.file, definition.enclosing, owner));
        if (server === undefined) continue;

        const first = decorator.args[0];
        const entries = first !== undefined && first.kind === 'object' ? first.entries : [];
        const toolName = stringValue(findEntry(entries, 'name')?.value) ?? definition.name;
        const description = stringValue(findEntry(entries, 'description')?.value);
        const identity = sourceIdentity('tool', module.file, toolName);

        builder.addComponent(
          drafts.sourceComponent({
            kind: 'tool',
            file: module.file,
            name: toolName,
            location: definition.location,
            symbol: `@${owner}.${method} ${definition.name}`,
            confidence: CONFIDENCE_BANDS.deterministic,
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
        files.add(module.file);
        context.bindings.register(module.file, definition.name, identity);
        context.bindings.register(module.file, toolName, identity);
        // A decorated tool states its body exactly: the definition the decorator is attached to.
        context.implementations.record({
          identity,
          file: module.file,
          body: definition.location,
          symbol: `@${owner}.${method} ${definition.name}`,
        });

        builder.addEdge(
          drafts.edge({
            kind: 'provides_tool',
            from: sourceIdentity('mcp_server', module.file, server.name),
            to: identity,
            location: definition.location,
            symbol: `@${owner}.${method} ${toolName}`,
            confidence: CONFIDENCE_BANDS.strongStructural,
          }),
        );
        edges += 1;
        break;
      }
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
  const byVariable = serversByVariable(servers);

  for (const module of context.modules) {
    for (const call of module.calls) {
      const method = call.calleePath[call.calleePath.length - 1];
      const owner = call.calleePath[0];
      if (
        method === undefined ||
        owner === undefined ||
        call.calleePath.length < 2 ||
        !['registerTool', 'tool', 'setRequestHandler', 'add_tool'].includes(method)
      ) {
        continue;
      }
      const server = byVariable.get(receiverKey(module.file, call.enclosing, owner));
      if (server === undefined) continue;
      const first = call.args[0];
      if (first === undefined || first.kind !== 'string') continue;
      const toolName = first.value;
      const config = call.args[1];
      const description =
        config !== undefined && config.kind === 'object'
          ? stringValue(findEntry(config.entries, 'description')?.value)
          : undefined;

      builder.addComponent(
        drafts.sourceComponent({
          kind: 'tool',
          file: module.file,
          name: toolName,
          location: call.location,
          symbol: dotted(call.calleePath),
          confidence: server.server.confidence,
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
      files.add(module.file);
      const toolIdentity = sourceIdentity('tool', module.file, toolName);
      context.bindings.register(module.file, toolName, toolIdentity);
      /*
       * The tool body is the exact inline function argument or the uniquely settled function binding.
       * The surrounding registration and its other configuration arguments do not execute as tool behaviour.
       */
      const body = [...call.args]
        .reverse()
        .map((argument) => implementationBody(module, call, argument))
        .find((candidate) => candidate !== undefined);
      if (body !== undefined) {
        context.implementations.record({
          identity: toolIdentity,
          file: module.file,
          body,
          symbol: `${dotted(call.calleePath)}("${toolName}")`,
        });
      }

      builder.addEdge(
        drafts.edge({
          kind: 'provides_tool',
          from: sourceIdentity('mcp_server', module.file, server.name),
          to: toolIdentity,
          location: call.location,
          symbol: `${dotted(call.calleePath)}("${toolName}")`,
          confidence: CONFIDENCE_BANDS.strongStructural,
        }),
      );
      edges += 1;
    }
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

/**
 * Whether this repository shows the protocol, whatever library it shows it through.
 *
 * The gate was `projectUses(context, CLAIMED_PACKAGES)`, so a repository built on an SDK nobody had listed
 * never reached this reader at all. `workflows-acp` is that repository: it drives Model Context Protocol
 * sessions through `mcp_use`, which is on no list, and `mcp_use.client` does not match `mcp` under
 * `moduleMatches` because a Python distribution normalised from a hyphen is not a sub-path of another one.
 *
 * Five questions, all of them the specification's. A call site spelling one of its methods and carrying that
 * method's own params. A call on a receiver an anchored call already settled, for the methods the
 * specification leaves paramless. A construction carrying the `initialize` handshake. A stdio server entry
 * written in source, which is the same `{command, args, env}` the configuration half reads under
 * `mcpServers`. And a server this repository implements, because a repository that serves the protocol shows
 * it as surely as one that calls it, and the recognition half already knows how to see one.
 *
 * The specification's other server entry, `{url, headers}`, is deliberately not among them. It is what every
 * HTTP client takes, and measured it made `axios` a repository that shows the Model Context Protocol.
 *
 * Widening a gate that decides only whether a reader runs is safe in a way widening recognition is not: an
 * adapter that runs and finds nothing says so, and that sentence is the honest one. Measured over fifty six
 * pinned repositories this changes no entry's applicability, because every repository showing the protocol
 * already imports a claimed name or declares a server in configuration. That number is reported rather than
 * hidden: the widening is provably correct and provably worth nothing on this corpus, and what it is for is
 * the SDK that is not pinned yet.
 */
const showsTheProtocol = (context: DiscoveryContext): boolean => {
  /* The call shapes first, because they answer from one pass and the server scan builds maps. */
  for (const module of context.modules) {
    const settled = new Set<string>();
    for (const call of module.calls) {
      if (carriesHandshakeCapabilities(call) || carriesStdioServerEntry(call)) return true;
      const receiver = receiverOf(call);
      if (anchoredProtocolMethod(call) !== undefined) {
        if (receiver !== undefined) settled.add(receiver);
        return true;
      }
      if (unanchoredProtocolMethod(call) && receiver !== undefined && settled.has(receiver)) {
        return true;
      }
    }
  }
  return protocolServerMatches(context).length > 0;
};

export const mcpAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  packages: CLAIMED_PACKAGES,
  appliesTo: (context) =>
    showsTheProtocol(context) ||
    projectUses(context, CLAIMED_PACKAGES) ||
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
