import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
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
