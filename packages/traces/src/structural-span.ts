import type { NormalizedSpan } from '@orchescope/schema';
import { GEN_AI, OPEN_INFERENCE, readString } from './attributes.ts';

/**
 * A span that reports a nesting rather than a component.
 *
 * An instrumentation opens spans for its own structure as well as for the system it is watching. The
 * OpenAI Agents SDK's instrumentor opens one for the trace, named `Agent workflow`, and one per
 * iteration of the agent loop, named `turn`. Both carry an OpenInference kind and nothing else. Read as
 * components they became `agent:agent-workflow`, `agent_group:agent-workflow` and `agent_group:turn`,
 * reported at medium severity as parts of the system that ran without being declared, which no reader
 * could act on because there was nothing in the repository to declare.
 *
 * The cost was larger than the noise. Every relation the run observed hung off those wrappers rather
 * than off the agent: `agent_group:turn` called `update_seat`, invoked both models and ran both
 * guardrails, so the declared `calls_tool` and the twelve declared `validated_by` relations had no
 * observation to join, and none of the forty two declared relations of that application was ever
 * reported as exercised.
 *
 * **What settles it is that the span names nothing.** Every agent span in that run carries `agent.name`
 * and `graph.node.id`; the two wrappers carry neither, and neither does any chain span carry
 * `gen_ai.workflow.name`. A span name is a name only where a convention says so. The generative AI
 * conventions specify `{operation} {name}` and are read that way, which is why this asks only about the
 * OpenInference dialect; OpenInference specifies nothing of the kind, so a span there with no naming
 * attribute has said that something is nested here and nothing about what. Minting a component from it
 * means inventing one out of the instrumentation's own label.
 *
 * Only the two kinds whose whole content is a name are asked. A `GUARDRAIL` span in that same run also
 * carries nothing but its kind, and its name is the guardrail's: this build has never read an attribute
 * for it, so there is no absent name to notice, and declining would drop an evaluator that joins.
 *
 * Declining is stated rather than silent. Each one is counted in the topology's `unattributed` with
 * reason `no_name`, so a report says how many spans it could not attribute and why.
 */

/**
 * The attributes that name the thing, per OpenInference kind. A kind absent from this table is one
 * whose name this build has never read out of an attribute, so an absent attribute says nothing.
 */
const NAMING_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  AGENT: [GEN_AI.agentName, GEN_AI.agentId, OPEN_INFERENCE.agentName, OPEN_INFERENCE.graphNodeId],
  CHAIN: [GEN_AI.workflowName],
};

export const isStructuralSpan = (span: NormalizedSpan): boolean => {
  const spanKind = readString(span.attributes, OPEN_INFERENCE.spanKind);
  if (spanKind === undefined) return false;
  const naming = NAMING_ATTRIBUTES[spanKind.toUpperCase()];
  if (naming === undefined) return false;
  return readString(span.attributes, ...naming) === undefined;
};
