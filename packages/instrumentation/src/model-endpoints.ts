/**
 * Recognising a model call that arrives as a plain HTTP request.
 *
 * A system that calls a provider through `fetch` rather than through its published package is invisible to
 * static discovery, because there is no import to find. One project in a thirty six repository sweep runs
 * thirteen MCP servers under a swarm orchestrator and calls OpenAI by posting to `api.openai.com`, with no
 * `openai` entry in its manifest: the audit described a fifty seven component agent system containing no
 * model at all. Hand rolled systems of that shape are a large part of real agent code, and the host is the
 * only thing that identifies them.
 *
 * The host decides the provider and the path decides the operation. The model is read from the request
 * body when the provider puts it there and from the URL when the provider puts it there instead, and it is
 * left absent when neither does, because a model name nobody sent is not a model name.
 */

export type ModelCall = {
  readonly provider: string;
  readonly operation: 'chat' | 'embeddings';
  readonly model: string | undefined;
};

/**
 * Hosts whose traffic is a model call.
 *
 * Suffix matched, so a regional or project subdomain of the same service is recognised without listing
 * every one. Azure and Bedrock deployments are deliberately absent: their hosts carry a customer's own
 * name and nothing in the address says what it is, so recognising them would need a guess.
 */
const PROVIDER_BY_HOST_SUFFIX: readonly (readonly [string, string])[] = [
  ['api.openai.com', 'openai'],
  ['api.anthropic.com', 'anthropic'],
  ['generativelanguage.googleapis.com', 'gcp.gemini'],
  ['aiplatform.googleapis.com', 'gcp.vertex_ai'],
  ['api.mistral.ai', 'mistral_ai'],
  ['api.cohere.com', 'cohere'],
  ['api.groq.com', 'groq'],
  ['api.deepseek.com', 'deepseek'],
  ['api.x.ai', 'xai'],
  ['api.perplexity.ai', 'perplexity'],
];

const providerFor = (hostname: string): string | undefined => {
  const lowered = hostname.toLowerCase();
  for (const [suffix, provider] of PROVIDER_BY_HOST_SUFFIX) {
    if (lowered === suffix || lowered.endsWith(`.${suffix}`)) return provider;
  }
  return undefined;
};

const operationFor = (path: string): ModelCall['operation'] =>
  path.includes('embedding') ? 'embeddings' : 'chat';

/**
 * The model named in a Vertex or Gemini path, which carries it as a path segment rather than in the body:
 * `/v1/publishers/google/models/gemini-2.5-pro:generateContent`.
 */
const modelFromPath = (path: string): string | undefined => {
  const match = /\/models\/([^/:?]+)/.exec(path);
  const named = match?.[1];
  return named === undefined || named.length === 0 ? undefined : named;
};

/**
 * The model named in a request body.
 *
 * Read from text that a caller was about to send anyway, parsed defensively, and nothing but the model
 * field is kept. Prompt content is not read here and is not read anywhere in this shim: the generative AI
 * conventions make content capture opt in, and a tool that quietly shipped a system's prompts to a local
 * receiver would be doing something its user did not ask for.
 */
export const modelFromBody = (body: string | undefined): string | undefined => {
  if (body === undefined || body.length === 0 || body.length > 1_000_000) return undefined;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const model = (parsed as Record<string, unknown>)['model'];
    return typeof model === 'string' && model.length > 0 ? model : undefined;
  } catch {
    return undefined;
  }
};

export const recogniseModelCall = (url: URL, body: string | undefined): ModelCall | undefined => {
  const provider = providerFor(url.hostname);
  if (provider === undefined) return undefined;
  const model = modelFromBody(body) ?? modelFromPath(url.pathname);
  return {
    provider,
    operation: operationFor(url.pathname),
    ...(model === undefined ? { model: undefined } : { model }),
  };
};
