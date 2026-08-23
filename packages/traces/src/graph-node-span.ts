import type { NormalizedSpan, ObservedValueProvenance } from '@orchescope/schema';
import { attributeProvenance, OPEN_INFERENCE, readStringAttribute } from './attributes.ts';

/**
 * The node of an application's own graph that a span ran as.
 *
 * OpenInference has one kind, `CHAIN`, for everything LangChain composes, and LangGraph composes a great
 * deal: a compiled graph, every node inside it, every subgraph, and every sequence, lambda and model
 * wrapper a node happens to build. Read through the kind alone a chain span says that something is nested
 * here and nothing about what, which is why `isStructuralSpan` declines it. On a run of a pinned LangGraph
 * application that declined twenty three of thirty one spans and left the join with nothing to match: two
 * components, no observed relation, and none of the nine nodes that run had walked.
 *
 * The spans do say what they ran. LangGraph writes the node it is executing into LangChain's run metadata,
 * and the instrumentor emits that metadata verbatim under the OpenInference `metadata` attribute. That
 * value is the node's own name out of the application's graph, which is the same source the LangGraph
 * adapter reads `add_node` from, so the two ends of the join are named by the same authority.
 *
 * **The node's own span is the one the graph named after it.** Every span inside a node carries the same
 * `langgraph_node`, because the attribute names the node the work happened in rather than the work. Reading
 * it off all of them would report one node as having run four times and would count its duration once per
 * runnable nested inside it, and a sample size inflated fourfold is worse than a component missing. The
 * span LangGraph opened for the node is the one whose name is the node's name; anything else inside it
 * names nothing, and a span that names nothing already attaches its work to the nearest enclosing
 * component, which is the node.
 *
 * An instrumentation that stops naming node spans after their nodes goes quiet here rather than wrong, and two
 * entries say so: `corpus/expected/open-deep-research-exercised.json` holds the Python instrumentor and
 * `corpus/expected/memory-agent-js-exercised.json` the JavaScript one. They are two programs writing one shape,
 * and the second was measured because a fact read in one ecosystem is not read in the other.
 */

/** LangGraph's key inside LangChain's run metadata. Absent from any span outside that ecosystem. */
const LANGGRAPH_NODE = 'langgraph_node';

/**
 * The two names LangGraph keeps for the boundary of a graph rather than for a node of it.
 *
 * `addNode` rejects both, in both ecosystems and with the same message: `Node \`__start__\` is reserved`. So no
 * application can declare one, the adapter on the other side of the join has excluded them since it was written,
 * and a span naming one has named the library's own bookkeeping.
 *
 * The two instrumentors disagree about whether it produces a span at all. The same two node graph written in
 * Python and in JavaScript emits three spans there and four here: JavaScript opens one for `__start__`, carrying
 * `langgraph_node: "__start__"` and named after it, and Python opens none. Read as an application step it became
 * `workflow_step:__start__`, reported at medium severity as a part of the system that ran without being declared, with
 * nothing in the repository a reader could declare in answer, and once per graph invocation, so a run through a
 * subgraph reported it again.
 *
 * Declining leaves the span to `isStructuralSpan`, which counts it as `no_name`. That is the accurate reason: the
 * span named the graph's own entry, and this build reads no name for a component out of it.
 */
const RESERVED_NODES = new Set(['__start__', '__end__']);

/** The OpenInference kind LangChain gives every runnable, whatever the runnable is. */
const CHAIN = 'CHAIN';

const nodeNamedIn = (metadata: string): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    // A blob the attribute ceiling truncated is no longer JSON, so it names nothing rather than half a name.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const value = (parsed as Record<string, unknown>)[LANGGRAPH_NODE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export const graphNodeSpan = (
  span: NormalizedSpan,
): { readonly name: string; readonly provenance: ObservedValueProvenance } | undefined => {
  const spanKind = readStringAttribute(span.attributes, OPEN_INFERENCE.spanKind);
  if (spanKind?.value.toUpperCase() !== CHAIN) return undefined;
  const metadata = readStringAttribute(span.attributes, OPEN_INFERENCE.metadata);
  if (metadata === undefined) return undefined;
  const node = nodeNamedIn(metadata.value);
  if (node === undefined || node !== span.name || RESERVED_NODES.has(node)) return undefined;
  return {
    name: node,
    provenance: attributeProvenance(spanKind.attribute, metadata.attribute),
  };
};
