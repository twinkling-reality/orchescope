import { CONFIDENCE_BANDS, INFERRED_ENTRY_POINT_TAG, isTestFile } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';
import type { ArgumentFact, CallFact, ImportFact, ModuleFacts } from '@orchescope/source-analysis';
import {
  calleeName,
  dotted,
  findEntry,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type {
  AdapterApplicability,
  AdapterFindings,
  AgentSystemAdapter,
  DiscoveryContext,
} from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { localModules, namesLocalModule } from '../local-modules.ts';
import {
  definitionForCall,
  hasLocalBinding,
  matchRuntimeSymbol,
  moduleMatches,
} from '../matching.ts';
import { type ResolvedSourceValue, resolveSourceValue } from '../source-value.ts';

/**
 * A search index a repository retrieves documents from.
 *
 * `retrieval` was a component kind nothing produced. `prompt-injection-boundary` reads it as one of the
 * three sources whose content nobody can vouch for, and until now the only two that could ever exist
 * were a tool and an MCP server, so a retrieval application read as a repository that retrieves nothing.
 * A field report's target is exactly that shape: search results reach `build_conversation` four lines
 * from where the prompt is assembled, and the rule reported that no source had been discovered.
 *
 * The index is named for what the source names, because two call sites querying one index are querying
 * one thing and a reader acting on this needs to know which index it is. Where the name is built at run
 * time the client is named for its package, which is the honest limit and still one component per
 * service rather than one per call site.
 *
 * What a retrieval reaches is not classified as a write. A search is a read whatever the index does
 * internally, and the effect class this carries is what a rule asking about consequential operations
 * reads.
 */

const SEARCH_CLIENTS = [
  {
    service: 'azure-ai-search',
    packages: ['azure.search.documents', 'azure-search-documents', '@azure/search-documents'],
    /** The clients that answer a query. An index management client administers rather than retrieves. */
    clients: ['SearchClient', 'KnowledgeBaseRetrievalClient'],
    /** The keyword each client names its index with, which differs between the two. */
    indexKeys: ['index_name', 'indexName', 'knowledge_base_name', 'knowledgeBaseName'],
    methods: ['search', 'retrieve'],
    configurableName: undefined,
  },
  {
    service: 'duckduckgo',
    packages: ['duckduckgo_search'],
    clients: ['DDGS'],
    indexKeys: [],
    methods: ['text'],
    configurableName: 'duckduckgo',
  },
  {
    service: 'tavily',
    packages: ['tavily'],
    clients: ['TavilyClient'],
    indexKeys: [],
    methods: ['search'],
    configurableName: 'tavily',
  },
  {
    service: 'searxng',
    packages: ['langchain_community.utilities'],
    clients: ['SearxSearchWrapper'],
    indexKeys: [],
    methods: ['results'],
    configurableName: 'searxng',
  },
] as const;

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';

const ADAPTER_ID = 'adapter:search-index';
const drafts = createDrafts(ADAPTER_ID);

const ALL_PACKAGES = SEARCH_CLIENTS.flatMap((entry) => [...entry.packages]);

type Service = (typeof SEARCH_CLIENTS)[number];

const retrievalIdentity = (name: string): ComponentIdentity =>
  globalIdentity('retrieval', GLOBAL_NAMESPACES.retrieval, name);

/** The index a construction names, which is what makes two call sites one component. */
const indexNamedBy = (call: CallFact, service: Service): string | undefined => {
  const entries = objectArgument(call);
  for (const key of service.indexKeys) {
    const named = stringValue(findEntry(entries, key)?.value);
    /*
     * An empty literal names nothing. A test harness builds its client with every field blank, and
     * reading that as an index produced a component with no name at all.
     */
    if (named !== undefined && named.length > 0) return named;
  }
  return undefined;
};

type Found = { components: number; edges: number; files: Set<string> };

const receiverKey = (enclosing: string | undefined, name: string): string =>
  `${enclosing ?? '<module>'}:${name}`;

const importForRoot = (module: ModuleFacts, root: string): ImportFact | undefined => {
  const matches = module.imports.filter((entry) => entry.local === root && !entry.isType);
  return matches.length === 1 ? matches[0] : undefined;
};

const rowFor = (entry: ImportFact, imported = entry.imported): AdapterApplicability[number] => ({
  module: entry.module,
  imported,
  location: entry.location,
});

const exactPerplexityCall = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
): ImportFact | undefined => {
  const matched = matchRuntimeSymbol(
    context.modules,
    module,
    { path: call.calleePath, origin: call.origin, enclosing: call.enclosing },
    { names: ['post'], packages: ['requests'] },
  );
  if (matched === undefined) return undefined;
  const url = call.args[0];
  if (url?.kind !== 'string' || url.value !== PERPLEXITY_URL) return undefined;
  const root = call.calleePath[0];
  return root === undefined ? undefined : importForRoot(module, root);
};

const searchApplicability = (context: DiscoveryContext): AdapterApplicability => {
  const local = localModules(context.modules);
  const importRows = context.modules.flatMap((module) =>
    module.imports.flatMap((entry) => {
      if (entry.isType || namesLocalModule(local, module, entry.module)) return [];
      const supported = SEARCH_CLIENTS.some(
        (service) =>
          moduleMatches(entry.module, service.packages) &&
          service.clients.includes(entry.imported as never),
      );
      return supported ? [rowFor(entry)] : [];
    }),
  );
  const callRows = context.modules.flatMap((module) =>
    module.calls.flatMap((call) => {
      const perplexity = exactPerplexityCall(context, module, call);
      const sdk = SEARCH_CLIENTS.find(
        (service) =>
          matchRuntimeSymbol(
            context.modules,
            module,
            { path: call.calleePath, origin: call.origin, enclosing: call.enclosing },
            { names: service.clients, packages: service.packages },
          ) !== undefined,
      );
      const root = sdk === undefined ? undefined : call.calleePath[0];
      const imported = root === undefined ? undefined : importForRoot(module, root);
      return [
        ...(perplexity === undefined ? [] : [rowFor(perplexity, 'post')]),
        ...(imported === undefined
          ? []
          : [
              rowFor(
                imported,
                imported.imported === '*' ? call.calleePath.at(-1) : imported.imported,
              ),
            ]),
      ];
    }),
  );
  const rows = [...importRows, ...callRows];
  return [
    ...new Map(
      rows.map((row) => [
        `${row.location.file}:${row.location.startLine}:${row.module}:${row.imported}`,
        row,
      ]),
    ).values(),
  ];
};

const stableVariableHolding = (module: ModuleFacts, call: CallFact): string | undefined => {
  const definition = definitionForCall(module, call);
  if (definition?.kind !== 'variable') return undefined;
  const sameName = module.definitions.filter(
    (candidate) =>
      candidate.kind === 'variable' &&
      candidate.name === definition.name &&
      candidate.enclosing === definition.enclosing,
  );
  if (sameName.length !== 1) return undefined;
  if (
    module.assignments.some(
      (assignment) =>
        assignment.target.length === 1 &&
        assignment.target[0] === definition.name &&
        assignment.enclosing === definition.enclosing,
    )
  ) {
    return undefined;
  }
  return definition.name;
};

const searchDefaultsAt = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
): readonly ResolvedSourceValue[] =>
  call.args.flatMap((argument) => {
    const argumentValues: readonly ArgumentFact[] =
      argument.kind === 'object' ? argument.entries.map((entry) => entry.value) : [argument];
    return argumentValues.flatMap((candidate) => {
      if (candidate.kind !== 'member' || candidate.path.at(-1) !== 'search_api') return [];
      const resolved = resolveSourceValue({
        context,
        module,
        value: candidate,
        before: call.location,
        enclosing: call.enclosing,
      });
      return resolved?.value.kind === 'string' && resolved.basis === 'configuration_default'
        ? [resolved]
        : [];
    });
  });

const searchDefault = (context: DiscoveryContext): ResolvedSourceValue | undefined => {
  const candidates: ResolvedSourceValue[] = [];
  for (const module of context.modules) {
    for (const call of module.calls) {
      for (const resolved of searchDefaultsAt(context, module, call)) {
        candidates.push(resolved);
        if (candidates.length > 32) return undefined;
      }
    }
  }
  const values = new Set(
    candidates.flatMap((candidate) =>
      candidate.value.kind === 'string' ? [candidate.value.value] : [],
    ),
  );
  if (values.size !== 1) return undefined;
  const selected = candidates[0];
  if (selected?.value.kind !== 'string') return undefined;
  const locations = [
    ...new Map(
      candidates
        .flatMap((candidate) => [...candidate.locations])
        .sort((left, right) =>
          `${left.file}:${left.startLine}:${left.startColumn ?? 0}`.localeCompare(
            `${right.file}:${right.startLine}:${right.startColumn ?? 0}`,
          ),
        )
        .map((location) => [
          `${location.file}:${location.startLine}:${location.startColumn ?? 0}`,
          location,
        ]),
    ).values(),
  ];
  return { value: selected.value, basis: 'configuration_default', locations };
};

/**
 * The variables holding a search client in this module, and the index each was built with.
 *
 * Resolved within the module that constructs the client, for the reason the model deadline is: an
 * application that builds its client once and passes it around gives a call site no syntactic route
 * back, and following a constructor parameter across files would answer a question the source has not
 * settled. An unresolved client contributes no retrieval or relation.
 */
const clientsIn = (
  module: ModuleFacts,
  service: Service,
  builder: SystemGraphBuilder,
  context: DiscoveryContext,
  found: Found,
  configuredDefault: ResolvedSourceValue | undefined,
): ReadonlyMap<string, ComponentIdentity> => {
  const held = new Map<string, ComponentIdentity>();
  for (const call of module.calls) {
    const matched = matchRuntimeSymbol(
      context.modules,
      module,
      { path: call.calleePath, origin: call.origin, enclosing: call.enclosing },
      { names: service.clients, packages: service.packages },
    );
    if (matched === undefined) continue;
    const identity = retrievalIdentity(indexNamedBy(call, service) ?? service.service);
    const isPossible = service.configurableName !== undefined;
    const isDefault =
      isPossible &&
      configuredDefault?.value.kind === 'string' &&
      configuredDefault.value.value === service.configurableName;
    const metadata = {
      client: dotted(call.calleePath),
      service: service.service,
      ...(isPossible
        ? { configurationSelection: 'possible', configurationDefault: isDefault }
        : {}),
    };
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'retrieval',
        identity,
        file: module.file,
        name: indexNamedBy(call, service) ?? service.service,
        location: call.location,
        symbol: dotted(call.calleePath),
        confidence: CONFIDENCE_BANDS.deterministic,
        sideEffect: 'read_only',
        permissions: [{ kind: 'network', scope: service.service, mode: 'read' }],
        metadata,
        tags: isPossible ? ['retrieval', 'configuration-possibility'] : ['retrieval'],
      }),
    );
    const root = call.calleePath[0];
    const imported = root === undefined ? undefined : importForRoot(module, root);
    if (imported !== undefined) {
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'retrieval',
          identity,
          file: imported.location.file,
          name: indexNamedBy(call, service) ?? service.service,
          location: imported.location,
          symbol: `${imported.module}.${imported.imported}`,
          confidence: CONFIDENCE_BANDS.deterministic,
          sideEffect: 'read_only',
          permissions: [{ kind: 'network', scope: service.service, mode: 'read' }],
          metadata,
          tags: isPossible ? ['retrieval', 'configuration-possibility'] : ['retrieval'],
        }),
      );
    }
    found.components += 1;
    found.files.add(module.file);
    const variable = stableVariableHolding(module, call);
    if (variable !== undefined) {
      const definition = definitionForCall(module, call);
      held.set(receiverKey(definition?.enclosing, variable), identity);
      context.bindings.register(module.file, variable, identity);
    }
    if (isDefault && configuredDefault !== undefined) {
      for (const evidenceLocation of configuredDefault.locations) {
        builder.addComponent(
          drafts.sourceComponent({
            kind: 'retrieval',
            identity,
            file: evidenceLocation.file,
            name: service.service,
            location: evidenceLocation,
            symbol: `${service.configurableName} configuration default`,
            confidence: CONFIDENCE_BANDS.deterministic,
            sideEffect: 'read_only',
            permissions: [{ kind: 'network', scope: service.service, mode: 'read' }],
            metadata,
            tags: ['retrieval', 'configuration-possibility'],
          }),
        );
        found.files.add(evidenceLocation.file);
      }
    }
  }
  return held;
};

/**
 * The component a query is attributed to, created when this is the first thing to need it.
 *
 * A component the enclosing name already produced wins, because a framework read a declaration and this
 * only read a call. Otherwise the function becomes an entry point carrying the tag that says discovery
 * invented the frame, which is what keeps it transparent to anything asking what a declared component
 * reaches through it.
 */
const callerOf = (
  module: ModuleFacts,
  name: string,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
  call: CallFact,
): ComponentIdentity => {
  const existing = context.bindings.lookup(module.file, name);
  if (existing !== undefined) return existing;
  const identity = sourceIdentity('entrypoint', module.file, name);
  builder.addComponent(
    drafts.sourceComponent({
      kind: 'entrypoint',
      file: module.file,
      name,
      location: call.location,
      symbol: name,
      confidence: CONFIDENCE_BANDS.structural,
      metadata: { inferredFrom: 'enclosing scope of a retrieval query' },
      tags: ['entrypoint', INFERRED_ENTRY_POINT_TAG],
    }),
  );
  found.components += 1;
  context.bindings.register(module.file, name, identity);
  return identity;
};

const discoverQueries = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
  configuredDefault: ResolvedSourceValue | undefined,
): void => {
  for (const service of SEARCH_CLIENTS) {
    const held = clientsIn(module, service, builder, context, found, configuredDefault);
    for (const call of module.calls) {
      if (!service.methods.includes(calleeName(call) as never)) continue;
      const receiver = dotted(call.calleePath.slice(0, -1));
      const scoped = held.get(receiverKey(call.enclosing, receiver));
      const target =
        scoped ??
        (hasLocalBinding(module, call.enclosing, receiver)
          ? undefined
          : held.get(receiverKey(undefined, receiver)));
      if (target === undefined) continue;
      const identity = target;
      found.files.add(module.file);
      context.callSiteEffects.record(module.file, call, identity, 'read_only');
      const caller = call.enclosing;
      if (caller === undefined) continue;
      builder.addEdge(
        drafts.edge({
          kind: 'queries_retrieval',
          from: callerOf(module, caller, context, builder, found, call),
          to: identity,
          location: call.location,
          symbol: dotted(call.calleePath),
          confidence: CONFIDENCE_BANDS.structural,
        }),
      );
      found.edges += 1;
    }
  }
};

const discoverPerplexity = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
): void => {
  for (const call of module.calls) {
    const imported = exactPerplexityCall(context, module, call);
    if (imported === undefined) continue;
    const identity = retrievalIdentity('perplexity');
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'retrieval',
        identity,
        file: module.file,
        name: 'perplexity',
        location: call.location,
        symbol: dotted(call.calleePath),
        confidence: CONFIDENCE_BANDS.deterministic,
        sideEffect: 'read_only',
        permissions: [{ kind: 'network', scope: PERPLEXITY_URL, mode: 'read' }],
        metadata: {
          client: dotted(call.calleePath),
          service: 'perplexity',
          endpoint: PERPLEXITY_URL,
          configurationSelection: 'possible',
          configurationDefault: false,
        },
        tags: ['retrieval', 'configuration-possibility'],
      }),
    );
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'retrieval',
        identity,
        file: imported.location.file,
        name: 'perplexity',
        location: imported.location,
        symbol: `${imported.module}.${imported.imported}`,
        confidence: CONFIDENCE_BANDS.deterministic,
        sideEffect: 'read_only',
        permissions: [{ kind: 'network', scope: PERPLEXITY_URL, mode: 'read' }],
        metadata: {
          client: dotted(call.calleePath),
          service: 'perplexity',
          endpoint: PERPLEXITY_URL,
          configurationSelection: 'possible',
          configurationDefault: false,
        },
        tags: ['retrieval', 'configuration-possibility'],
      }),
    );
    found.components += 1;
    found.files.add(module.file);
    context.callSiteEffects.record(module.file, call, identity, 'read_only');
    const caller = call.enclosing;
    if (caller === undefined) continue;
    builder.addEdge(
      drafts.edge({
        kind: 'queries_retrieval',
        from: callerOf(module, caller, context, builder, found, call),
        to: identity,
        location: call.location,
        symbol: dotted(call.calleePath),
        confidence: CONFIDENCE_BANDS.deterministic,
      }),
    );
    found.edges += 1;
  }
};

export const searchIndexAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '2',
  packages: ALL_PACKAGES,
  applicability: searchApplicability,
  appliesTo: (context) => searchApplicability(context).length > 0,
  discover: (context, builder): AdapterFindings => {
    const found: Found = { components: 0, edges: 0, files: new Set() };
    const configuredDefault = searchDefault(context);
    /*
     * A test harness reaches a real client at a fake, and an index discovered only there describes the
     * harness rather than the system under audit. `conftest.py` in one field report's target builds a
     * `SearchClient` with every field blank, which is a fixture and not a retrieval source.
     */
    for (const module of context.modules) {
      if (isTestFile(module.file)) continue;
      discoverQueries(module, context, builder, found, configuredDefault);
      discoverPerplexity(module, context, builder, found);
    }
    return {
      componentsFound: found.components,
      edgesFound: found.edges,
      filesInspected: [...found.files],
    };
  },
};
