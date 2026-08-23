import { CONFIDENCE_BANDS } from '@orchescope/domain';
import type { SystemGraphBuilder } from '@orchescope/graph';
import type { ComponentIdentity, SourceLocation } from '@orchescope/schema';
import type { ArgumentFact, ModuleFacts } from '@orchescope/source-analysis';
import type { DiscoveryContext, TopologyDiscovery } from '../adapter.ts';
import type { DraftFactory } from '../drafts.ts';
import { sourceIdentity } from '../drafts.ts';

type TopologyRefusal = TopologyDiscovery['unresolved'][number];

/** Adds only tool endpoints whose direct list item resolves to an unchanged local function or known tool. */
export const addCreateAgentTools = (input: {
  readonly context: DiscoveryContext;
  readonly builder: SystemGraphBuilder;
  readonly drafts: DraftFactory;
  readonly module: ModuleFacts;
  readonly agent: ComponentIdentity;
  readonly value: ArgumentFact | undefined;
  readonly location: SourceLocation;
  readonly refuse: (refusal: TopologyRefusal) => void;
}): { readonly components: number; readonly edges: number } => {
  if (input.value === undefined) return { components: 0, edges: 0 };
  if (input.value.kind !== 'array') {
    input.refuse({
      kind: 'explicit_relation',
      reason: 'create_agent tools are computed rather than a direct bounded list.',
      location: input.location,
    });
    return { components: 0, edges: 0 };
  }

  let components = 0;
  let edges = 0;
  const added = new Set<string>();
  for (const item of input.value.items) {
    if (item.kind !== 'identifier') {
      input.refuse({
        kind: 'explicit_relation',
        reason:
          'create_agent contains a tool entry whose local implementation is not source-settled.',
        location: input.location,
      });
      continue;
    }
    const existing = input.context.bindings.lookup(input.module.file, item.name);
    if (existing !== undefined) {
      if (existing.kind !== 'tool') {
        input.refuse({
          kind: 'explicit_relation',
          reason: `create_agent tool ${item.name} resolves to ${existing.kind}, not a tool.`,
          location: input.location,
        });
        continue;
      }
      const key = `${existing.namespace}:${existing.localName}`;
      if (added.has(key)) continue;
      added.add(key);
      input.builder.addEdge(
        input.drafts.edge({
          kind: 'calls_tool',
          from: input.agent,
          to: existing,
          location: input.location,
          symbol: `tools: ${item.name}`,
          confidence: CONFIDENCE_BANDS.deterministic,
        }),
      );
      edges += 1;
      continue;
    }

    const resolved = input.context.symbols.resolve(input.module.file, item.name);
    const definition = resolved?.definition;
    const definingModule =
      resolved === undefined ? undefined : input.context.symbols.moduleOf(resolved.file);
    const definitions =
      resolved === undefined
        ? []
        : input.context.symbols
            .definitionsOf(resolved.file)
            .filter(
              (candidate) => candidate.kind === 'function' && candidate.name === resolved.name,
            );
    const reassigned =
      definingModule?.assignments.some(
        (assignment) => assignment.target.length === 1 && assignment.target[0] === resolved?.name,
      ) === true;
    if (
      resolved === undefined ||
      definition?.kind !== 'function' ||
      definitions.length !== 1 ||
      reassigned
    ) {
      input.refuse({
        kind: 'explicit_relation',
        reason: `create_agent tool ${item.name} has no unique unchanged local function implementation.`,
        location: input.location,
      });
      continue;
    }

    const identity = sourceIdentity('tool', resolved.file, resolved.name);
    const key = `${identity.namespace}:${identity.localName}`;
    if (added.has(key)) continue;
    added.add(key);
    input.builder.addComponent(
      input.drafts.sourceComponent({
        kind: 'tool',
        identity,
        file: resolved.file,
        name: resolved.name,
        location: definition.location,
        symbol: `tools: ${item.name}`,
        confidence: CONFIDENCE_BANDS.deterministic,
        details: { for: 'tool' },
        metadata: { framework: 'langchain-v1', declaredName: resolved.name },
        tags: ['langchain-v1'],
      }),
    );
    input.context.bindings.register(resolved.file, resolved.name, identity);
    input.context.bindings.register(input.module.file, item.name, identity);
    input.context.implementations.record({
      identity,
      file: resolved.file,
      body: definition.location,
      symbol: `tools: ${item.name}`,
    });
    input.builder.addEdge(
      input.drafts.edge({
        kind: 'calls_tool',
        from: input.agent,
        to: identity,
        location: input.location,
        symbol: `tools: ${item.name}`,
        confidence: CONFIDENCE_BANDS.deterministic,
      }),
    );
    components += 1;
    edges += 1;
  }
  return { components, edges };
};
