import { CONFIDENCE_BANDS, INFERRED_ENTRY_POINT_TAG, moduleNamespace } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type {
  ComponentIdentity,
  EdgePolicy,
  SideEffectClass,
  SourceLocation,
} from '@orchescope/schema';
import type { CallSiteEffects } from '../call-site-effect.ts';
import type {
  CallFact,
  ControlFlowFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import {
  calleeName,
  dotted,
  findEntry,
  isTestFile,
  numberValue,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import {
  type ModelEndpoint,
  modelEndpointForHost,
  modelFromPath,
  modelOperationForPath,
} from '@orchescope/traces/model-endpoints';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { callRelationKind } from '../call-relation.ts';
import { createCallSiteEffects } from '../call-site-effect.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';

/**
 * External effects: network calls, datastores, queues, retries and the operations that change something
 * outside the process.
 *
 * This adapter is deliberately conservative. It classifies an operation as a non idempotent write only
 * when the call itself says so, for example an HTTP POST or a `charge` style verb, and otherwise records
 * `unknown`. Guessing that an operation is safe to retry is the one mistake that would make an
 * Orchescope recommendation dangerous, so unknown is a first class answer here.
 */

const ADAPTER_ID = 'adapter:effects';
const drafts = createDrafts(ADAPTER_ID);

const HTTP_CLIENTS = [
  { path: 'fetch', packages: [] as string[] },
  { path: 'axios', packages: ['axios'] },
  { path: 'got', packages: ['got'] },
  { path: 'requests', packages: ['requests'] },
  { path: 'httpx', packages: ['httpx'] },
  { path: 'urllib.request.urlopen', packages: ['urllib'] },
];

const HTTP_METHOD_NAMES = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'request',
  'fetch',
  'send',
  'stream',
]);

/**
 * Datastore clients, by the name that constructs one.
 *
 * `connect` carries `receivers`, and it is the only entry here that has to. Every other name in this
 * table is a constructor nobody writes by accident; `connect` is a word any protocol library uses for
 * the thing every protocol library does, and matching it bare made `server.connect(new
 * StdioServerTransport())` report a SQLite database in a repository that has none. A receiver is
 * required rather than a package, because the call this entry exists for is Python's
 * `sqlite3.connect(path)` and Python names the module at the call site.
 */
const DATASTORE_CLIENTS: readonly {
  readonly names: readonly string[];
  readonly receivers?: readonly string[];
  readonly store: string;
}[] = [
  { names: ['PrismaClient'], store: 'prisma' },
  { names: ['Pool', 'Client'], store: 'postgres' },
  { names: ['createClient'], store: 'redis' },
  { names: ['MongoClient'], store: 'mongodb' },
  { names: ['create_engine', 'sessionmaker'], store: 'sqlalchemy' },
  { names: ['connect'], receivers: ['sqlite3'], store: 'sqlite' },
  { names: ['DatabaseSync'], store: 'sqlite' },
];

/** Whether the call reaches a client through the receiver the entry requires, when it requires one. */
const datastoreCallMatches = (
  candidate: (typeof DATASTORE_CLIENTS)[number],
  call: CallFact,
): boolean => {
  if (!candidate.names.includes(calleeName(call))) return false;
  if (candidate.receivers === undefined) return true;
  const receiver = call.calleePath[call.calleePath.length - 2];
  return (
    (receiver !== undefined && candidate.receivers.includes(receiver)) ||
    (call.origin !== undefined && candidate.receivers.includes(call.origin.module))
  );
};

const QUEUE_CLIENTS: readonly { readonly names: readonly string[]; readonly queue: string }[] = [
  { names: ['Queue', 'Worker', 'FlowProducer'], queue: 'bullmq' },
  { names: ['Celery'], queue: 'celery' },
  { names: ['SQSClient', 'SendMessageCommand'], queue: 'sqs' },
];

const RETRY_HELPERS = new Set([
  'pRetry',
  'retry',
  'withRetry',
  'backoff',
  'tenacity',
  'Retrying',
  'retry_with_backoff',
]);

const WRITE_VERBS = [
  'charge',
  'refund',
  'pay',
  'transfer',
  'create',
  'delete',
  'remove',
  'update',
  'send',
  'notify',
  'email',
  'post',
  'publish',
  'issue',
  'cancel',
  'provision',
];

const READ_VERBS = ['get', 'list', 'read', 'fetch', 'lookup', 'search', 'query', 'find', 'check'];

/**
 * Classifies an operation from its own name and its HTTP method, never from optimism.
 *
 * The leading underscore comes off first. It is Python's word for private and it is not part of the verb,
 * and leaving it on hid the verb from the only thing that reads it: `_get_crew_status`, a polled HTTP GET,
 * was classified `unknown` and then reported as an operation that might not be safe to repeat.
 */
export const classifyEffect = (name: string, httpMethod?: string): SideEffectClass => {
  const lowered = name.toLowerCase().replace(/^_+/, '');
  if (httpMethod !== undefined) {
    const method = httpMethod.toLowerCase();
    if (method === 'get' || method === 'head' || method === 'options') return 'read_only';
    if (method === 'put') return 'idempotent_write';
    if (method === 'delete') return 'destructive';
    if (method === 'post' || method === 'patch') {
      return WRITE_VERBS.some((verb) => lowered.includes(verb))
        ? 'non_idempotent_write'
        : 'unknown';
    }
  }
  if (lowered.includes('refund') || lowered.includes('charge') || lowered.includes('pay')) {
    return 'financial';
  }
  if (lowered.includes('delete') || lowered.includes('drop') || lowered.includes('purge')) {
    return 'destructive';
  }
  if (lowered.includes('notify') || lowered.includes('email') || lowered.includes('sms')) {
    return 'external_notification';
  }
  if (WRITE_VERBS.some((verb) => lowered.startsWith(verb))) return 'non_idempotent_write';
  if (READ_VERBS.some((verb) => lowered.startsWith(verb))) return 'read_only';
  return 'unknown';
};

const hostOf = (url: string): string | undefined => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(url);
  return match?.[2];
};

type Found = { components: number; edges: number; files: Set<string> };

/**
 * Module namespace to the sentence saying how the operations defined there deduplicate their own effect.
 *
 * Keyed by namespace rather than by file path, because that is what a component identity carries and the
 * point of this map is to be asked about a call's target.
 */
type SinkEvidence = {
  readonly deduplicates: string | undefined;
  readonly ceiling: string | undefined;
};
type Sinks = ReadonlyMap<string, SinkEvidence>;

const serviceIdentity = (host: string): ComponentIdentity =>
  globalIdentity('external_service', GLOBAL_NAMESPACES.service, host);

/**
 * The service a request reaches, named for its host when the source says one and for its call site when
 * it does not.
 *
 * `external_service:unresolved-host` was a single component standing for every request in a repository
 * whose address is built at run time: eleven call sites across nine files in one project, in three
 * different packages, merged into one node. That node then carried one effect class, which could be
 * right for at most one of them, and it was the subject of a medium severity finding in three of twenty
 * three projects. A reader was being asked to act on a component nobody can name.
 *
 * Two separate defects, and both come from the same merge. Scoping the identity to the function making
 * the call keeps unrelated services apart, because that is what they are, and lets each one carry the
 * effect class of the call it actually describes. The display name says where to look, since the one
 * thing a reader can be told about a host nobody wrote down is who builds it.
 *
 * A host that is written down is still one component wherever it is called from. Two modules naming
 * `api.stripe.com` are naming one service.
 */
const serviceCalledAt = (
  module: ModuleFacts,
  call: CallFact,
  host: string | undefined,
): {
  readonly identity: ComponentIdentity;
  readonly name: string;
  readonly displayName: string;
} => {
  if (host !== undefined) {
    return { identity: serviceIdentity(host), name: host, displayName: host };
  }
  const scope = call.enclosing;
  const name = `unresolved-host:${scope ?? 'module-scope'}`;
  return {
    identity: sourceIdentity('external_service', module.file, name),
    name,
    displayName:
      scope === undefined
        ? `a host ${module.file} builds at run time`
        : `the host ${scope} builds at run time`,
  };
};

/**
 * The component an effect is attributed to, created if this is the first time it was needed.
 *
 * When the enclosing scope already produced a component, for example an agent a framework adapter found, the
 * effect attaches to it. Otherwise the enclosing function becomes an entry point, because an effect with no
 * caller cannot be reasoned about and inventing an agent would overstate the architecture.
 *
 * An identity that is returned without the component being added is an edge to nothing, which the graph refuses
 * to build. Every path that needs a caller goes through here so that the component and the identity are produced
 * together rather than one of them being assumed.
 */
const ensureScope = (input: {
  readonly module: ModuleFacts;
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly found: Found;
  readonly name: string;
  readonly location: SourceLocation;
  readonly inferredFrom: string;
}): ComponentIdentity => {
  const { module, context, builder, found, name } = input;
  const existing = context.bindings.lookup(module.file, name);
  if (existing !== undefined) return existing;
  const identity = sourceIdentity('entrypoint', module.file, name);
  builder.addComponent(
    drafts.sourceComponent({
      kind: 'entrypoint',
      file: module.file,
      name,
      location: input.location,
      symbol: name,
      confidence: CONFIDENCE_BANDS.structural,
      metadata: { inferredFrom: input.inferredFrom },
      tags: ['entrypoint', INFERRED_ENTRY_POINT_TAG],
    }),
  );
  found.components += 1;
  context.bindings.register(module.file, name, identity);
  return identity;
};

const ensureCaller = (
  module: ModuleFacts,
  call: CallFact,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
): ComponentIdentity =>
  ensureScope({
    module,
    context,
    builder,
    found,
    name: call.enclosing ?? 'module-scope',
    location: call.location,
    inferredFrom: 'enclosing scope of an external effect',
  });

/**
 * Entries that hold the document a request sends, in the three ways the ecosystems write it.
 *
 * A JavaScript `fetch` puts it under `body`, usually wrapped in `JSON.stringify`. A Python client puts it
 * under `json` or `data` as a dictionary. All three end at the same object, and that object is where a
 * provider is told which model to use.
 */
const MODEL_SEARCH_DEPTH = 4;

/**
 * Nested objects are followed and arrays are not.
 *
 * A request document nests: a JavaScript `fetch` wraps it in `JSON.stringify`, a Python client passes it
 * as a dictionary, and a provider may take it under a session or an input key, which is how one real call
 * site writes `JSON.stringify({ session: { model } })`. Following those is reading. Following an array is
 * guessing, because the arrays in these documents hold messages and tool definitions, and a `model` field
 * inside one of those describes an element rather than the request.
 */
const modelInEntries = (entries: readonly ObjectEntryFact[], depth: number): string | undefined => {
  const direct = stringValue(findEntry(entries, 'model')?.value);
  if (direct !== undefined) return direct;
  if (depth === 0) return undefined;
  for (const entry of entries) {
    if (entry.value.kind === 'object') {
      const nested = modelInEntries(entry.value.entries, depth - 1);
      if (nested !== undefined) return nested;
    }
    if (entry.value.kind === 'call') {
      for (const argument of entry.value.args) {
        if (argument.kind !== 'object') continue;
        const nested = modelInEntries(argument.entries, depth - 1);
        if (nested !== undefined) return nested;
      }
    }
  }
  return undefined;
};

/**
 * The model this call site names, or nothing.
 *
 * Searched only once the host has already said this request goes to a model provider, which is what makes
 * a bare `model` key readable as the model rather than as some field that happens to share the word. A
 * model nobody wrote down stays unnamed: inventing one would be worse than the gap it fills.
 */
const modelNamedAt = (call: CallFact): string | undefined => {
  for (const argument of call.args) {
    if (argument.kind !== 'object') continue;
    const found = modelInEntries(argument.entries, MODEL_SEARCH_DEPTH);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * A model call written as a plain HTTP request.
 *
 * One project in a thirty six repository sweep ran thirteen MCP servers and reached OpenAI by posting to
 * `api.openai.com` with no `openai` entry in its manifest, so the adapter that reads imports found
 * nothing and the audit described a fifty seven component agent system containing no model. The host is
 * the only thing in such a request that says what it is, and it is enough.
 *
 * The identities are the ones the SDK adapter produces, deliberately: a repository that imports a package
 * in one module and posts to the same provider in another has one model, and giving the two paths
 * different names would report it as two. The provider name comes from the shared endpoint table for the
 * same reason, since the runtime side has to arrive at the same component from the same host.
 *
 * No external service component is added beside this one. The call is a model call, and recording it as
 * both would count one request twice and leave a reader to work out that the two are the same thing.
 */
const discoverModelEndpoint = (input: {
  readonly module: ModuleFacts;
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly found: Found;
  readonly call: CallFact;
  readonly endpoint: ModelEndpoint;
  readonly url: string;
  readonly client: string;
}): void => {
  const { module, context, builder, found, call, endpoint, url } = input;
  const path = url.slice(url.indexOf('/', url.indexOf('://') + 3));
  const model = modelNamedAt(call) ?? modelFromPath(path) ?? 'unspecified';
  const providerIdentity = globalIdentity(
    'provider',
    GLOBAL_NAMESPACES.provider,
    endpoint.provider,
  );
  const modelIdentity = globalIdentity(
    'model',
    GLOBAL_NAMESPACES.model,
    `${endpoint.provider}/${model}`,
  );

  builder.addComponent(
    drafts.sourceComponent({
      kind: 'provider',
      identity: providerIdentity,
      file: module.file,
      name: endpoint.provider,
      location: call.location,
      symbol: input.client,
      confidence: CONFIDENCE_BANDS.strongStructural,
      permissions: [{ kind: 'network', scope: url, mode: 'write' }],
      metadata: { client: input.client, reachedOver: 'http', endpoint: url },
      tags: ['model-endpoint'],
    }),
  );
  builder.addComponent(
    drafts.sourceComponent({
      kind: 'model',
      identity: modelIdentity,
      file: module.file,
      name: `${endpoint.provider}/${model}`,
      location: call.location,
      symbol: input.client,
      /*
       * The host is deterministic and the model is not: it is read when the call site writes it down and
       * is `unspecified` when the request builds it somewhere this cannot follow.
       */
      confidence:
        model === 'unspecified' ? CONFIDENCE_BANDS.structural : CONFIDENCE_BANDS.strongStructural,
      details: {
        for: 'model',
        provider: endpoint.provider,
        modelId: model,
        streaming: false,
      },
      metadata: { callSite: input.client, operation: modelOperationForPath(path) },
      tags: ['model-endpoint'],
    }),
  );
  found.components += 2;
  found.files.add(module.file);

  builder.addEdge(
    drafts.edge({
      kind: 'served_by_provider',
      from: modelIdentity,
      to: providerIdentity,
      location: call.location,
      symbol: input.client,
    }),
  );
  builder.addEdge(
    drafts.edge({
      kind: 'invokes_model',
      from: ensureCaller(module, call, context, builder, found),
      to: modelIdentity,
      location: call.location,
      symbol: input.client,
      confidence: CONFIDENCE_BANDS.structural,
    }),
  );
  found.edges += 2;
};

const httpMethodOf = (call: CallFact): string | undefined => {
  const last = calleeName(call);
  if (HTTP_METHOD_NAMES.has(last) && last !== 'fetch' && last !== 'request') return last;
  const entries = objectArgument(call, 1);
  return stringValue(findEntry(entries, 'method')?.value);
};

const discoverHttp = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
  performed: CallSiteEffects,
): void => {
  for (const call of module.calls) {
    const path = dotted(call.calleePath);
    const root = call.calleePath[0] ?? '';
    /*
     * A client reached through a member, `axios.get` or `requests.post`, is a request. Any other member of the same
     * root is not, and matching on the root alone read two things as requests that never leave the process.
     *
     * A promise chain repeats the root at every link, so one `fetch(url).then().then().catch()` was counted four
     * times: as `fetch`, `fetch.then`, `fetch.then.then` and `fetch.then.then.catch`, each with its own component
     * and edge at the same source location. A test double is configured through the same shape, so
     * `fetch.mockResolvedValue(...)` was recorded as a call to an unresolved host, which made the heaviest edge in
     * a scan of one repository twelve lines of mock setup in a single test file.
     *
     * The operation names this build already recognises are the vocabulary that separates the two.
     */
    const client = HTTP_CLIENTS.find(
      (candidate) =>
        path === candidate.path ||
        (root === candidate.path.split('.')[0] && HTTP_METHOD_NAMES.has(calleeName(call))),
    );
    if (client === undefined) continue;
    const first = call.args[0];
    const url = first !== undefined && first.kind === 'string' ? first.value : undefined;
    const host = url === undefined ? undefined : hostOf(url);
    const endpoint = host === undefined ? undefined : modelEndpointForHost(host);
    if (endpoint !== undefined && url !== undefined) {
      discoverModelEndpoint({ module, context, builder, found, call, endpoint, url, client: path });
      continue;
    }
    const method = httpMethodOf(call);
    const effect = classifyEffect(call.enclosing ?? path, method);
    const service = serviceCalledAt(module, call, host);

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'external_service',
        identity: service.identity,
        file: module.file,
        name: service.name,
        displayName: service.displayName,
        location: call.location,
        symbol: path,
        confidence:
          host === undefined ? CONFIDENCE_BANDS.heuristic : CONFIDENCE_BANDS.strongStructural,
        details: {
          for: 'external_service',
          ...(host === undefined ? {} : { host }),
          protocol: 'http',
          authKind: 'unknown',
        },
        sideEffect: effect,
        permissions: [
          {
            kind: 'network',
            scope: host ?? service.name,
            mode: effect === 'read_only' ? 'read' : 'write',
          },
        ],
        metadata: {
          client: path,
          ...(method === undefined ? {} : { httpMethod: method }),
          ...(url === undefined ? { urlIsDynamic: true } : { url }),
        },
        tags: ['http'],
      }),
    );
    found.components += 1;
    found.files.add(module.file);
    performed.record(module.file, call, service.identity);

    builder.addEdge(
      drafts.edge({
        kind: 'calls_service',
        from: ensureCaller(module, call, context, builder, found),
        to: service.identity,
        location: call.location,
        symbol: path,
        confidence: CONFIDENCE_BANDS.structural,
        metadata: {
          ...(method === undefined ? {} : { httpMethod: method }),
          sideEffect: effect,
        },
      }),
    );
    found.edges += 1;
  }
};

const discoverStores = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
): void => {
  for (const call of module.calls) {
    const name = calleeName(call);
    const store = DATASTORE_CLIENTS.find((candidate) => datastoreCallMatches(candidate, call));
    if (store !== undefined) {
      const identity = globalIdentity('database', GLOBAL_NAMESPACES.datastore, store.store);
      builder.addComponent(
        drafts.sourceComponent({
          kind: 'database',
          identity,
          file: module.file,
          name: store.store,
          location: call.location,
          symbol: dotted(call.calleePath),
          confidence: CONFIDENCE_BANDS.structural,
          sideEffect: 'unknown',
          permissions: [{ kind: 'database', scope: store.store, mode: 'write' }],
          metadata: { client: dotted(call.calleePath) },
          tags: ['datastore'],
        }),
      );
      found.components += 1;
      found.files.add(module.file);
      builder.addEdge(
        drafts.edge({
          kind: 'queries_database',
          from: ensureCaller(module, call, context, builder, found),
          to: identity,
          location: call.location,
          symbol: dotted(call.calleePath),
          confidence: CONFIDENCE_BANDS.heuristic,
        }),
      );
      found.edges += 1;
      continue;
    }
    const queue = QUEUE_CLIENTS.find((candidate) => candidate.names.includes(name));
    if (queue === undefined) continue;
    const first = call.args[0];
    const queueName = first !== undefined && first.kind === 'string' ? first.value : queue.queue;
    const identity = globalIdentity('queue', GLOBAL_NAMESPACES.queue, queueName);
    const entries = objectArgument(call, 1);
    const concurrency = numberValue(findEntry(entries, 'concurrency')?.value);
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'queue',
        identity,
        file: module.file,
        name: queueName,
        location: call.location,
        symbol: dotted(call.calleePath),
        confidence: CONFIDENCE_BANDS.structural,
        details: {
          for: 'queue',
          bounded: concurrency !== undefined,
          ...(concurrency === undefined ? {} : { workerCount: concurrency }),
        },
        permissions: [{ kind: 'queue', scope: queueName, mode: 'write' }],
        metadata: { client: dotted(call.calleePath), library: queue.queue },
        tags: ['queue'],
      }),
    );
    found.components += 1;
    found.files.add(module.file);
    builder.addEdge(
      drafts.edge({
        kind: name === 'Worker' ? 'consumes_from_queue' : 'publishes_to_queue',
        from: ensureCaller(module, call, context, builder, found),
        to: identity,
        location: call.location,
        symbol: dotted(call.calleePath),
        confidence: CONFIDENCE_BANDS.structural,
        ...(concurrency === undefined ? {} : { policy: { concurrency } }),
      }),
    );
    found.edges += 1;
  }
};

/**
 * Whether the module that defines an operation shows it deduplicating its own effect.
 *
 * "No idempotency key was found on the operation" was true of every retry Orchescope reported, because
 * nothing ever looked: the field existed and no adapter populated it. One reported finding named a call
 * whose sink derives a content addressed delivery identifier and enforces it with `ON CONFLICT DO
 * NOTHING`, which is verbatim the remediation the finding then prescribed. Looking one frame in is the
 * difference between a rule that read the code and a rule that assumed the worst about it.
 *
 * The evidence is deliberately coarse. It cannot prove the key covers the retried operation, so it is not
 * used to declare the retry safe; it is used to stop the rules asserting an absence they never checked.
 */
const DEDUPLICATING_SQL = /\bon\s+conflict\b|\bon\s+duplicate\s+key\b|\bmerge\s+into\b/i;
const DEDUPLICATING_NAME = /idempot|dedup|deterministic/i;
const IDEMPOTENCY_KEY_NAME = /^idempotency[-_]?(key|token)$/i;
const ATTEMPT_CEILING_NAME = /max_?(attempts|retries|tries)/i;

const entryDeclaresKey = (entries: readonly ObjectEntryFact[], depth: number): boolean =>
  entries.some((entry) => {
    if (IDEMPOTENCY_KEY_NAME.test(entry.key)) return true;
    if (depth === 0 || entry.value.kind !== 'object') return false;
    return entryDeclaresKey(entry.value.entries, depth - 1);
  });

const idempotencyEvidenceIn = (module: ModuleFacts): string | undefined => {
  if (module.texts.some((text) => DEDUPLICATING_SQL.test(text.value))) {
    return 'its statement deduplicates on conflict';
  }
  const named = module.calls.find((call) => DEDUPLICATING_NAME.test(calleeName(call)));
  if (named !== undefined) return `it derives a key with ${calleeName(named)}`;
  const keyed = module.calls.some((call) =>
    call.args.some(
      (argument) => argument.kind === 'object' && entryDeclaresKey(argument.entries, 1),
    ),
  );
  return keyed ? 'it sends an idempotency key' : undefined;
};

/**
 * Whether the module that defines an operation declares how many attempts it allows.
 *
 * The same omission as the key, in the other rule: `no attempt limit could be established from the source`
 * was reported about a codebase that declares `const DELIVERY_MAX_ATTEMPTS = 6` and enforces it with a
 * terminal status. A constant is not proof that the retry honours it, so this stops the assertion rather
 * than making the opposite one.
 */
const ceilingEvidenceIn = (module: ModuleFacts): string | undefined => {
  const declared = module.definitions.find((definition) =>
    ATTEMPT_CEILING_NAME.test(definition.name),
  );
  return declared === undefined ? undefined : `it declares ${declared.name}`;
};

/**
 * What the sink showed, carried on the relation so a rule can decline to assert what nobody established.
 *
 * The evidence is recorded rather than resolved into `idempotency: 'declared'`, because `declared` means a
 * key was found on the operation and a name that reads like a key derivation is not that. What it supports
 * is a refusal: the rules stop claiming an absence they never checked, and say how many they left alone.
 */
const sinkMetadata = (sink: SinkEvidence | undefined): Record<string, string> => ({
  ...(sink?.deduplicates === undefined ? {} : { deduplicatesAtSink: sink.deduplicates }),
  ...(sink?.ceiling === undefined ? {} : { attemptCeiling: sink.ceiling }),
});

/**
 * A ceiling the loop itself states, which is a stronger answer than one found in the sink.
 *
 * A `while` bounds nothing by its form, but a condition that names a maximum is the author writing the
 * limit down. Reported so that the rule declines to assert an absence rather than declaring the retry safe.
 */
const headerCeiling = (loop: ControlFlowFact): string | undefined => {
  const named = (loop.headerNames ?? []).find((name) => ATTEMPT_CEILING_NAME.test(name));
  return named === undefined ? undefined : `its condition names ${named}`;
};

/** The operation a retry helper wraps, when it can be named. */
const wrappedOperationName = (call: CallFact): string | undefined => {
  const wrapped = call.args[0];
  if (wrapped === undefined) return undefined;
  if (wrapped.kind === 'identifier') return wrapped.name;
  if (wrapped.kind === 'call') return wrapped.path[wrapped.path.length - 1];
  return undefined;
};

/**
 * An explicit retry helper. The attempt count is read from the options where it is stated, and a helper with no stated
 * count is recorded as unbounded rather than guessed at, because an unbounded retry around a side effect is one of the
 * findings this exists to support.
 */
const discoverRetryHelpers = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
  sinks: Sinks,
): void => {
  for (const call of module.calls) {
    if (!RETRY_HELPERS.has(calleeName(call))) continue;
    const wrappedName = wrappedOperationName(call);
    if (wrappedName === undefined) continue;
    const target = context.bindings.lookup(module.file, wrappedName);
    if (target === undefined) continue;

    const entries = objectArgument(call, 1);
    const attempts =
      numberValue(findEntry(entries, 'retries')?.value) ??
      numberValue(findEntry(entries, 'attempts')?.value) ??
      numberValue(findEntry(entries, 'stop_after_attempt')?.value);
    const sink = sinks.get(target.namespace);
    const policy: EdgePolicy = {
      retry: {
        ...(attempts === undefined ? {} : { maxAttempts: attempts }),
        bounded: attempts !== undefined,
        backoff: findEntry(entries, 'backoff') === undefined ? 'unknown' : 'exponential',
        idempotency: 'unknown',
      },
    };
    builder.addEdge(
      drafts.edge({
        kind: callRelationKind(target.kind),
        from: ensureCaller(module, call, context, builder, found),
        to: target,
        location: call.location,
        symbol: `${calleeName(call)}(${wrappedName})`,
        policy,
        confidence: CONFIDENCE_BANDS.structural,
        metadata: { retryHelper: calleeName(call), ...sinkMetadata(sink) },
      }),
    );
    found.edges += 1;
    found.files.add(module.file);
  }
};

/**
 * The loop a `try` sits inside, in the same function.
 *
 * Containment is by line range and by scope. Line range alone matched a `try` in one function against a
 * loop in another whose range happened to span it, which is how a one shot `fetch` helper whose only
 * `try` wrapped a `JSON.parse` fallback came to be reported as a retried operation.
 */
const enclosingLoopOf = (
  module: ModuleFacts,
  construct: ControlFlowFact,
): ControlFlowFact | undefined =>
  module.controlFlow.find(
    (candidate) =>
      candidate.kind === 'loop' &&
      candidate.enclosing === construct.enclosing &&
      candidate.location.startLine <= construct.location.startLine &&
      (candidate.location.endLine ?? candidate.location.startLine) >=
        (construct.location.endLine ?? construct.location.startLine),
  );

/**
 * Calls that pause before the next pass. A retry waits; a work loop has no reason to.
 *
 * Matched on the last segment of the callee path, so `timers.setTimeout` and a locally defined `sleep`
 * both count. Waiting is one of the two things a loop can do that only a re-attempt needs.
 */
const DELAY_CALLS = new Set([
  'sleep',
  'delay',
  'wait',
  'waitFor',
  'pause',
  'backoff',
  'setTimeout',
  'setInterval',
]);

/**
 * Names a loop header gives a counter when the loop is counting attempts.
 *
 * The author's own word for what the loop is doing, and the only place in the syntax where a loop says it
 * is re-attempting rather than iterating. Matched as a fragment because `attempt`, `attempts`, `maxAttempts`
 * and `attemptNumber` are the same word.
 */
const ATTEMPT_NAME = /attempt|retr|tries/i;

/**
 * Whether anything in this loop says it re-attempts, rather than merely being a loop with a `try` in it.
 *
 * This is the whole of the change the field report asked for. A loop with a `try` and an `await` in it was
 * classified as a retry on the strength of that shape alone, and across thirty six repositories the two
 * rules built on it produced no true positive: the matches were per item iteration with per item error
 * isolation, and minified bundles where every shape is present somewhere. So a re-attempt now has to be
 * stated by the code rather than inferred from its silhouette.
 *
 * The known cost is a retry loop that neither waits nor names its counter, which this will not see. That
 * is a loop that hammers its dependency as fast as it can fail, and it is rarer than the loops this used
 * to misread. An explicit retry helper is recognised separately and is unaffected.
 */
const reattemptEvidence = (
  loop: ControlFlowFact,
  attempted: ControlFlowFact,
): string | undefined => {
  if (loop.repeats !== 'same_work') return undefined;
  /*
   * Both constructs, because a wait before the next pass is written in the catch as often as in the loop
   * body, and a call belongs to the innermost construct that holds it.
   */
  const delay = [...loop.contains, ...attempted.contains]
    .map((path) => path[path.length - 1])
    .find((name) => name !== undefined && DELAY_CALLS.has(name));
  if (delay !== undefined) return `it waits with ${delay} before the next pass`;
  const counter = (loop.headerNames ?? []).find((name) => ATTEMPT_NAME.test(name));
  return counter === undefined ? undefined : `its header counts ${counter}`;
};

/**
 * The operation a retried call reaches, and where to ask what that operation's own module showed.
 *
 * Two spellings of the same retry. `retry { namedPost(...) }` names something, and the name resolves to
 * the component that call produced. `retry { fetch(...) }` names nothing, and the request has still
 * been discovered and classified at that exact line, so the call site answers where the name cannot.
 * Only the first was ever resolved, which made the plainer of the two invisible.
 *
 * The sink namespace travels separately because it stops agreeing with the target once the target is a
 * host: `api.stripe.com` is one component wherever it is called from, so its identity carries a global
 * namespace and no module. Asking that namespace what the sink showed would find nothing and the rules
 * would resume asserting an absence nobody checked.
 */
type RetriedOperation = {
  readonly target: ComponentIdentity;
  readonly sinkNamespace: string;
  readonly symbol: string;
};

const retriedOperation = (
  module: ModuleFacts,
  context: DiscoveryContext,
  performed: CallSiteEffects,
  call: CallFact,
): RetriedOperation | undefined => {
  const atCallSite = performed.at(module.file, call);
  if (atCallSite !== undefined) {
    return {
      target: atCallSite,
      sinkNamespace: moduleNamespace(module.file),
      symbol: dotted(call.calleePath),
    };
  }
  const name = calleeName(call);
  const declared = name === '' ? undefined : context.bindings.lookup(module.file, name);
  return declared === undefined
    ? undefined
    : { target: declared, sinkNamespace: declared.namespace, symbol: name };
};

/** Calls written inside a construct, by line, which is how a call site is reached from the construct. */
const callsWithin = (module: ModuleFacts, construct: ControlFlowFact): readonly CallFact[] => {
  const endLine = construct.location.endLine ?? construct.location.startLine;
  return module.calls.filter(
    (call) =>
      call.location.startLine >= construct.location.startLine &&
      (call.location.endLine ?? call.location.startLine) <= endLine,
  );
};

/**
 * A loop that re-attempts the same operation, with a try around it. Recorded as unbounded because nothing
 * in the syntax states a limit.
 */
const discoverRetryLoops = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
  sinks: Sinks,
  performed: CallSiteEffects,
): void => {
  for (const construct of module.controlFlow) {
    if (construct.kind !== 'try_catch' || construct.contains.length === 0) continue;
    const loop = enclosingLoopOf(module, construct);
    if (loop === undefined) continue;
    const evidence = reattemptEvidence(loop, construct);
    if (evidence === undefined) continue;

    const scope = construct.enclosing ?? 'module-scope';
    const drawn = new Set<string>();
    for (const call of callsWithin(module, construct)) {
      const operation = retriedOperation(module, context, performed, call);
      if (operation === undefined) continue;
      const { target } = operation;
      const key = `${target.kind}:${target.namespace}:${target.localName}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      builder.addEdge(
        drafts.edge({
          kind: callRelationKind(target.kind),
          from: ensureScope({
            module,
            context,
            builder,
            found,
            name: scope,
            location: construct.location,
            inferredFrom: 'scope containing a retry loop',
          }),
          to: target,
          location: construct.location,
          symbol: `retry loop around ${operation.symbol}`,
          confidence: CONFIDENCE_BANDS.structural,
          policy: {
            retry: {
              bounded: loop.passesBounded === true,
              backoff: 'unknown',
              idempotency: 'unknown',
            },
          },
          metadata: {
            retryShape: 'loop-with-try',
            reattemptEvidence: evidence,
            ...sinkMetadata(sinks.get(operation.sinkNamespace)),
            ...(headerCeiling(loop) === undefined
              ? {}
              : { attemptCeiling: headerCeiling(loop) as string }),
          },
        }),
      );
      found.edges += 1;
    }
  }
};

export const effectsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '1',
  ecosystem: 'javascript',
  // A side effect is a convention, not a package.
  packages: [],
  appliesTo: (context) => context.modules.length > 0,
  discover: (context, builder): AdapterFindings => {
    const found: Found = { components: 0, edges: 0, files: new Set() };
    /*
     * Read before anything is judged, because the sink of a retried operation is usually in a different
     * module from the retry, and a rule that asserts an absence has to have looked everywhere it could.
     */
    const sinks: Sinks = new Map(
      context.modules
        .filter((module) => !isTestFile(module.file))
        .map(
          (module) =>
            [
              moduleNamespace(module.file),
              {
                deduplicates: idempotencyEvidenceIn(module),
                ceiling: ceilingEvidenceIn(module),
              },
            ] as const,
        )
        .filter((entry) => entry[1].deduplicates !== undefined || entry[1].ceiling !== undefined),
    );
    /*
     * A test harness reaches real clients at fakes, and an effect discovered only there describes the harness
     * rather than the system. Reading them mapped one repository's `sqlite` database entirely from a `FakeD1`
     * over `node:sqlite` while its real database binding stayed absent from the graph.
     */
    const audited = context.modules.filter((module) => !isTestFile(module.file));
    /*
     * Effects before retries, across every module rather than within each one.
     *
     * A retry resolves to the operation the retried call performs, and that operation is usually
     * discovered in the module defining the function rather than in the module retrying it. Reading both
     * in one pass made the answer depend on which file traversal reached first, which is a property of
     * the directory listing and not of the repository.
     */
    const performed = createCallSiteEffects();
    for (const module of audited) {
      discoverHttp(module, context, builder, found, performed);
      discoverStores(module, context, builder, found);
    }
    for (const module of audited) {
      discoverRetryHelpers(module, context, builder, found, sinks);
      discoverRetryLoops(module, context, builder, found, sinks, performed);
    }
    return {
      componentsFound: found.components,
      edgesFound: found.edges,
      filesInspected: found.files.size,
    };
  },
};
