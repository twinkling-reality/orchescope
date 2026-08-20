import type { NormalizedSpan } from '@orchescope/schema';
import {
  componentKindFor,
  GEN_AI,
  MCP,
  OPEN_INFERENCE,
  observedNameFor,
  readString,
} from './attributes.ts';

/**
 * Reading a handoff that the instrumentation recorded as a tool call.
 *
 * The OpenAI Agents SDK performs a handoff by calling a tool, and the OpenInference instrumentor
 * faithfully records what it sees: `openinference.span.kind` is `TOOL`, and the two agents appear in
 * `input.value` and `output.value`. Read literally, an application whose declared graph is full of
 * handoffs exercises none of them and exercises a tool nothing declared instead, which is what the
 * first traced run of a third party application reported.
 *
 * What settles it is the attributes rather than the span name. A tool span that names no tool, whose
 * input and output are both names the same run reports as agents, transferred control between those
 * two agents. A repository may call a tool whatever it likes, so a name beginning with `handoff to`
 * is corroboration and never the test, and a span that does name a tool is a call to that tool
 * whatever its arguments happen to say.
 *
 * Both ends have to be agents the run itself reported, which is why this is derived from the whole
 * span set rather than from one span at a time: a name that appears only inside these two attributes
 * names nothing this run can show ran.
 */

/**
 * OpenInference records a span's input and output under these two keys whatever its kind is. They are
 * not in the generative AI registry, so there is no second spelling to accept.
 */
const INPUT_VALUE = 'input.value';
const OUTPUT_VALUE = 'output.value';

export type ObservedHandoff = {
  /** The agent that gave up control, as the run named it. */
  readonly fromAgent: string;
  /** The agent that took it. */
  readonly toAgent: string;
};

/**
 * The names this run reports as agents.
 *
 * A span already read as a handoff is excluded: its name describes a destination rather than an agent
 * that ran, so admitting it here would let one handoff qualify the next.
 */
const agentNamesReported = (spans: readonly NormalizedSpan[]): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const span of spans) {
    if (span.operation === 'handoff') continue;
    if (componentKindFor(span.operation) !== 'agent') continue;
    names.add(observedNameFor(span.operation, span.name, span.attributes).toLowerCase());
  }
  return names;
};

export const recognizeHandoffs = (
  spans: readonly NormalizedSpan[],
): ReadonlyMap<string, ObservedHandoff> => {
  const agents = agentNamesReported(spans);
  const handoffs = new Map<string, ObservedHandoff>();
  for (const span of spans) {
    if (span.operation !== 'execute_tool') continue;
    const named = readString(
      span.attributes,
      GEN_AI.toolName,
      OPEN_INFERENCE.toolName,
      MCP.toolName,
    );
    if (named !== undefined) continue;
    const fromAgent = readString(span.attributes, INPUT_VALUE);
    const toAgent = readString(span.attributes, OUTPUT_VALUE);
    if (fromAgent === undefined || toAgent === undefined) continue;
    if (!agents.has(fromAgent.toLowerCase())) continue;
    if (!agents.has(toAgent.toLowerCase())) continue;
    handoffs.set(span.spanId, { fromAgent, toAgent });
  }
  return handoffs;
};
