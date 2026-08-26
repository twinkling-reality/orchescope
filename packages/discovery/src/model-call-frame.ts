import {
  CONFIDENCE_BANDS,
  INFERRED_ENTRY_POINT_TAG,
  MODEL_CALL_FRAME_TAG,
} from '@orchescope/domain';
import type { ComponentIdentity, Metadata, SourceLocation } from '@orchescope/schema';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ModuleFacts } from '@orchescope/source-analysis';
import type { DiscoveryContext } from './adapter.ts';
import { createDrafts, sourceIdentity } from './drafts.ts';

/**
 * The function a model call was written inside.
 *
 * This component is not a label, it is the anchor. It is the `from` of `invokes_model`, it carries the
 * timeout the call site declared, it is the consumer a prompt is attributed to, and provider
 * qualification and nested binding identity hang off it. Deleting it loses the facts that produce the
 * "declares no timeout" findings, so it keeps existing and keeps carrying all of them.
 *
 * What was wrong was its kind. Four producers minted it as an `agent`, and the 0.9.2 acceptance check
 * measured the consequence: seven demonstration functions in one example file, each a single
 * `chat.completions.create` with no tools and no loop, were reported as seven agents. A three line
 * embedding helper carried `agentSystemDetected` for a repository whose real agent had been refused.
 * `agent` asserts a loop, a tool population and a decision, and a bare generation call shows none of the
 * three.
 *
 * It is an inferred entry point instead, which is the vocabulary this repository already uses for exactly
 * this thing. `effects.ts` mints the enclosing scope of an outside effect the same way, tags it the same
 * way, and draws `invokes_model` from it. Measured before this change, a single function performing one
 * chat completion and one outbound write produced two components, `agent:handlerequest` and
 * `entrypoint:handlerequest`, because `identityKey` includes the kind and the two never merged. One
 * function, one file, one enclosing scope, two components. Reusing the frame collapses them into the one
 * component the repository actually has, where a new kind would have preserved the duplication under a
 * new name. [ADR 0014](../../../docs/architecture/adr/0014-layer-three-refusal-and-the-model-call-frame.md)
 * is the record, including the alternative and why it was refused.
 *
 * The frame is deliberately outside `OBSERVABLE_KINDS`. Auto instrumentation observes HTTP requests and
 * never function names, so no span can carry a source only enclosing function identity, and a kind in
 * that set which no run can name reports `declared-not-exercised` on every run forever. The honest cost
 * is stated rather than hidden: the frame can never be reported as exercised either.
 */

/**
 * The frame for this call, minted once per function and shared with every other producer that finds it.
 *
 * The binding registry is what makes it once rather than once per producer: `effects.ts` looks the same
 * name up before minting its own scope, so a function that both calls a model and writes to the outside
 * world is one component carrying both facts rather than two components carrying one each.
 *
 * No `details` are written. `componentViolations` requires `details.for` to equal the kind, so the
 * `for: 'agent'` these producers used to write is not a stale label but a broken graph, and there is
 * nothing an entry point's details would carry that its metadata and its relations do not. The tool count
 * and the turn ceiling travel in metadata and on the relation, where the adapter already puts the retry
 * policy.
 */
export const ensureModelCallFrame = (input: {
  readonly module: ModuleFacts;
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly producer: string;
  readonly name: string;
  readonly location: SourceLocation;
  readonly metadata: Metadata;
  readonly tags?: readonly string[];
}): ComponentIdentity => {
  const { module, context, builder, name } = input;
  const identity = sourceIdentity('entrypoint', module.file, name);
  const existing = context.bindings.lookup(module.file, name);
  if (existing !== undefined) return existing;

  builder.addComponent(
    createDrafts(input.producer).sourceComponent({
      kind: 'entrypoint',
      file: module.file,
      name,
      location: input.location,
      symbol: name,
      confidence: CONFIDENCE_BANDS.structural,
      metadata: input.metadata,
      tags: ['entrypoint', INFERRED_ENTRY_POINT_TAG, MODEL_CALL_FRAME_TAG, ...(input.tags ?? [])],
    }),
  );
  context.bindings.register(module.file, name, identity);
  return identity;
};

/** The identity a frame has, for producers that need the name before the component exists. */
export const modelCallFrameIdentity = (module: ModuleFacts, name: string): ComponentIdentity =>
  sourceIdentity('entrypoint', module.file, name);
