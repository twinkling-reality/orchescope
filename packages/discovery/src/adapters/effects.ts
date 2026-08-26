import {
  CONFIDENCE_BANDS,
  formatCount,
  INFERRED_ENTRY_POINT_TAG,
  isTestFile,
  moduleNamespace,
} from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type {
  ComponentIdentity,
  EdgePolicy,
  SideEffectClass,
  SourceLocation,
} from '@orchescope/schema';
import type {
  ArgumentFact,
  BranchPredicateFact,
  CallFact,
  ControlFlowFact,
  DefinitionFact,
  ModuleFacts,
  ObjectEntryFact,
} from '@orchescope/source-analysis';
import {
  calleeName,
  dotted,
  findEntry,
  numberValue,
  objectArgument,
  stringValue,
} from '@orchescope/source-analysis';
import {
  type ModelEndpoint,
  modelEndpointForHost,
  modelFromPath,
  modelOperationForPath,
  recogniseInference,
  UNIDENTIFIED_PROVIDER,
} from '@orchescope/traces/model-endpoints';
import type { AdapterFindings, AgentSystemAdapter, DiscoveryContext } from '../adapter.ts';
import { callRelationKind } from '../call-relation.ts';
import {
  constructedRetry,
  type DeclaredRetry,
  decoratedRetry,
  namesRetryConstructor,
  usesTenacity,
} from '../declared-retry.ts';
import { createDrafts, GLOBAL_NAMESPACES, globalIdentity, sourceIdentity } from '../drafts.ts';
import { keyDeclaredAt } from '../idempotency-key.ts';
import { definitionForCall, matchRuntimeSymbol } from '../matching.ts';
import {
  type DeclaredDeadline,
  deadlineOfRelation,
  deadlineOnRelation,
  requestDeadline,
} from '../model-deadline.ts';
import {
  addressOf,
  hostOf,
  hostToAskAbout,
  isSameOrigin,
  pathOf,
  statedHostOf,
} from '../request-address.ts';
import {
  ATTEMPT_CEILING_NAME,
  readSinkEvidence,
  type SinkEvidenceIndex,
  sinkKey,
  sinkMetadata,
} from '../sink-evidence.ts';
import { resolveSourceValue } from '../source-value.ts';

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

const HTTP_CLIENT_CONSTRUCTORS: readonly {
  readonly names: readonly string[];
  readonly packages: readonly string[];
  readonly client: string;
}[] = [
  { names: ['Client', 'AsyncClient'], packages: ['httpx'], client: 'httpx' },
  { names: ['Session'], packages: ['requests'], client: 'requests' },
  { names: ['create'], packages: ['axios'], client: 'axios' },
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
 * Datastore clients, by their provider-exported runtime symbol.
 *
 * Every name here is shared syntax somewhere else. Provider identity is therefore mandatory even for
 * distinctive-looking constructors: a missing origin is missing evidence, not permission to infer a
 * database from a short name.
 */
const DATASTORE_CLIENTS: readonly {
  readonly names: readonly string[];
  readonly packages: readonly string[];
  readonly store: string;
}[] = [
  { names: ['PrismaClient'], packages: ['@prisma/client'], store: 'prisma' },
  { names: ['Pool', 'Client'], packages: ['pg'], store: 'postgres' },
  { names: ['createClient'], packages: ['redis', '@redis/client'], store: 'redis' },
  { names: ['MongoClient'], packages: ['mongodb', 'pymongo'], store: 'mongodb' },
  { names: ['create_engine', 'sessionmaker'], packages: ['sqlalchemy'], store: 'sqlalchemy' },
  { names: ['connect'], packages: ['sqlite3'], store: 'sqlite' },
  { names: ['DatabaseSync'], packages: ['node:sqlite'], store: 'sqlite' },
];

const positionalArguments = (call: CallFact): readonly ArgumentFact[] =>
  call.args.filter((argument) => argument.kind !== 'object' || argument.role !== 'keywords');

const keywordArgument = (call: CallFact, name: string): ArgumentFact | undefined => {
  const keywords = call.args.find(
    (argument) => argument.kind === 'object' && argument.role === 'keywords',
  );
  return keywords?.kind === 'object' ? findEntry(keywords.entries, name)?.value : undefined;
};

const sqliteUriIsReadOnly = (value: ArgumentFact | undefined): boolean => {
  if (value?.kind !== 'string' && value?.kind !== 'template') return false;
  return /(?:[?&])mode=ro(?:[&#]|$)/u.test(value.value);
};

/**
 * Whether a SQLite constructor's own exact options restrict the connection to reads.
 *
 * Python only interprets URI query parameters when `uri=True`; without that keyword, `?mode=ro` is part
 * of an ordinary filename and proves no access boundary. Node exposes the same boundary as the exact
 * `readOnly` constructor option. Dynamic options establish neither form, so the default capability
 * remains write rather than being weakened from a name or an incidental string.
 */
const sqliteConnectionIsReadOnly = (
  store: (typeof DATASTORE_CLIENTS)[number],
  call: CallFact,
): boolean => {
  if (store.store !== 'sqlite') return false;
  if (store.packages.includes('sqlite3')) {
    const uri = keywordArgument(call, 'uri');
    return (
      uri?.kind === 'boolean' &&
      uri.value === true &&
      sqliteUriIsReadOnly(positionalArguments(call)[0])
    );
  }
  const options = positionalArguments(call)[1];
  const readOnly =
    options?.kind === 'object' ? findEntry(options.entries, 'readOnly')?.value : undefined;
  return (
    store.packages.includes('node:sqlite') &&
    readOnly?.kind === 'boolean' &&
    readOnly.value === true
  );
};

/** Whether the call resolves to the candidate's exact runtime provider. */
const datastoreCallMatches = (
  context: DiscoveryContext,
  module: ModuleFacts,
  candidate: (typeof DATASTORE_CLIENTS)[number],
  call: CallFact,
): boolean =>
  matchRuntimeSymbol(
    context.modules,
    module,
    {
      path: call.calleePath,
      origin: call.origin,
      enclosing: call.enclosing,
      location: call.location,
    },
    { names: candidate.names, packages: candidate.packages },
  ) !== undefined;

/**
 * The options object among a call's arguments, which these libraries put last rather than at a position.
 *
 * `new Queue(name, opts)` and `new Worker(name, processor, opts)` are the same library and the options
 * sit at different indexes, so reading a fixed one answered for the first and never for the second.
 * `concurrency` is a worker option, so the only field this reads was the one it could never reach: the
 * schema carried a relation field that nothing reading source could produce, which is the same shape as
 * a rule nothing can clear.
 */
const optionsOf = (call: CallFact): readonly ObjectEntryFact[] => {
  for (let index = call.args.length - 1; index >= 1; index -= 1) {
    const argument = call.args[index];
    if (argument?.kind === 'object') return argument.entries;
  }
  return [];
};

const QUEUE_CLIENTS: readonly {
  readonly names: readonly string[];
  readonly packages: readonly string[];
  readonly queue: string;
  readonly relation: 'consumes_from_queue' | 'publishes_to_queue';
}[] = [
  {
    names: ['Queue', 'FlowProducer'],
    packages: ['bullmq'],
    queue: 'bullmq',
    relation: 'publishes_to_queue',
  },
  { names: ['Worker'], packages: ['bullmq'], queue: 'bullmq', relation: 'consumes_from_queue' },
  { names: ['Celery'], packages: ['celery'], queue: 'celery', relation: 'publishes_to_queue' },
  {
    names: ['SQSClient', 'SendMessageCommand'],
    packages: ['@aws-sdk/client-sqs'],
    queue: 'sqs',
    relation: 'publishes_to_queue',
  },
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

type Found = {
  components: number;
  edges: number;
  files: Set<string>;
  /**
   * Requests whose address this build could not resolve to a host.
   *
   * Counted so the adapter can say what it did not read. Every one of these has an authoritative caller
   * and becomes a component named for that function rather than for the service it reaches.
   */
  unresolvedAddresses: number;
  /** Unresolved addresses inside callables that have no authoritative source owner. */
  unresolvedUnnamedAddresses: number;
  /** Source locations whose nearest callable exists but has no authoritative source name. */
  unresolvedCallers: Set<string>;
  /** Source locations of retry loops whose callable owner has no authoritative source name. */
  unresolvedRetryLoops: Set<string>;
};

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
  request: RequestCall,
): {
  readonly identity: ComponentIdentity;
  readonly name: string;
  readonly displayName: string;
  /** Whether this build failed to read a host, as opposed to there being none to read. */
  readonly unresolved: boolean;
} => {
  const { host, url } = request;
  if (host !== undefined) {
    /*
     * A host read from its tail is one component wherever it is called from, exactly as a host written
     * whole is: every request to `*.openai.azure.com` in a repository reaches one service. What differs
     * is what a reader can check, so the name carries the wildcard and the sentence says where it came
     * from rather than presenting a pattern as an address somebody wrote.
     */
    return {
      identity: serviceIdentity(host),
      name: host,
      displayName: request.hostFromTail ? `${host}, whose subdomain is built at run time` : host,
      unresolved: false,
    };
  }
  const scope = call.enclosing;
  if (url !== undefined && isSameOrigin(url)) {
    const name = `same-origin:${scope ?? 'module-scope'}`;
    return {
      identity: sourceIdentity('external_service', module.file, name),
      name,
      displayName:
        scope === undefined
          ? `the same origin, requested by ${module.file}`
          : `the same origin, requested by ${scope}`,
      unresolved: false,
    };
  }
  const name = `unresolved-host:${scope ?? 'module-scope'}`;
  return {
    identity: sourceIdentity('external_service', module.file, name),
    name,
    displayName:
      scope === undefined
        ? `a host ${module.file} builds at run time`
        : `the host ${scope} builds at run time`,
    unresolved: true,
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
): ComponentIdentity | undefined => {
  if (call.enclosingUnresolved === true) {
    found.unresolvedCallers.add(
      `${module.file}:${call.location.startLine}:${call.location.startColumn ?? 0}`,
    );
    found.files.add(module.file);
    return undefined;
  }
  return ensureScope({
    module,
    context,
    builder,
    found,
    name: call.enclosing ?? 'module-scope',
    location: call.location,
    inferredFrom: 'enclosing scope of an external effect',
  });
};

/**
 * Entries that hold the document a request sends, in the three ways the ecosystems write it.
 *
 * A JavaScript `fetch` puts it under `body`, usually wrapped in `JSON.stringify`. A Python client puts it
 * under `json` or `data` as a dictionary. All three end at the same object, and that object is where a
 * provider is told which model to use.
 */
const MODEL_SEARCH_DEPTH = 4;

type ResolvedRequestValue = {
  readonly value: ArgumentFact;
  readonly locations: readonly SourceLocation[];
};

type ResolvedModelName = {
  readonly name: string;
  readonly locations: readonly SourceLocation[];
};

const modelInValue = (
  value: ArgumentFact,
  depth: number,
  resolveNamed: (value: ArgumentFact) => ResolvedRequestValue | undefined,
): ResolvedModelName | undefined => {
  if (value.kind === 'object') return modelInEntries(value.entries, depth, resolveNamed);
  if (value.kind === 'call') {
    for (const argument of value.args) {
      if (argument.kind !== 'object') continue;
      const nested = modelInEntries(argument.entries, depth, resolveNamed);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }
  if (value.kind !== 'identifier' && value.kind !== 'member') return undefined;
  const resolved = resolveNamed(value);
  if (resolved?.value.kind !== 'object') return undefined;
  const nested = modelInEntries(resolved.value.entries, depth, resolveNamed);
  return nested === undefined
    ? undefined
    : { ...nested, locations: [...resolved.locations, ...nested.locations] };
};

/**
 * Nested objects are followed and arrays are not.
 *
 * A request document nests: a JavaScript `fetch` wraps it in `JSON.stringify`, a Python client passes it
 * as a dictionary, and a provider may take it under a session or an input key, which is how one real call
 * site writes `JSON.stringify({ session: { model } })`. Following those is reading. Following an array is
 * guessing, because the arrays in these documents hold messages and tool definitions, and a `model` field
 * inside one of those describes an element rather than the request.
 */
const modelInEntries = (
  entries: readonly ObjectEntryFact[],
  depth: number,
  resolveNamed: (value: ArgumentFact) => ResolvedRequestValue | undefined,
): ResolvedModelName | undefined => {
  const modelEntry = findEntry(entries, 'model');
  const direct = stringValue(modelEntry?.value);
  if (direct !== undefined && modelEntry !== undefined) {
    return { name: direct, locations: [modelEntry.location] };
  }
  if (depth === 0) return undefined;
  for (const entry of entries) {
    const nested = modelInValue(entry.value, depth - 1, resolveNamed);
    if (nested !== undefined) return nested;
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
const modelNamedAt = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
): ResolvedModelName | undefined => {
  const resolveNamed = (value: ArgumentFact): ResolvedRequestValue | undefined => {
    const resolved = resolveSourceValue({
      context,
      module,
      value,
      before: call.location,
      enclosing: call.enclosing,
    });
    return resolved === undefined
      ? undefined
      : { value: resolved.value, locations: resolved.locations };
  };
  for (const argument of call.args) {
    if (argument.kind !== 'object') continue;
    const found = modelInEntries(argument.entries, MODEL_SEARCH_DEPTH, resolveNamed);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * The model a request names, which is the one this build reports it reaching.
 *
 * Shared by the pass that settles a relation's deadline and the pass that writes the relation, because
 * the two have to name the same model or the deadline is filed against a component nobody else produced.
 */
const modelNameAt = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  url: string,
): ResolvedModelName =>
  modelNamedAt(context, module, call) ?? {
    name: modelFromPath(pathOf(url)) ?? 'unspecified',
    locations: [],
  };

/**
 * Whether this request reaches a model, and whose model it reaches.
 *
 * A known provider host is not enough on its own. The same host mints tokens, takes file uploads and
 * answers usage queries, and reading those as model calls reported an authentication endpoint as a
 * model and then offered a remediation naming a client that call site does not have.
 *
 * An unrecognised host is no longer an answer of no. The host table has twelve entries and every OpenAI
 * compatible server there is fails it: a repository whose source posts to its own vLLM was described as
 * an agent system containing no model, and a run against a local Ollama produced the same silence from
 * the other side. The provider is left unidentified rather than guessed, and the shape of the path is
 * what carries the recognition, read by the same function the running shim reads.
 *
 * `host === undefined` still declines, and that is what keeps a same origin request out: `/api/chat/completions`
 * posted by a browser bundle to its own server names no authority, and reading it as a provider call
 * would turn every application that proxies a model into one that is one.
 */
const modelEndpointCalledAt = (
  request: RequestCall,
): { readonly endpoint: ModelEndpoint | undefined; readonly url: string } | undefined => {
  const { url, host } = request;
  if (url === undefined || host === undefined) return undefined;
  const recognised = recogniseInference(hostToAskAbout(host), pathOf(url));
  if (recognised.kind === 'not_inference') return undefined;
  return { endpoint: recognised.kind === 'named' ? recognised.endpoint : undefined, url };
};

const registerInferencePrompt = (input: {
  readonly context: DiscoveryContext;
  readonly module: ModuleFacts;
  readonly call: CallFact;
  readonly consumer: ComponentIdentity;
  readonly supportingLocations: readonly SourceLocation[];
}): void => {
  for (const [slot, argument] of input.call.args.entries()) {
    if (argument.kind !== 'object') continue;
    input.context.promptInputs.register({
      producer: ADAPTER_ID,
      module: input.module,
      call: input.call,
      consumer: input.consumer,
      channel: 'inference_payload',
      slot,
      value: argument,
      location: input.call.location,
      supportingLocations: input.supportingLocations,
    });
  }
};

/**
 * The deadline each model relation may claim, settled across the module before any edge is written.
 *
 * A relation stands for every request one function makes to one model, and the builder merges two drafts
 * for the same relation by taking the union of their policies. So a function that gives one of its two
 * requests an expiring signal would have handed the relation a deadline covering the other one, and the
 * rule would have reported the untimed request as bounded. The answer is a property of the set, which is
 * why it is computed here rather than left to whichever request was read last.
 */
const modelRelationDeadlines = (
  context: DiscoveryContext,
  module: ModuleFacts,
  aliases: ReadonlyMap<string, string>,
): ReadonlyMap<string, DeclaredDeadline> => {
  const grouped = new Map<string, (DeclaredDeadline | undefined)[]>();
  for (const call of module.calls) {
    const request = requestAt(module, call, aliases);
    if (request === undefined) continue;
    const reached = modelEndpointCalledAt(request);
    if (reached === undefined) continue;
    const key = modelRelationKey(context, module, call, reached.endpoint, reached.url);
    const deadline = requestDeadline(optionsOf(call), module.language);
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [deadline]);
    else bucket.push(deadline);
  }
  const declared = new Map<string, DeclaredDeadline>();
  for (const [key, deadlines] of grouped) {
    const deadline = deadlineOfRelation(deadlines);
    if (deadline !== undefined) declared.set(key, deadline);
  }
  return declared;
};

/** The caller and model a relation joins, named the way `ensureCaller` names the scope it mints. */
const providerSegment = (endpoint: ModelEndpoint | undefined): string =>
  endpoint?.provider ?? UNIDENTIFIED_PROVIDER;

const modelRelationKey = (
  context: DiscoveryContext,
  module: ModuleFacts,
  call: CallFact,
  endpoint: ModelEndpoint | undefined,
  url: string,
): string =>
  `${call.enclosing ?? 'module-scope'} ${providerSegment(endpoint)}/${modelNameAt(context, module, call, url).name}`;

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
  readonly endpoint: ModelEndpoint | undefined;
  readonly url: string;
  readonly client: string;
  readonly deadline: DeclaredDeadline | undefined;
}): void => {
  const { module, context, builder, found, call, endpoint, url } = input;
  const path = pathOf(url);
  const modelResolution = modelNameAt(context, module, call, url);
  const model = modelResolution.name;
  /*
   * Neither half settled, so nothing is written. An address nobody recognises serving a model nobody
   * wrote down would mint a component named `unspecified/unspecified`, which names nothing a reader can
   * look at and joins to nothing a run can report. The running shim refuses the same case identically.
   */
  if (endpoint === undefined && model === 'unspecified') return;
  const provider = providerSegment(endpoint);
  const modelIdentity = globalIdentity('model', GLOBAL_NAMESPACES.model, `${provider}/${model}`);

  /*
   * A provider component is a claim about who serves the model, and an unrecognised host does not settle
   * that. The model is still real and still named; what is absent is the party behind it, and inventing
   * one from the host would merge every model on a port and could never match a declared segment.
   */
  if (endpoint !== undefined) {
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'provider',
        identity: globalIdentity('provider', GLOBAL_NAMESPACES.provider, endpoint.provider),
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
  }
  const requestImport = module.imports.filter(
    (entry) => !entry.isType && entry.local === call.calleePath[0],
  );
  const requestImportLocation = requestImport.length === 1 ? requestImport[0]?.location : undefined;
  const supportingLocations = [
    ...(requestImportLocation === undefined ? [] : [requestImportLocation]),
    ...modelResolution.locations,
  ];
  registerInferencePrompt({
    context,
    module,
    call,
    consumer: modelIdentity,
    supportingLocations: [
      ...(requestImportLocation === undefined ? [] : [requestImportLocation]),
      call.location,
    ],
  });
  for (const evidenceLocation of supportingLocations) {
    builder.addComponent(
      drafts.sourceComponent({
        kind: 'model',
        identity: modelIdentity,
        file: evidenceLocation.file,
        name: `${provider}/${model}`,
        location: evidenceLocation,
        symbol: `${input.client} model request evidence`,
        confidence:
          model === 'unspecified' ? CONFIDENCE_BANDS.structural : CONFIDENCE_BANDS.strongStructural,
        details: {
          for: 'model',
          provider,
          modelId: model,
          streaming: false,
        },
        metadata: {
          callSite: input.client,
          reachedOver: 'http',
          language: module.language,
          operation: modelOperationForPath(path),
        },
        tags: ['model-endpoint'],
      }),
    );
  }
  builder.addComponent(
    drafts.sourceComponent({
      kind: 'model',
      identity: modelIdentity,
      file: module.file,
      name: `${provider}/${model}`,
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
        provider,
        modelId: model,
        streaming: false,
      },
      /*
       * How the model is reached, recorded where it is known rather than guessed at later. A model
       * behind a published package has a client object to configure and one reached by a plain request
       * has no such thing, and a rule that cannot tell them apart wrote a remediation naming a client
       * that does not exist, which is a goal an agent cannot complete inside its own scope.
       */
      /*
       * The language is recorded because a request states its deadline differently in each ecosystem,
       * and the remediation a rule prints has to name the one this call site can actually reach for.
       */
      metadata: {
        callSite: input.client,
        reachedOver: 'http',
        language: module.language,
        operation: modelOperationForPath(path),
      },
      tags: ['model-endpoint'],
    }),
  );
  found.components += endpoint === undefined ? 1 : 2;
  found.files.add(module.file);
  context.callSiteEffects.record(module.file, call, modelIdentity);

  /* No provider component, so no edge to one. The model stands on its own and says so. */
  if (endpoint !== undefined) {
    builder.addEdge(
      drafts.edge({
        kind: 'served_by_provider',
        from: modelIdentity,
        to: globalIdentity('provider', GLOBAL_NAMESPACES.provider, endpoint.provider),
        location: call.location,
        symbol: input.client,
      }),
    );
    found.edges += 1;
  }
  const caller = ensureCaller(module, call, context, builder, found);
  if (caller !== undefined) {
    builder.addEdge(
      drafts.edge({
        kind: 'invokes_model',
        from: caller,
        to: modelIdentity,
        location: call.location,
        symbol: input.client,
        confidence: CONFIDENCE_BANDS.structural,
        ...deadlineOnRelation(input.deadline),
      }),
    );
    found.edges += 1;
  }
};

/** The method the call itself names, in the callee or in the options object. */
const statedMethodOf = (call: CallFact): string | undefined => {
  const last = calleeName(call);
  if (HTTP_METHOD_NAMES.has(last) && last !== 'fetch' && last !== 'request') return last;
  const entries = objectArgument(call, 1);
  return stringValue(findEntry(entries, 'method')?.value);
};

/**
 * Local names that stand for a client this adapter recognises.
 *
 * A module written so its network client can be replaced in a test assigns the client to a name first,
 * and every adapter here matches on the callee path. `shipBatch` in one field report's target repository
 * writes `const fetchImpl = opts.fetchImpl ?? fetch` and then calls `fetchImpl`, and the whole function
 * was absent from the graph: no service, no method, no retry, in the module whose entire reason for
 * being separately testable is that it holds the retry policy.
 *
 * Resolved once per module rather than per call, and only to a client already in the table, so this
 * widens what a known client may be called and not what counts as one.
 */
const clientAliases = (
  context: DiscoveryContext,
  module: ModuleFacts,
): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();
  for (const definition of module.definitions) {
    if (definition.aliasedFrom === undefined) continue;
    for (const alias of definition.aliasedFrom) {
      const client = HTTP_CLIENTS.find((candidate) => candidate.path === dotted(alias));
      if (client !== undefined) aliases.set(definition.name, client.path);
    }
  }
  for (const call of module.calls) {
    const definition = definitionForCall(module, call);
    if (definition?.kind !== 'variable') continue;
    const clientConstructor = HTTP_CLIENT_CONSTRUCTORS.find(
      (candidate) =>
        matchRuntimeSymbol(
          context.modules,
          module,
          {
            path: call.calleePath,
            origin: call.origin,
            enclosing: call.enclosing,
            location: call.location,
          },
          { names: candidate.names, packages: candidate.packages },
        ) !== undefined,
    );
    if (clientConstructor !== undefined) aliases.set(definition.name, clientConstructor.client);
  }
  return aliases;
};

/**
 * Whether this call is a request, and what it says about itself.
 *
 * Recognising a request and recording what it reaches are two jobs, and the second one is longer. This is
 * the first: everything that decides whether a call leaves the process at all, with the address it names
 * when it names one.
 *
 * A client reached through a member, `axios.get` or `requests.post`, is a request. Any other member of the
 * same root is not, and matching on the root alone read two things as requests that never leave the
 * process.
 *
 * A promise chain repeats the root at every link, so one `fetch(url).then().then().catch()` was counted
 * four times: as `fetch`, `fetch.then`, `fetch.then.then` and `fetch.then.then.catch`, each with its own
 * component and edge at the same source location. A test double is configured through the same shape, so
 * `fetch.mockResolvedValue(...)` was recorded as a call to an unresolved host, which made the heaviest
 * edge in a scan of one repository twelve lines of mock setup in a single test file.
 *
 * The operation names this build already recognises are the vocabulary that separates the two.
 */
type RequestCall = {
  /** The callee as the source wrote it, which is what the evidence names. */
  readonly written: string;
  /** The entry in the client table this call matched, whatever the source called it. */
  readonly client: string;
  /** The client it resolves to, when the source reached it under another name. */
  readonly alias: string | undefined;
  /** The address as far as the source writes it, which is the whole of it only when `dynamic` is false. */
  readonly url: string | undefined;
  readonly host: string | undefined;
  /**
   * Whether the host is stated around what the address substitutes rather than written whole.
   *
   * `` `https://${service}.openai.azure.com` `` settles its tail and not its head, so the host carries a
   * wildcard where the label goes. A reader deciding whether to act on it needs to know which of the two
   * they have, and the component says so rather than reading like a host somebody wrote down.
   */
  readonly hostFromTail: boolean;
  /** Whether the address is completed at run time, so the recorded url is a prefix and not the request. */
  readonly dynamic: boolean;
};

const sameOptionalLocation = (
  left: SourceLocation | undefined,
  right: SourceLocation | undefined,
): boolean =>
  left === undefined || right === undefined
    ? left === right
    : left.file === right.file &&
      left.startLine === right.startLine &&
      left.startColumn === right.startColumn &&
      left.endLine === right.endLine &&
      left.endColumn === right.endColumn;

const locationContains = (outer: SourceLocation, inner: SourceLocation): boolean => {
  if (outer.file !== inner.file) return false;
  const startsBefore =
    outer.startLine < inner.startLine ||
    (outer.startLine === inner.startLine && (outer.startColumn ?? 0) <= (inner.startColumn ?? 0));
  const outerEndLine = outer.endLine ?? outer.startLine;
  const innerEndLine = inner.endLine ?? inner.startLine;
  const endsAfter =
    outerEndLine > innerEndLine ||
    (outerEndLine === innerEndLine &&
      (outer.endColumn ?? Number.MAX_SAFE_INTEGER) >= (inner.endColumn ?? inner.startColumn ?? 0));
  return startsBefore && endsAfter;
};

const callBranches = (module: ModuleFacts, call: CallFact): readonly BranchPredicateFact[] => [
  ...(call.branches ?? []),
  ...module.definitions.flatMap((definition) =>
    definition.branches !== undefined && locationContains(definition.location, call.location)
      ? definition.branches
      : [],
  ),
];

const definitionBranchReachesCall = (
  module: ModuleFacts,
  definition: DefinitionFact,
  call: CallFact,
): boolean =>
  (definition.branches ?? []).every((branch) =>
    callBranches(module, call).some(
      (candidate) =>
        candidate.operator === branch.operator &&
        candidate.branch === branch.branch &&
        sameOptionalLocation(candidate.location, branch.location),
    ),
  );

const locationEndsBefore = (left: SourceLocation, right: SourceLocation): boolean => {
  const endLine = left.endLine ?? left.startLine;
  if (endLine !== right.startLine) return endLine < right.startLine;
  return (left.endColumn ?? left.startColumn ?? 0) <= (right.startColumn ?? 0);
};

const branchesAreMutuallyExclusive = (
  left: readonly BranchPredicateFact[] | undefined,
  right: readonly BranchPredicateFact[] | undefined,
): boolean =>
  (left ?? []).some((branch) =>
    right?.some(
      (candidate) =>
        candidate.operator === branch.operator &&
        candidate.branch !== branch.branch &&
        sameOptionalLocation(candidate.location, branch.location),
    ),
  );

const shadowsBrowserFetch = (module: ModuleFacts, call: CallFact): boolean =>
  module.imports.some(
    (entry) =>
      !entry.isType &&
      entry.local === 'fetch' &&
      (entry.enclosing === undefined || entry.enclosing === call.enclosing),
  ) ||
  module.definitions.some((definition) => {
    if (
      definition.parameters?.some((parameter) => parameter.name === 'fetch') &&
      locationContains(definition.location, call.location)
    ) {
      return true;
    }
    if (definition.name !== 'fetch') return false;
    if (definition.declarationKind === 'var') {
      if (definition.enclosing === undefined) return true;
      return (
        definition.enclosingLocation !== undefined &&
        locationContains(definition.enclosingLocation, call.location)
      );
    }
    const ownsCall =
      definition.enclosing === undefined ||
      (definition.enclosingLocation !== undefined &&
        locationContains(definition.enclosingLocation, call.location));
    return ownsCall && definitionBranchReachesCall(module, definition, call);
  }) ||
  module.assignments.some(
    (assignment) =>
      assignment.target.length === 1 &&
      assignment.target[0] === 'fetch' &&
      locationEndsBefore(assignment.location, call.location) &&
      !branchesAreMutuallyExclusive(assignment.branches, callBranches(module, call)) &&
      (assignment.enclosing === undefined ||
        (assignment.enclosing === call.enclosing &&
          sameOptionalLocation(assignment.enclosingLocation, call.enclosingLocation))),
  );

const requestAt = (
  module: ModuleFacts,
  call: CallFact,
  aliases: ReadonlyMap<string, string>,
): RequestCall | undefined => {
  /*
   * Matched under the client's own name and recorded under the one the source wrote. A reader looking for
   * `fetchImpl` in the file has to find `fetchImpl` in the evidence, and the alias is a fact about how
   * this repository is put together rather than something to normalise away.
   */
  const written = dotted(call.calleePath);
  const alias = aliases.get(call.calleePath[0] ?? '');
  const path = alias === undefined ? written : dotted([alias, ...call.calleePath.slice(1)]);
  const root = alias ?? call.calleePath[0] ?? '';
  const client = HTTP_CLIENTS.find(
    (candidate) =>
      path === candidate.path ||
      (root === candidate.path.split('.')[0] && HTTP_METHOD_NAMES.has(calleeName(call))),
  );
  if (client === undefined) return undefined;
  if (
    client.path === 'fetch' &&
    alias === undefined &&
    (module.language === 'python' || shadowsBrowserFetch(module, call))
  ) {
    return undefined;
  }
  const first = call.args[0];
  const url = addressOf(first);
  const stated =
    url === undefined
      ? statedHostOf(first, (host) => modelEndpointForHost(hostToAskAbout(host)) !== undefined)
      : undefined;
  return {
    written,
    client: client.path,
    alias,
    url: url ?? stated?.url,
    host: url === undefined ? stated?.host : hostOf(url),
    hostFromTail: stated !== undefined,
    dynamic: first?.kind !== 'string',
  };
};

/**
 * The method the specification gives a request whose call site names none.
 *
 * `fetch(url)` is a GET, by the specification rather than by inference, and the method is what
 * classification reads before anything else. Without it a bare read has to be judged from its address,
 * and an address names a resource rather than an operation: `https://host/v1/payments` would be read as
 * financial when it is a poll.
 *
 * Only `fetch`, and only where the address is written at the call site. `fetch(request)` carries its
 * method on a `Request` object this build does not read, and passing an address literal is what rules
 * that shape out. Every other client here either names the method in the callee or takes its options in
 * a position this build has not settled: `axios({ method, url })` puts them first, and reading a default
 * there would answer read only about a POST.
 */
const defaultMethodOf = (request: RequestCall): string | undefined =>
  request.client === 'fetch' && request.url !== undefined ? 'get' : undefined;

/** The method a request runs under, and whether the call site is where it was written down. */
type RequestMethod = { readonly value: string | undefined; readonly stated: boolean };

const methodOf = (call: CallFact, request: RequestCall): RequestMethod => {
  const stated = statedMethodOf(call);
  return stated === undefined
    ? { value: defaultMethodOf(request), stated: false }
    : { value: stated, stated: true };
};

/**
 * What the call site said about its request, recorded so a reader can check it against the source.
 *
 * Two of these entries qualify another rather than carrying a value of their own. A method the
 * specification supplied and an address completed at run time are both things a reader would otherwise
 * have to take on trust, and going to the file and finding neither written there is what makes a tool
 * look wrong in the one place it is being careful.
 */
const requestMetadata = (
  request: RequestCall,
  method: RequestMethod,
): Record<string, string | boolean> => ({
  client: request.written,
  ...(request.alias === undefined ? {} : { aliasOf: request.alias }),
  ...(method.value === undefined ? {} : { httpMethod: method.value }),
  ...(method.value === undefined || method.stated ? {} : { httpMethodDefaulted: true }),
  ...(request.url === undefined ? {} : { url: request.url }),
  ...(request.dynamic ? { urlIsDynamic: true } : {}),
  ...(request.hostFromTail ? { hostReadFromTail: true } : {}),
});

/**
 * The name an operation carries, which is never the name of the client performing it.
 *
 * `classifyEffect` reads a name for what the operation does, and the fallback when the enclosing scope
 * is anonymous was the callee: `fetch`. A library's name is not evidence about the request, and since it
 * holds no write verb an inline handler posting to `/v1/transfers` classified `unknown` while the same
 * body extracted into `sendTransfer` classified `non_idempotent_write`. A cosmetic refactor decided
 * whether a security rule could fire, and the more common of the two spellings was the silent one.
 *
 * The address answers where no scope does. It is read after the enclosing scope, because the author's
 * own word for the operation outranks the resource it addresses, and before the client, which stands in
 * only when the request writes no address down.
 */
const operationNamedBy = (call: CallFact, request: RequestCall): string => {
  const leaf = call.enclosing?.split('.').at(-1)?.toLowerCase();
  if (
    call.enclosing !== undefined &&
    leaf !== 'run' &&
    leaf !== 'execute' &&
    leaf !== 'handler' &&
    leaf !== 'callback'
  ) {
    return call.enclosing;
  }
  const path = request.url === undefined ? '' : pathOf(request.url);
  return path === '' ? request.written : path;
};

const discoverHttp = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
): void => {
  const aliases = clientAliases(context, module);
  const deadlines = modelRelationDeadlines(context, module, aliases);
  for (const call of module.calls) {
    const request = requestAt(module, call, aliases);
    if (request === undefined) continue;
    const { written, host } = request;
    /*
     * A request that reaches a model is recorded as a model call and nothing else. One that reaches a
     * provider host without reaching a model is still recorded, as a request: dropping a discovered
     * outbound call would trade a wrong answer for a missing one.
     */
    const reached = modelEndpointCalledAt(request);
    if (reached !== undefined) {
      discoverModelEndpoint({
        module,
        context,
        builder,
        found,
        call,
        endpoint: reached.endpoint,
        url: reached.url,
        client: written,
        deadline: deadlines.get(
          modelRelationKey(context, module, call, reached.endpoint, reached.url),
        ),
      });
      continue;
    }
    const method = methodOf(call, request);
    const effect = classifyEffect(operationNamedBy(call, request), method.value);
    if (call.enclosingUnresolved === true && host === undefined) {
      ensureCaller(module, call, context, builder, found);
      found.unresolvedUnnamedAddresses += 1;
      continue;
    }
    const service = serviceCalledAt(module, call, request);

    builder.addComponent(
      drafts.sourceComponent({
        kind: 'external_service',
        identity: service.identity,
        file: module.file,
        name: service.name,
        displayName: service.displayName,
        location: call.location,
        symbol: written,
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
        metadata: requestMetadata(request, method),
        tags: ['http'],
      }),
    );
    found.components += 1;
    found.files.add(module.file);
    if (service.unresolved) found.unresolvedAddresses += 1;
    context.callSiteEffects.record(module.file, call, service.identity, effect);

    const caller = ensureCaller(module, call, context, builder, found);
    if (caller !== undefined) {
      builder.addEdge(
        drafts.edge({
          kind: 'calls_service',
          from: caller,
          to: service.identity,
          location: call.location,
          symbol: written,
          confidence: CONFIDENCE_BANDS.structural,
          metadata: {
            httpMethod: method.value ?? 'unknown',
            sideEffect: effect,
          },
        }),
      );
      found.edges += 1;
    }
  }
};

const discoverStores = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
): void => {
  for (const call of module.calls) {
    const store = DATASTORE_CLIENTS.find((candidate) =>
      datastoreCallMatches(context, module, candidate, call),
    );
    if (store !== undefined) {
      const identity = globalIdentity('database', GLOBAL_NAMESPACES.datastore, store.store);
      const permissionMode = sqliteConnectionIsReadOnly(store, call) ? 'read' : 'write';
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
          permissions: [{ kind: 'database', scope: store.store, mode: permissionMode }],
          metadata: { client: dotted(call.calleePath) },
          tags: ['datastore'],
        }),
      );
      found.components += 1;
      found.files.add(module.file);
      context.callSiteEffects.record(module.file, call, identity);
      const caller = ensureCaller(module, call, context, builder, found);
      if (caller !== undefined) {
        builder.addEdge(
          drafts.edge({
            kind: 'queries_database',
            from: caller,
            to: identity,
            location: call.location,
            symbol: dotted(call.calleePath),
            confidence: CONFIDENCE_BANDS.heuristic,
          }),
        );
        found.edges += 1;
      }
      continue;
    }
    const queue = QUEUE_CLIENTS.find(
      (candidate) =>
        matchRuntimeSymbol(
          context.modules,
          module,
          {
            path: call.calleePath,
            origin: call.origin,
            enclosing: call.enclosing,
            location: call.location,
          },
          { names: candidate.names, packages: candidate.packages },
        ) !== undefined,
    );
    if (queue === undefined) continue;
    const first = call.args[0];
    const queueName = first !== undefined && first.kind === 'string' ? first.value : queue.queue;
    const identity = globalIdentity('queue', GLOBAL_NAMESPACES.queue, queueName);
    const concurrency = numberValue(findEntry(optionsOf(call), 'concurrency')?.value);
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
    context.callSiteEffects.record(module.file, call, identity);
    const caller = ensureCaller(module, call, context, builder, found);
    if (caller !== undefined) {
      builder.addEdge(
        drafts.edge({
          kind: queue.relation,
          from: caller,
          to: identity,
          location: call.location,
          symbol: dotted(call.calleePath),
          confidence: CONFIDENCE_BANDS.structural,
          ...(concurrency === undefined ? {} : { policy: { concurrency } }),
        }),
      );
      found.edges += 1;
    }
  }
};

/**
 * A ceiling the loop itself states, which is a stronger answer than one found in the sink.
 *
 * A condition that names a maximum is the author writing the limit down, and it is worth saying which
 * name they wrote. Only for a loop whose passes are bounded: a head that names a maximum and can never
 * be false has not stated a ceiling, and reporting one let a rule decline about an infinite retry on the
 * strength of the word in its condition.
 */
const headerCeiling = (loop: ControlFlowFact): string | undefined => {
  if (loop.passesBounded !== true) return undefined;
  const named = (loop.headerNames ?? []).find((name) => ATTEMPT_CEILING_NAME.test(name));
  return named === undefined ? undefined : `its condition names ${named}`;
};

/**
 * Where to ask what the function performing an operation showed.
 *
 * A name is followed to the module and the function that define it, because that is the function whose
 * evidence is being asked about: an alias at the call site says nothing about how the sink deduplicates.
 * A name that resolves nowhere is asked about in the module that wrote it, which is the best this build
 * can say and is bounded by that module rather than by the repository.
 */
const sinkOfName = (context: DiscoveryContext, file: string, name: string): string => {
  const resolved = context.symbols.resolve(file, name);
  return resolved === undefined
    ? sinkKey(moduleNamespace(file), name)
    : sinkKey(moduleNamespace(resolved.file), resolved.name);
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
  sinks: SinkEvidenceIndex,
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
    const sink = sinks.get(sinkOfName(context, module.file, wrappedName));
    const policy: EdgePolicy = {
      retry: {
        ...(attempts === undefined ? {} : { maxAttempts: attempts }),
        bounded: attempts !== undefined,
        backoff: findEntry(entries, 'backoff') === undefined ? 'unknown' : 'exponential',
        idempotency: 'unknown',
      },
    };
    const caller = ensureCaller(module, call, context, builder, found);
    if (caller === undefined) continue;
    builder.addEdge(
      drafts.edge({
        kind: callRelationKind(target.kind),
        from: caller,
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
 * The `try` a loop guards a pass with, in the same function, when it has one.
 *
 * Containment is by line range and by scope. Line range alone matched a `try` in one function against a
 * loop in another whose range happened to span it, which is how a one shot `fetch` helper whose only
 * `try` wrapped a `JSON.parse` fallback came to be reported as a retried operation.
 *
 * Optional, because a `try` is one way a pass says it can fail and not the only one. A loop that reads
 * the response and goes round again when it is not ok re-attempts exactly as much, and requiring a `try`
 * made it invisible: the wait, the counter and the request were all there to be read.
 */
const guardedPassIn = (module: ModuleFacts, loop: ControlFlowFact): ControlFlowFact | undefined =>
  module.controlFlow.find(
    (candidate) =>
      candidate.kind === 'try_catch' &&
      candidate.contains.length > 0 &&
      candidate.exitsOnSuccess === true &&
      candidate.enclosing === loop.enclosing &&
      candidate.location.startLine >= loop.location.startLine &&
      (candidate.location.endLine ?? candidate.location.startLine) <=
        (loop.location.endLine ?? loop.location.startLine),
  );

/**
 * Calls that pause before the next pass.
 *
 * Matched on the last segment of the callee path, so `timers.setTimeout` and a locally defined `sleep`
 * both count. These names describe backoff after a retry has been established; they do not establish
 * the retry by themselves.
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
 * Whether anything in this loop says the same failed work is attempted again.
 *
 * This is the whole of the change the field report asked for. A loop with a `try` and an `await` in it was
 * classified as a retry on the strength of that shape alone, and across thirty six repositories the two
 * rules built on it produced no true positive: the matches were per item iteration with per item error
 * isolation, and minified bundles where every shape is present somewhere. So a re-attempt now has to be
 * stated by the code rather than inferred from its silhouette.
 *
 * A wait does not answer that question. Polling loops wait between reads, device pairing loops wait after
 * an explicit non-success response, and durable consumers wait after committing their offset. Treating
 * the pause as retry evidence attaches every effect in those loops to an ambiguous-failure claim the
 * source does not make. A counted `for` loop can state attempts in its own header; a `while` condition
 * that merely mentions an attempts variable cannot, because expected-pending protocols use the same
 * shape. Otherwise the guarded pass has to be able to end the work while a caught failure can fall
 * through to another pass. Explicit retry helpers are recognised separately.
 */
const reattemptEvidence = (
  loop: ControlFlowFact,
  attempted: ControlFlowFact | undefined,
): string | undefined => {
  if (loop.repeats !== 'same_work') return undefined;
  const counter = (loop.headerNames ?? []).find((name) => ATTEMPT_NAME.test(name));
  if (counter !== undefined && loop.countsPasses === true) {
    return `its counted-pass header counts ${counter}`;
  }
  /*
   * The third form, and the one that needs no vocabulary from the author. A pass that returns when it
   * works and falls through when it throws is an attempt, and a loop that repeats it is a retry whatever
   * the counter is called. `for (let i = 0; i < 3; i++)` around a guarded POST was invisible because `i`
   * is not a word this recognises and nothing in the loop waits.
   */
  return attempted?.exitsOnSuccess === true
    ? 'the guarded pass can end the work while a caught failure can fall through to another pass'
    : undefined;
};

/**
 * Operators that make a wait grow with the attempt number.
 *
 * Exponentiation is claimed only where the syntax exponentiates, and a shift by the counter is the same
 * statement written for machines. A wait multiplied by the attempt grows too and is not exponential, so
 * it stays `unknown` rather than being rounded up to the more reassuring word.
 */
const GROWING_OPERATORS = new Set(['**', '<<']);

/**
 * The library spelling of the same statement.
 *
 * `Math.pow(2, attempt)` and `2 ** attempt` are one expression written for two audiences, and reading
 * only the operator reported a textbook exponential backoff as a wait this build could not describe.
 * Python's builtin is spelled the same way.
 */
const GROWING_CALLS = new Set(['pow']);

/** Whether this argument to a wait says the wait grows, given the names the loop multiplies. */
const waitGrows = (argument: ArgumentFact, grown: ReadonlySet<string>): boolean => {
  /*
   * A name is the third spelling and the one the call site cannot see on its own: `sleep(delayMs)` with
   * `delayMs *= 2` beside it is the same backoff with its growth one statement away.
   */
  if (argument.kind === 'identifier') return grown.has(argument.name);
  if (argument.kind !== 'arithmetic') return false;
  return (
    argument.operators.some((operator) => GROWING_OPERATORS.has(operator)) ||
    argument.names.some((name) => GROWING_CALLS.has(name) || grown.has(name))
  );
};

/**
 * How the wait between attempts is written, when a wait is written at all.
 *
 * A retry with no backoff is the dangerous shape: it re-attempts as fast as the dependency can fail, and
 * it converts one struggling service into an outage. Recorded as `none` rather than `unknown` when the
 * loop was found by its counter and waits nowhere, because `unknown` reads as a gap in the reading and
 * this is a fact about the code.
 */
const backoffOfLoop = (
  module: ModuleFacts,
  loop: ControlFlowFact,
): 'none' | 'fixed' | 'exponential' | 'unknown' => {
  const waits = callsWithinScope(module, loop.location, loop.enclosing).filter((call) =>
    DELAY_CALLS.has(calleeName(call)),
  );
  if (waits.length === 0) return 'none';
  const grown = new Set(loop.growingNames ?? []);
  let fixed = false;
  for (const wait of waits) {
    for (const argument of wait.args) {
      if (waitGrows(argument, grown)) return 'exponential';
      if (argument.kind === 'number') fixed = true;
    }
  }
  return fixed ? 'fixed' : 'unknown';
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
  /** What this call was classified as, which the target may not answer for. */
  readonly sideEffect: SideEffectClass | undefined;
  /**
   * Whether the request being repeated carries an idempotency key of its own.
   *
   * The schema says `declared` means a key was found on the retried operation, and only the call site
   * can prove that: a key one frame away is evidence that stops a rule accusing and is not the claim.
   */
  readonly keyed: boolean;
  readonly sinkKey: string;
  readonly symbol: string;
};

const retriedOperation = (
  module: ModuleFacts,
  context: DiscoveryContext,
  call: CallFact,
): RetriedOperation | undefined => {
  const atCallSite = context.callSiteEffects.at(module.file, call);
  if (atCallSite !== undefined) {
    return {
      target: atCallSite.identity,
      sideEffect: atCallSite.sideEffect,
      keyed: keyDeclaredAt(call),
      sinkKey: sinkKey(moduleNamespace(module.file), call.enclosing),
      symbol: dotted(call.calleePath),
    };
  }
  const name = calleeName(call);
  const declared = name === '' ? undefined : context.bindings.lookup(module.file, name);
  return declared === undefined
    ? undefined
    : {
        target: declared,
        sideEffect: undefined,
        /*
         * A named helper is handed the key and what it does with it is a frame this build has not read,
         * so the operation has not been shown to declare one.
         */
        keyed: false,
        sinkKey: sinkOfName(context, module.file, name),
        symbol: name,
      };
};

/** Calls written inside a span, by line, which is how a call site is reached from a construct. */
const callsWithin = (module: ModuleFacts, span: SourceLocation): readonly CallFact[] => {
  const endLine = span.endLine ?? span.startLine;
  return module.calls.filter(
    (call) =>
      call.location.startLine >= span.startLine &&
      (call.location.endLine ?? call.location.startLine) <= endLine,
  );
};

/** Calls in a span that execute in the same settled callable rather than in a nested declaration. */
const callsWithinScope = (
  module: ModuleFacts,
  span: SourceLocation,
  scope: string | undefined,
): readonly CallFact[] =>
  callsWithin(module, span).filter(
    (call) => call.enclosingUnresolved !== true && call.enclosing === scope,
  );

/**
 * The tenacity construction a loop iterates, when it iterates one.
 *
 * Asked of what the loop directly contains rather than of its line range, because these loops nest: the
 * `async for attempt in AsyncRetrying(...)` in the field report's target sits inside a `for batch in
 * batches`, and a range would attribute the retry to both. The construction is then found by line so its
 * arguments can be read, which is where the ceiling and the wait are written.
 */
const iteratedRetryOf = (
  modules: readonly ModuleFacts[],
  module: ModuleFacts,
  loop: ControlFlowFact,
): { readonly declared: DeclaredRetry; readonly call: CallFact } | undefined => {
  if (!loop.contains.some((path) => namesRetryConstructor(path))) return undefined;
  for (const call of callsWithinScope(module, loop.location, loop.enclosing)) {
    const declared = constructedRetry(modules, module, call);
    if (declared !== undefined) return { declared, call };
  }
  return undefined;
};

/**
 * How a loop says it re-attempts, which is two questions and not one.
 *
 * A loop can say it by its shape, which is what a counter, a wait and a pass that returns on success
 * amount to; or it can iterate an object that states the policy outright, which is what tenacity's
 * `AsyncRetrying` is. The declaration is asked first, because a loop over one says nothing in its own
 * shape: each pass takes the next item from an iterator, which is exactly what separates an iteration
 * from a re-attempt everywhere else here.
 */
type LoopRetry = {
  readonly evidence: string;
  readonly shape: string;
  /** The policy a library stated, when one did, which answers for the ceiling and the wait as well. */
  readonly declared: DeclaredRetry | undefined;
  /** The construction, which is the one call inside the loop that is not an operation being repeated. */
  readonly construction: CallFact | undefined;
};

const loopRetryOf = (
  modules: readonly ModuleFacts[],
  module: ModuleFacts,
  loop: ControlFlowFact,
  declaresRetries: boolean,
): LoopRetry | undefined => {
  const iterated = declaresRetries ? iteratedRetryOf(modules, module, loop) : undefined;
  if (iterated !== undefined) {
    return {
      evidence: iterated.declared.declaredAs,
      shape: 'loop-over-declared-retry',
      declared: iterated.declared,
      construction: iterated.call,
    };
  }
  const attempted = guardedPassIn(module, loop);
  const evidence = reattemptEvidence(loop, attempted);
  if (evidence === undefined) return undefined;
  return {
    evidence,
    shape: attempted === undefined ? 'loop-with-check' : 'loop-with-try',
    declared: undefined,
    construction: undefined,
  };
};

/**
 * What a retry was read as, gathered before any relation is drawn.
 *
 * The three forms differ only in how the retry announces itself: a loop's own shape, a policy object the
 * loop iterates, or a decorator above a function. What each one repeats, and the relation that says so,
 * are the same afterwards, so they are settled here once and drawn once.
 */
type RetryReading = {
  readonly shape: string;
  readonly evidence: string;
  /** Present when a library stated the policy, so a rule can say which one rather than "a loop". */
  readonly declaration: string | undefined;
  readonly bounded: boolean;
  readonly maxAttempts: number | undefined;
  readonly backoff: NonNullable<EdgePolicy['retry']>['backoff'];
  /** A ceiling the author wrote in the loop head, which is evidence a rule declines on rather than a bound. */
  readonly ceiling: string | undefined;
};

/**
 * The relation each operation inside a retry gets.
 *
 * Every operation performed inside the span is re-attempted, not only the ones a `try` happens to
 * enclose: a request made before the guarded call runs again on the next pass exactly as much as the
 * guarded one does, and the graph is being asked which operations repeat. One relation per distinct
 * operation, because a loop calling the same host twice repeats one thing.
 */
const drawRetriedOperations = (input: {
  readonly module: ModuleFacts;
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly found: Found;
  readonly sinks: SinkEvidenceIndex;
  readonly span: SourceLocation;
  readonly callableScope: string | undefined;
  readonly scopeName: string;
  readonly inferredFrom: string;
  readonly symbolPrefix: string;
  readonly reading: RetryReading;
  /** The call that states the retry, which is not one of the operations it repeats. */
  readonly declaringCall: CallFact | undefined;
}): void => {
  const { module, context, builder, found, sinks, span, reading } = input;
  const drawn = new Set<string>();
  for (const call of callsWithinScope(module, span, input.callableScope)) {
    if (call === input.declaringCall) continue;
    const operation = retriedOperation(module, context, call);
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
          name: input.scopeName,
          location: span,
          inferredFrom: input.inferredFrom,
        }),
        to: target,
        location: span,
        symbol: `${input.symbolPrefix}${operation.symbol}`,
        confidence: CONFIDENCE_BANDS.structural,
        policy: {
          retry: {
            ...(reading.maxAttempts === undefined ? {} : { maxAttempts: reading.maxAttempts }),
            bounded: reading.bounded,
            backoff: reading.backoff,
            idempotency: operation.keyed ? 'declared' : 'unknown',
          },
        },
        metadata: {
          retryShape: reading.shape,
          reattemptEvidence: reading.evidence,
          ...(reading.declaration === undefined ? {} : { retryDeclaration: reading.declaration }),
          /*
           * What the retried call was classified as, stated here because the component it produced may
           * stand for other calls in the same function and cannot answer for this one.
           */
          ...(operation.sideEffect === undefined ? {} : { retriedEffect: operation.sideEffect }),
          ...sinkMetadata(sinks.get(operation.sinkKey)),
          ...(reading.ceiling === undefined ? {} : { attemptCeiling: reading.ceiling }),
        },
      }),
    );
    found.edges += 1;
    found.files.add(module.file);
  }
};

/**
 * A loop that re-attempts the same operation.
 *
 * The loop is the retry, so the loop is what this reads. Keying off the `try` instead made a `try` a
 * requirement rather than a form, and a retry that reads the response and goes round again produced no
 * relation at all.
 */
const discoverRetryLoops = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
  sinks: SinkEvidenceIndex,
): void => {
  const declaresRetries = usesTenacity(module);
  for (const loop of module.controlFlow) {
    if (loop.kind !== 'loop') continue;
    const read = loopRetryOf(context.modules, module, loop, declaresRetries);
    if (read === undefined) continue;
    if (loop.enclosingUnresolved === true) {
      found.unresolvedRetryLoops.add(
        `${module.file}:${loop.location.startLine}:${loop.location.startColumn ?? 0}`,
      );
      found.files.add(module.file);
      continue;
    }
    drawRetriedOperations({
      module,
      context,
      builder,
      found,
      sinks,
      span: loop.location,
      callableScope: loop.enclosing,
      scopeName: loop.enclosing ?? 'module-scope',
      inferredFrom: 'scope containing a retry loop',
      symbolPrefix: 'retry loop around ',
      declaringCall: read.construction,
      reading: {
        shape: read.shape,
        evidence: read.evidence,
        declaration: read.declared?.declaredAs,
        bounded: read.declared?.bounded ?? loop.passesBounded === true,
        maxAttempts: read.declared?.maxAttempts,
        backoff: read.declared?.backoff ?? backoffOfLoop(module, loop),
        ceiling: headerCeiling(loop),
      },
    });
  }
};

/**
 * A function whose decorator declares the retry, which is the form tenacity documents first.
 *
 * There is no loop to read here and no shape to recognise: the policy is written above the function and
 * every operation the body performs is what repeats. `DecoratorFact` already carried it, and nothing had
 * ever asked.
 *
 * Bounded by the definition's own line range, so a nested function declares its own retry and not its
 * parent's.
 */
const discoverDecoratedRetries = (
  module: ModuleFacts,
  context: DiscoveryContext,
  builder: SystemGraphBuilder,
  found: Found,
  sinks: SinkEvidenceIndex,
): void => {
  if (!usesTenacity(module)) return;
  for (const definition of module.definitions) {
    const declared = definition.decorators
      .map((decorator) => decoratedRetry(context.modules, module, definition, decorator))
      .find((candidate) => candidate !== undefined);
    if (declared === undefined) continue;
    drawRetriedOperations({
      module,
      context,
      builder,
      found,
      sinks,
      span: definition.location,
      callableScope: definition.name,
      scopeName: definition.name,
      inferredFrom: 'function whose decorator declares a retry',
      symbolPrefix: 'retried ',
      declaringCall: undefined,
      reading: {
        shape: 'decorated-function',
        evidence: declared.declaredAs,
        declaration: declared.declaredAs,
        bounded: declared.bounded,
        maxAttempts: declared.maxAttempts,
        backoff: declared.backoff,
        ceiling: undefined,
      },
    });
  }
};

export const effectsAdapter: AgentSystemAdapter = {
  id: ADAPTER_ID,
  version: '6',
  // A side effect is a convention, not a package.
  packages: [],
  appliesTo: (context) => context.modules.length > 0,
  discover: (context, builder): AdapterFindings => {
    const found: Found = {
      components: 0,
      edges: 0,
      files: new Set(),
      unresolvedAddresses: 0,
      unresolvedUnnamedAddresses: 0,
      unresolvedCallers: new Set(),
      unresolvedRetryLoops: new Set(),
    };
    const sinks = readSinkEvidence(context.modules);
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
    for (const module of audited) {
      discoverHttp(module, context, builder, found);
      discoverStores(module, context, builder, found);
    }
    for (const module of audited) {
      discoverRetryHelpers(module, context, builder, found, sinks);
      discoverRetryLoops(module, context, builder, found, sinks);
      discoverDecoratedRetries(module, context, builder, found, sinks);
    }
    const notes = [
      ...(found.unresolvedAddresses === 0
        ? []
        : [
            `${formatCount(found.unresolvedAddresses, 'request builds', 'requests build')} an address this build could not resolve to a host, so each is named for the function that builds it. A base address held in a constant is the common cause and following one is not something this build does.`,
          ]),
      ...(found.unresolvedUnnamedAddresses === 0
        ? []
        : [
            `${formatCount(found.unresolvedUnnamedAddresses, 'request also builds', 'requests also build')} an address this build could not resolve to a host inside ${found.unresolvedUnnamedAddresses === 1 ? 'a callable whose owner' : 'callables whose owners'} this build cannot name, so no service component was inferred for ${found.unresolvedUnnamedAddresses === 1 ? 'it' : 'them'}.`,
          ]),
      ...(found.unresolvedCallers.size === 0
        ? []
        : [
            `${formatCount(found.unresolvedCallers.size, 'external call sits', 'external calls sit')} inside ${found.unresolvedCallers.size === 1 ? 'a callable whose owner' : 'callables whose owners'} this build cannot name, so no caller component or relation was inferred for ${found.unresolvedCallers.size === 1 ? 'it' : 'them'}.`,
          ]),
      ...(found.unresolvedRetryLoops.size === 0
        ? []
        : [
            `${formatCount(found.unresolvedRetryLoops.size, 'retry loop sits', 'retry loops sit')} inside ${found.unresolvedRetryLoops.size === 1 ? 'a callable whose owner' : 'callables whose owners'} this build cannot name, so no retry relation was inferred for ${found.unresolvedRetryLoops.size === 1 ? 'it' : 'them'}.`,
          ]),
    ];
    return {
      componentsFound: found.components,
      edgesFound: found.edges,
      filesInspected: [...found.files],
      ...(notes.length === 0 ? {} : { note: notes.join(' ') }),
    };
  },
};
