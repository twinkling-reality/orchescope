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
 * every one. Azure and Bedrock deployments are deliberately absent: their hosts carry a customer's own
 * name and nothing in the address says what it is, so recognising them would need a guess.
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
];

export const modelEndpointForHost = (hostname: string): ModelEndpoint | undefined => {
  const lowered = hostname.toLowerCase();
  for (const [suffix, endpoint] of BY_HOST_SUFFIX) {
    if (lowered === suffix || lowered.endsWith(`.${suffix}`)) return endpoint;
  }
  return undefined;
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
