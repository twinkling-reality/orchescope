import { CONFIDENCE_BANDS, INFERRED_ENTRY_POINT_TAG } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity } from '@orchescope/schema';
import type { CallFact, ModuleFacts } from '@orchescope/source-analysis';
import {
  calleeName,
  dotted,
  findEntry,
  isTestFile,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { importsAny, projectUses } from '../matching.ts';

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
  },
] as const;

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

/**
 * The variables holding a search client in this module, and the index each was built with.
 *
 * Resolved within the module that constructs the client, for the reason the model deadline is: an
 * application that builds its client once and passes it around gives a call site no syntactic route
 * back, and following a constructor parameter across files would answer a question the source has not
 * settled. A query through an unresolved client still produces a relation, against the service rather
 * than against a named index.
 */
const clientsIn = (
  module: ModuleFacts,
  service: Service,
  builder: SystemGraphBuilder,
  context: DiscoveryContext,
  found: Found,
): ReadonlyMap<string, ComponentIdentity> => {
  const held = new Map<string, ComponentIdentity>();
  for (const call of module.calls) {
    if (!service.clients.includes(calleeName(call) as never)) continue;
    const identity = retrievalIdentity(indexNamedBy(call, service) ?? service.service);
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
        metadata: { client: dotted(call.calleePath), service: service.service },
        tags: ['retrieval'],
      }),
    );
    found.components += 1;
    found.files.add(module.file);
    const variable = module.definitions.find(
      (definition) =>
        definition.kind === 'variable' &&
        definition.initializer !== undefined &&
        dotted(definition.initializer) === dotted(call.calleePath),
    )?.name;
    if (variable !== undefined) {
      held.set(variable, identity);
      context.bindings.register(module.file, variable, identity);
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
): void => {
  for (const service of SEARCH_CLIENTS) {
    if (!importsAny(module, service.packages)) continue;
    const held = clientsIn(module, service, builder, context, found);
    for (const call of module.calls) {
      if (!service.methods.includes(calleeName(call) as never)) continue;
      const receiver = dotted(call.calleePath.slice(0, -1));
      const target = held.get(receiver);
      /*
       * A query through a client this module did not build reaches the service under its own name. The
       * alternative is to drop the relation, which would report a retrieval application as one that
       * retrieves nothing in exactly the repositories that inject their clients.
       */
      const identity = target ?? retrievalIdentity(service.service);
      if (target === undefined) {
        builder.addComponent(
          drafts.sourceComponent({
            kind: 'retrieval',
            identity,
            file: module.file,
            name: service.service,
            location: call.location,
            symbol: dotted(call.calleePath),
            confidence: CONFIDENCE_BANDS.structural,
            sideEffect: 'read_only',
            permissions: [{ kind: 'network', scope: service.service, mode: 'read' }],
            metadata: { client: dotted(call.calleePath), service: service.service },
            tags: ['retrieval'],
          }),
        );
        found.components += 1;
      }
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

export const searchIndexAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  packages: ALL_PACKAGES,
  appliesTo: (context) => projectUses(context, ALL_PACKAGES),
  discover: (context, builder): AdapterFindings => {
    const found: Found = { components: 0, edges: 0, files: new Set() };
    /*
     * A test harness reaches a real client at a fake, and an index discovered only there describes the
     * harness rather than the system under audit. `conftest.py` in one field report's target builds a
     * `SearchClient` with every field blank, which is a fixture and not a retrieval source.
     */
    for (const module of context.modules) {
      if (isTestFile(module.file)) continue;
      discoverQueries(module, context, builder, found);
    }
    return {
      componentsFound: found.components,
      edgesFound: found.edges,
      filesInspected: [...found.files],
    };
  },
};
