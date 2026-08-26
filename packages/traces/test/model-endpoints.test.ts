import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isInferencePath,
  modelEndpointForHost,
  modelFromPath,
  modelOperationForPath,
  recogniseInference,
} from '../src/model-endpoints.ts';

/**
 * The one table both sides of the join read.
 *
 * A repository can reach a provider through its published package or by posting to its host, and a
 * system that does both has one model either way. That only holds while the shim and static discovery
 * agree on what a host means, which is why this lives in one place and why the two names it carries per
 * provider are tested rather than assumed.
 */

describe('modelEndpointForHost', () => {
  it('recognises a published provider host', () => {
    assert.equal(modelEndpointForHost('api.openai.com')?.provider, 'openai');
    assert.equal(modelEndpointForHost('api.anthropic.com')?.provider, 'anthropic');
  });

  it('recognises a regional subdomain without listing every one', () => {
    assert.equal(modelEndpointForHost('eu.api.openai.com')?.provider, 'openai');
  });

  it('does not match a host that merely ends with the same letters', () => {
    assert.equal(modelEndpointForHost('notapi.openai.com.evil.test'), undefined);
    assert.equal(modelEndpointForHost('api.stripe.com'), undefined);
  });

  /*
   * The span convention and the package a repository imports disagree about Google, and both are right
   * in their own vocabulary. Collapsing them to one name would make a repository that imports
   * `@google/genai` and also posts to the host declare two models where it has one.
   */
  it('carries the span convention name and the component name separately where they differ', () => {
    const gemini = modelEndpointForHost('generativelanguage.googleapis.com');
    assert.equal(gemini?.system, 'gcp.gemini');
    assert.equal(gemini?.provider, 'google');
    const vertex = modelEndpointForHost('aiplatform.googleapis.com');
    assert.equal(vertex?.system, 'gcp.vertex_ai');
    assert.equal(vertex?.provider, 'google', 'both Google endpoints are one provider in the graph');
  });

  /*
   * A customer's name sits in front of a suffix the provider owns, and the suffix is what this reads.
   * These are the two largest enterprise paths to a model, and leaving them out described a repository
   * that reaches one as an agent system containing no model at all.
   */
  it('recognises the enterprise paths by the suffix their provider owns', () => {
    assert.equal(modelEndpointForHost('contoso.openai.azure.com')?.provider, 'azure-openai');
    assert.equal(
      modelEndpointForHost('bedrock-runtime.us-east-1.amazonaws.com')?.provider,
      'bedrock',
    );
    assert.equal(
      modelEndpointForHost('bedrock-runtime-fips.eu-west-2.amazonaws.com')?.provider,
      'bedrock',
    );
  });

  /*
   * Only the service prefix, never the cloud. Every other service on `amazonaws.com` is something else
   * entirely, and a control plane host is not an inference host.
   */
  it('claims no other service on the same cloud', () => {
    assert.equal(modelEndpointForHost('s3.us-east-1.amazonaws.com'), undefined);
    assert.equal(modelEndpointForHost('dynamodb.amazonaws.com'), undefined);
    assert.equal(modelEndpointForHost('bedrock.us-east-1.amazonaws.com'), undefined);
    assert.equal(modelEndpointForHost('notopenai.azure.com.evil.test'), undefined);
  });
});

describe('reading the request path', () => {
  it('separates an embedding call from a chat call', () => {
    assert.equal(modelOperationForPath('/v1/embeddings'), 'embeddings');
    assert.equal(modelOperationForPath('/v1/responses'), 'chat');
  });

  it('reads a model the provider puts in the path', () => {
    assert.equal(modelFromPath('/v1beta/models/gemini-2.5-pro:generateContent'), 'gemini-2.5-pro');
    assert.equal(modelFromPath('/v1/responses'), undefined);
  });
});

/**
 * Whether a request to a provider host asks it to run a model.
 *
 * Read as a fragment anywhere in the address, two shapes matched that ask a provider about work it has
 * already done: `/v1/messages/batches/msgbatch_1/cancel` contains `messages` and
 * `/v1/fine_tuning/jobs/ft-1/complete` contains `complete`. A model invocation reported where there is
 * none is the claim this list exists to stop being wrong about, so the table is asserted whole rather
 * than one row at a time.
 */
describe('isInferencePath', () => {
  const runsAModel = [
    '/v1/chat/completions',
    '/v1/chat/completions?stream=true',
    '/v1/responses',
    '/v1/messages',
    '/v1/embeddings',
    '/v1/rerank',
    '/v1/moderations',
    '/v1/images/generations',
    '/v1/audio/transcriptions',
    // The deprecated Anthropic text completion endpoint, which is the whole of the path after a version.
    '/v1/complete',
    // A deployment segment in the middle, and a model name in the middle.
    '/openai/deployments/gpt-4o/chat/completions',
    '/v1beta/models/gemini-2.5-pro:generateContent',
    '/v1/projects/p/locations/l/publishers/google/models/m:predict',
    '/model/anthropic.claude-3/invoke',
    '/model/anthropic.claude-3/converse',
  ];

  const doesNot = [
    // The same host serves these, and calling any of them a model call is a claim about a system.
    '/v1/models',
    '/v1/files',
    '/v1/usage',
    '/v1/batches',
    '/v1/realtime/client_secrets',
    // An inference word in a position that is not the operation.
    '/v1/messages/batches/msgbatch_1/cancel',
    '/v1/messages/count_tokens',
    '/v1/fine_tuning/jobs/ft-1/complete',
  ];

  it('reads the operation a path ends with', () => {
    assert.deepEqual(
      runsAModel.filter((path) => !isInferencePath(path)),
      [],
    );
  });

  it('reads nothing else on the same host as one', () => {
    assert.deepEqual(
      doesNot.filter((path) => isInferencePath(path)),
      [],
    );
  });
});

/**
 * An address with no named provider, read by the shape of its path.
 *
 * The host table has twelve entries and every OpenAI compatible server there is fails it. A traced run
 * against a local Ollama recorded its two chat completions as outside effects with `modelCalls: 0`, and
 * the audit built on that run then claimed the nine components it had just exercised were never
 * exercised at all.
 *
 * The first two are FALSIFIERS. The rest are GUARDS: the loose operation list above is calibrated for a
 * host already known to serve models, and read host independently it says an ordinary conversation
 * endpoint is a model call. The version segment is the whole of what stops it.
 */
describe('inference recognised without a named provider', () => {
  it('recognises the OpenAI compatible shape on an address nobody has listed', () => {
    assert.equal(recogniseInference('127.0.0.1', '/v1/chat/completions').kind, 'unidentified');
    assert.equal(recogniseInference('my-vllm.internal', '/v1/embeddings').kind, 'unidentified');
    assert.equal(
      recogniseInference('openrouter.ai', '/api/v1/chat/completions').kind,
      'unidentified',
    );
  });

  it('still names a provider the host settles, and still refuses what that host also serves', () => {
    const named = recogniseInference('api.openai.com', '/v1/chat/completions');
    assert.equal(named.kind, 'named');
    assert.equal(named.kind === 'named' ? named.endpoint.provider : undefined, 'openai');
    assert.equal(recogniseInference('api.openai.com', '/v1/files').kind, 'not_inference');
  });

  it('GUARD: requires a version where a resource would otherwise stand', () => {
    for (const path of [
      '/users/1/messages',
      '/api/conversations/42/messages',
      '/workflows/x/invoke',
      '/graphql/responses',
      '/v2/predict',
    ]) {
      assert.equal(
        recogniseInference('app.example.com', path).kind,
        'not_inference',
        `${path} was read as inference on an unrecognised host`,
      );
    }
  });

  it("GUARD: does not reach a provider's own native shape, which is a separate decision", () => {
    assert.equal(recogniseInference('127.0.0.1', '/api/chat').kind, 'not_inference');
    assert.equal(recogniseInference('127.0.0.1', '/api/generate').kind, 'not_inference');
  });
});
