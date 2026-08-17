import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isInferencePath,
  modelEndpointForHost,
  modelFromPath,
  modelOperationForPath,
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
   * A deployment host carries a customer's own name and nothing in the address says what it serves, so
   * recognising one would be a guess rather than a reading.
   */
  it('leaves a deployment host whose address says nothing alone', () => {
    assert.equal(modelEndpointForHost('my-thing.openai.azure.com'), undefined);
    assert.equal(modelEndpointForHost('bedrock-runtime.us-east-1.amazonaws.com'), undefined);
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
