import type { NormalizedSpan } from '@orchescope/schema';
import { OPEN_INFERENCE, readString } from './attributes.ts';

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
 * An instrumentation that stops naming node spans after their nodes goes quiet here rather than wrong, and
 * `corpus/expected/open-deep-research-exercised.json` is what says so.
 */

/** LangGraph's key inside LangChain's run metadata. Absent from any span outside that ecosystem. */
const LANGGRAPH_NODE = 'langgraph_node';

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

export const graphNodeSpanName = (span: NormalizedSpan): string | undefined => {
  const spanKind = readString(span.attributes, OPEN_INFERENCE.spanKind);
  if (spanKind?.toUpperCase() !== CHAIN) return undefined;
  const metadata = readString(span.attributes, OPEN_INFERENCE.metadata);
  if (metadata === undefined) return undefined;
  return nodeNamedIn(metadata) === span.name ? span.name : undefined;
};
