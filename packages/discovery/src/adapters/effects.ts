import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type {
  ComponentIdentity,
  EdgePolicy,
  SideEffectClass,
  SourceLocation,
} from '@orchescope/schema';
import type { CallFact, ControlFlowFact, ModuleFacts } from '@orchescope/source-analysis';
import {
  calleeName,
  dotted,
  findEntry,
  isTestFile,
  numberValue,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
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

const DATASTORE_CLIENTS: readonly { readonly names: readonly string[]; readonly store: string }[] =
  [
    { names: ['PrismaClient'], store: 'prisma' },
    { names: ['Pool', 'Client'], store: 'postgres' },
    { names: ['createClient'], store: 'redis' },
    { names: ['MongoClient'], store: 'mongodb' },
    { names: ['create_engine', 'sessionmaker'], store: 'sqlalchemy' },
    { names: ['connect'], store: 'sqlite' },
    { names: ['DatabaseSync'], store: 'sqlite' },
  ];

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

/** Classifies an operation from its own name and its HTTP method, never from optimism. */
export const classifyEffect = (name: string, httpMethod?: string): SideEffectClass => {
  const lowered = name.toLowerCase();
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

const serviceIdentity = (host: string): ComponentIdentity =>
  globalIdentity('external_service', GLOBAL_NAMESPACES.service, host);

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
      tags: ['entrypoint'],
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
    const method = httpMethodOf(call);
    const effect = classifyEffect(call.enclosing ?? path, method);
    const target = host ?? 'unresolved-host';

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'external_service',
        identity: serviceIdentity(target),
        file: module.file,
        name: target,
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
          { kind: 'network', scope: target, mode: effect === 'read_only' ? 'read' : 'write' },
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

    builder.addEdge(
      drafts.edge({
        kind: 'calls_service',
        from: ensureCaller(module, call, context, builder, found),
        to: serviceIdentity(target),
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
    const store = DATASTORE_CLIENTS.find((candidate) => candidate.names.includes(name));
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
        kind: target.kind === 'tool' ? 'calls_tool' : 'calls_service',
        from: ensureCaller(module, call, context, builder, found),
        to: target,
        location: call.location,
        symbol: `${calleeName(call)}(${wrappedName})`,
        policy,
        confidence: CONFIDENCE_BANDS.structural,
        metadata: { retryHelper: calleeName(call) },
      }),
    );
    found.edges += 1;
    found.files.add(module.file);
  }
};

const enclosingLoopOf = (
  module: ModuleFacts,
  construct: ControlFlowFact,
): ControlFlowFact | undefined =>
  module.controlFlow.find(
    (candidate) =>
      candidate.kind === 'loop' &&
      candidate.location.startLine <= construct.location.startLine &&
      (candidate.location.endLine ?? candidate.location.startLine) >=
        (construct.location.endLine ?? construct.location.startLine),
  );

/**
 * A loop containing a try that contains a call. This shape is a retry without saying so, and it is recorded as
 * unbounded because nothing in the syntax states a limit.
 */
const discoverRetryLoops = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
): void => {
  for (const construct of module.controlFlow) {
    if (construct.kind !== 'try_catch' || construct.contains.length === 0) continue;
    if (enclosingLoopOf(module, construct) === undefined) continue;

    const scope = construct.enclosing ?? 'module-scope';
    for (const path of construct.contains) {
      const name = path[path.length - 1];
      if (name === undefined) continue;
      const target = context.bindings.lookup(module.file, name);
      if (target === undefined) continue;
      builder.addEdge(
        drafts.edge({
          kind: target.kind === 'tool' ? 'calls_tool' : 'calls_service',
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
          symbol: `retry loop around ${name}`,
          confidence: CONFIDENCE_BANDS.heuristic,
          policy: { retry: { bounded: false, backoff: 'unknown', idempotency: 'unknown' } },
          metadata: { retryShape: 'loop-with-try' },
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
    for (const module of context.modules) {
      /*
       * A test harness reaches real clients at fakes, and an effect discovered only there describes the harness
       * rather than the system. Reading them mapped one repository's `sqlite` database entirely from a `FakeD1`
       * over `node:sqlite` while its real database binding stayed absent from the graph.
       */
      if (isTestFile(module.file)) continue;
      discoverHttp(module, context, builder, found);
      discoverStores(module, context, builder, found);
      discoverRetryHelpers(module, context, builder, found);
      discoverRetryLoops(module, context, builder, found);
    }
    return {
      componentsFound: found.components,
      edgesFound: found.edges,
      filesInspected: found.files.size,
    };
  },
};
