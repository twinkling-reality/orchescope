import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import { type DraftFactory, GLOBAL_NAMESPACES, globalIdentity } from './drafts.ts';

/**
 * A model named as one string.
 *
 * Several frameworks take the model as `provider:model`, so the provider is declared rather than inferred:
 * `openai:gpt-4.1-mini` in Pydantic AI, `anthropic:claude-3-7-sonnet-latest` in a LangGraph prebuilt agent. Both
 * halves become components with the relation between them, because a provider is the thing that carries the
 * network permission and the model is the thing a cost or latency figure belongs to.
 *
 * A string with no separator names only a model. Nothing invents a provider for it: an unnamed provider is a fact
 * nobody wrote down.
 */

export type ModelReference = {
  readonly provider: string | undefined;
  readonly model: string;
};

export const splitModelReference = (value: string): ModelReference => {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    return { provider: undefined, model: value };
  }
  return { provider: value.slice(0, separator), model: value.slice(separator + 1) };
};

export type ModelReferenceInput = {
  readonly drafts: DraftFactory;
  readonly builder: SystemGraphBuilder;
  readonly declared: string;
  readonly file: string;
  readonly location: SourceLocation;
  readonly framework: string;
  /** The agent, or whatever invokes the model. */
  readonly invokedBy: ComponentIdentity;
  readonly confidence?: number;
};

export type ModelReferenceResult = {
  readonly identity: ComponentIdentity;
  readonly components: number;
  readonly edges: number;
};

/**
 * Adds the model, the provider when one is named, and the relations from the caller to the model and from the
 * model to its provider. Evidence is attributed to the adapter that supplied the draft factory.
 */
export const addModelReference = (input: ModelReferenceInput): ModelReferenceResult => {
  const { drafts, builder, declared, framework } = input;
  const { provider, model } = splitModelReference(declared);
  const name = provider === undefined ? model : `${provider}/${model}`;
  const identity = globalIdentity('model', GLOBAL_NAMESPACES.model, name);
  const symbol = `model: ${declared}`;

  builder.addComponent(
    drafts.sourceComponent({
      kind: 'model',
      identity,
      file: input.file,
      name,
      displayName: model,
      location: input.location,
      symbol,
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      details: {
        for: 'model',
        modelId: model,
        ...(provider === undefined ? {} : { provider }),
      },
      metadata: { framework },
    }),
  );
  builder.addEdge(
    drafts.edge({
      kind: 'invokes_model',
      from: input.invokedBy,
      to: identity,
      location: input.location,
      symbol,
    }),
  );
  if (provider === undefined) return { identity, components: 1, edges: 1 };

  const providerIdentity = globalIdentity('provider', GLOBAL_NAMESPACES.provider, provider);
  builder.addComponent(
    drafts.sourceComponent({
      kind: 'provider',
      identity: providerIdentity,
      file: input.file,
      name: provider,
      location: input.location,
      symbol: `provider: ${provider}`,
      ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      // The scope is the provider name, because a model reference names no endpoint.
      permissions: [{ kind: 'network', scope: provider, mode: 'write' }],
      metadata: { framework },
    }),
  );
  builder.addEdge(
    drafts.edge({
      kind: 'served_by_provider',
      from: identity,
      to: providerIdentity,
      location: input.location,
      symbol,
    }),
  );
  return { identity, components: 2, edges: 2 };
};
