import {
  modelEndpointForHost,
  modelFromPath,
  type ModelOperation,
  modelOperationForPath,
} from '@orchescope/traces/model-endpoints';

/**
 * A model call as the request itself describes it.
 *
 * Which hosts are model providers is shared with static discovery through
 * `@orchescope/traces/model-endpoints`, so a repository that posts to `api.openai.com` is recognised the
 * same way whether the evidence comes from its source or from its traffic. What stays here is the half
 * only a running request has: the body.
 *
 * The provider is carried as the `gen_ai.system` value the semantic conventions define, because that is
 * what a span has to say. The model is read from the request body when the provider puts it there and
 * from the URL when the provider puts it there instead, and it is left absent when neither does, because
 * a model name nobody sent is not a model name.
 */

export type ModelCall = {
  readonly system: string;
  readonly operation: ModelOperation;
  readonly model: string | undefined;
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
  const endpoint = modelEndpointForHost(url.hostname);
  if (endpoint === undefined) return undefined;
  const model = modelFromBody(body) ?? modelFromPath(url.pathname);
  return {
    system: endpoint.system,
    operation: modelOperationForPath(url.pathname),
    ...(model === undefined ? { model: undefined } : { model }),
  };
};
