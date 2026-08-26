/**
 * Recognising a model call from the address it is sent to.
 *
 * A system that calls a provider through `fetch` rather than through its published package is invisible
 * to an adapter that looks for an import, because there is no import to find. One project in a thirty six
 * repository sweep runs thirteen MCP servers under a swarm orchestrator and calls OpenAI by posting to
 * `api.openai.com`, with no `openai` entry in its manifest: the audit described a fifty seven component
 * agent system containing no model at all. Hand rolled systems of that shape are a large part of real
 * agent code, and the host is the only thing in the request that identifies them.
 *
 * The table is here, in the package that owns the vocabulary of what a model call looks like on the wire,
 * because both sides of the join need it and neither may own it. The instrumentation shim reads it to
 * name a span, and static discovery reads it to name a component. A repository whose runtime says
 * `api.openai.com` and whose source says the same thing has to produce the same answer twice, and two
 * copies of a host list is how that stops being true.
 *
 * It is reached through a deep export so the shim can take it without the wire decoder and the schema
 * library behind the package index. Reaching the index took the bundled shim from 14 KiB to 206 KiB and
 * the build refused it.
 */

/**
 * The two names a provider has, because the two sides of the join speak different vocabularies and both
 * are right.
 *
 * `system` is the value the generative AI semantic conventions define for `gen_ai.system`, which is what
 * a span has to carry to be readable by anything else. `provider` is the word a component identity uses,
 * taken from the package a repository imports, because that is what the adapters that read an import
 * already produce. One column would make a repository that imports `@google/genai` and also posts to the
 * same host declare two models where it has one, and reconciling a system against itself is exactly the
 * answer this product exists not to get wrong.
 */
export type ModelEndpoint = {
  readonly system: string;
  readonly provider: string;
};

/**
 * Hosts whose traffic is a model call.
 *
 * Suffix matched, so a regional or project subdomain of the same service is recognised without listing
 * every one.
 *
 * Azure and Bedrock were absent on the argument that their hosts carry a customer's own name, and that
 * is true of the subdomain and not of the suffix. `contoso.openai.azure.com` is a customer's name in
 * front of a suffix Microsoft owns and serves nothing else from, and
 * `bedrock-runtime.us-east-1.amazonaws.com` carries a region rather than a customer. Suffix matching is
 * what the rest of this table already does, and it reads those two exactly as safely as it reads a
 * regional OpenAI subdomain. They are the two largest enterprise paths to a model, and leaving them out
 * described such a repository as an agent system containing no model, which is the failure this table
 * exists to prevent.
 *
 * `amazonaws.com` is not listed. Only the `bedrock-runtime` service prefix is, because every other
 * service on that suffix is something else entirely, and the path is checked after the host in any case.
 */
const BY_HOST_SUFFIX: readonly (readonly [string, ModelEndpoint])[] = [
  ['api.openai.com', { system: 'openai', provider: 'openai' }],
  ['api.anthropic.com', { system: 'anthropic', provider: 'anthropic' }],
  ['generativelanguage.googleapis.com', { system: 'gcp.gemini', provider: 'google' }],
  ['aiplatform.googleapis.com', { system: 'gcp.vertex_ai', provider: 'google' }],
  ['api.mistral.ai', { system: 'mistral_ai', provider: 'mistral' }],
  ['api.cohere.com', { system: 'cohere', provider: 'cohere' }],
  ['api.groq.com', { system: 'groq', provider: 'groq' }],
  ['api.deepseek.com', { system: 'deepseek', provider: 'deepseek' }],
  ['api.x.ai', { system: 'xai', provider: 'xai' }],
  ['api.perplexity.ai', { system: 'perplexity', provider: 'perplexity' }],
  ['openai.azure.com', { system: 'azure.ai.openai', provider: 'azure-openai' }],
  ['bedrock-runtime.amazonaws.com', { system: 'aws.bedrock', provider: 'bedrock' }],
];

/**
 * A Bedrock host names its region between the service and the suffix, which suffix matching alone
 * cannot see: `bedrock-runtime.us-east-1.amazonaws.com` is not a subdomain of
 * `bedrock-runtime.amazonaws.com`. Matched on both ends rather than by listing every region.
 */
const BEDROCK_REGIONAL = /^bedrock-runtime(-fips)?\.[a-z0-9-]+\.amazonaws\.com$/;

export const modelEndpointForHost = (hostname: string): ModelEndpoint | undefined => {
  const lowered = hostname.toLowerCase();
  for (const [suffix, endpoint] of BY_HOST_SUFFIX) {
    if (lowered === suffix || lowered.endsWith(`.${suffix}`)) return endpoint;
  }
  if (BEDROCK_REGIONAL.test(lowered)) return { system: 'aws.bedrock', provider: 'bedrock' };
  return undefined;
};

/**
 * Matched against the operation the path ends with, so a version prefix, a deployment segment and a
 * model name in the middle all pass without letting a word elsewhere in the address decide:
 * `/v1/chat/completions`, `/openai/deployments/gpt-4o/chat/completions` and
 * `/v1beta/models/gemini-2.5-pro:generateContent` are one operation written three ways.
 *
 * Read as a fragment anywhere in the address, two shapes matched that ask a provider for something else
 * about work it already did. `/v1/messages/batches/msgbatch_1/cancel` cancels a batch and contains
 * `messages`; `/v1/fine_tuning/jobs/ft-1/complete` finishes a training job and contains `complete`.
 * Both were reported as model invocations, which is the claim this list exists to stop being wrong
 * about. An operation is what a request ends with, and what precedes it says which resource it is
 * about.
 */
const INFERENCE_OPERATIONS: readonly string[] = [
  'completions',
  'responses',
  'messages',
  'embeddings',
  'embedcontent',
  'generatecontent',
  'generateanswer',
  'predict',
  'invoke',
  'converse',
  'rerank',
  'moderations',
  'images/generations',
  'images/edits',
  'audio/speech',
  'audio/transcriptions',
  'audio/translations',
];

/**
 * The one operation whose word is ordinary enough that ending a path with it settles nothing.
 *
 * Anthropic's deprecated text completion endpoint is `/v1/complete`, and `complete` is also how a
 * provider spells finishing a job, an upload or a batch. So it is read only where that endpoint is: the
 * whole of the path after the version, with nothing addressed in between.
 */
const COMPLETE_UNDER_VERSION = /^\/v\d[a-z0-9]*\/complete$/i;

/**
 * The segments a path is made of, with the method a Gemini or Vertex address carries after a colon read
 * as the last one of them. A query string names arguments rather than an operation and is dropped.
 */
const segmentsOf = (path: string): readonly string[] => {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? '';
  return withoutQuery
    .split('/')
    .flatMap((segment) => segment.split(':'))
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
};

/** Whether the path ends with this operation, which may itself be more than one segment. */
const endsWithOperation = (segments: readonly string[], operation: string): boolean => {
  const words = operation.split('/');
  if (words.length > segments.length) return false;
  return words.every((word, index) => segments[segments.length - words.length + index] === word);
};

/**
 * Whether a request to a provider host is asking it to run a model.
 *
 * Shared by both sides of the join for the reason the host table is: the shim names a span from a request
 * and static discovery names a component from a call site, and a repository whose runtime and whose source
 * describe the same request has to get the same answer twice. Narrowing one side alone would manufacture a
 * delta out of the disagreement.
 */
export const isInferencePath = (path: string): boolean => {
  if (COMPLETE_UNDER_VERSION.test(path.split(/[?#]/, 1)[0] ?? '')) return true;
  const segments = segmentsOf(path);
  return INFERENCE_OPERATIONS.some((operation) => endsWithOperation(segments, operation));
};

/**
 * The provider segment written where a provider is genuinely not settled.
 *
 * Already the word both halves of this build use for the unsettled half of a provider and model pair, so
 * a model reached at an address nobody recognises reads the same way as one whose provider a source did
 * not name. A host derived segment would be worse than this in both directions: it can never equal a
 * declared segment, so the join would never match, and it merges every model served on one port into one
 * component.
 */
export const UNIDENTIFIED_PROVIDER = 'unspecified';

/**
 * The operations an OpenAI compatible server answers, which is the shape rather than the host.
 *
 * A separate, tighter list from the one above, because the one above is calibrated for a host already
 * known to serve models and this one is asked of any address at all. Read host independently, that list
 * says `/users/1/messages`, `/workflows/x/invoke` and `/graphql/responses` are model calls, and its own
 * header says why: it is a question about a provider host.
 *
 * What makes this safe is the version segment. Every OpenAI compatible server answers under `/v1`, so the
 * operation has to be preceded by a version and not by a resource: `/v1/messages` is Anthropic's shape
 * and `/users/1/messages` is a conversation. That one requirement is the whole of the difference, and it
 * covers vLLM, LM Studio, LocalAI, llama.cpp, LiteLLM, OpenRouter, Together and Ollama's `/v1` shim
 * without naming any of them.
 *
 * Azure writes `/openai/deployments/gpt-4o/chat/completions`, with a deployment where the version would
 * be. That is not a loss: `openai.azure.com` is a recognised host, so it is read by the list above.
 */
const OPENAI_COMPATIBLE_OPERATIONS: readonly string[] = [
  'chat/completions',
  'completions',
  'responses',
  'messages',
  'embeddings',
  'moderations',
  'images/generations',
  'images/edits',
  'audio/speech',
  'audio/transcriptions',
  'audio/translations',
];

const VERSION_SEGMENT = /^v\d[a-z0-9]*$/i;

/** Whether a path is the OpenAI compatible shape, answerable without knowing the host. */
export const isOpenAiCompatiblePath = (path: string): boolean => {
  const segments = segmentsOf(path);
  return OPENAI_COMPATIBLE_OPERATIONS.some((operation) => {
    if (!endsWithOperation(segments, operation)) return false;
    const before = segments[segments.length - operation.split('/').length - 1];
    return before !== undefined && VERSION_SEGMENT.test(before);
  });
};

/**
 * What an address says about whether it reaches a model, and about whose model it is.
 *
 * Three answers rather than two, because the question has three answers. A recognised host serving an
 * inference path is a named provider. An unrecognised host serving the OpenAI compatible shape is a model
 * call whose provider this build cannot name, and saying so is the whole of the fix: a traced run against
 * a local server executed seven agents and both its models, and the report said nine declared components
 * were never exercised and that either no scenario reached them or they were unreachable in practice.
 * Both disjuncts were false, about the file the run had just executed, because the host was not on a
 * twelve entry list.
 *
 * Anything else is not an inference call, which a provider host serving a token mint also is not.
 */
export type InferenceRecognition =
  | { readonly kind: 'named'; readonly endpoint: ModelEndpoint }
  | { readonly kind: 'unidentified' }
  | { readonly kind: 'not_inference' };

export const recogniseInference = (hostname: string, path: string): InferenceRecognition => {
  const endpoint = modelEndpointForHost(hostname);
  if (endpoint !== undefined) {
    return isInferencePath(path) ? { kind: 'named', endpoint } : { kind: 'not_inference' };
  }
  return isOpenAiCompatiblePath(path) ? { kind: 'unidentified' } : { kind: 'not_inference' };
};

export type ModelOperation = 'chat' | 'embeddings';

export const modelOperationForPath = (path: string): ModelOperation =>
  path.includes('embedding') ? 'embeddings' : 'chat';

/**
 * The model named in a Vertex or Gemini path, which carries it as a path segment rather than in the body:
 * `/v1/publishers/google/models/gemini-2.5-pro:generateContent`.
 */
export const modelFromPath = (path: string): string | undefined => {
  const match = /\/models\/([^/:?]+)/.exec(path);
  const named = match?.[1];
  return named === undefined || named.length === 0 ? undefined : named;
};
