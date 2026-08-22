import type { NormalizedSpan, ObservedValueProvenance } from '@orchescope/schema';
import {
  attributeProvenance,
  componentKindFor,
  GEN_AI,
  MCP,
  OPEN_INFERENCE,
  observedNameFor,
  operationWithProvenance,
  readStringAttribute,
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

/**
 * The keys the JavaScript instrumentor names the two ends with, inside those same two attributes.
 *
 * The two instrumentors of this SDK write the same handoff two ways. The Python one writes the agent
 * names as bare strings and gives the span no tool name at all. The JavaScript one writes
 * `{"from_agent": "Triage Agent"}` and `{"to_agent": "Seat Booking Agent"}` as JSON documents, and names
 * the span's tool `handoff_to_Seat Booking Agent`. Both halves of the reading below therefore missed it,
 * and a transfer of control was reported as a call to a tool nothing declared, which is the defect 0.7.0
 * fixed in the other ecosystem.
 *
 * **A document that names its two ends carries its own evidence, which a bare string does not.** That is
 * why this form is read even where the span names a tool and the bare form is not. A tool name is a
 * repository's to choose, so a bare pair of strings that happen to be agent names says nothing once the
 * span has already said which tool it called; a document whose two keys are `from_agent` and `to_agent`,
 * whose values are both agents this run reported, has said what it is. Both ends still have to be agents
 * the run itself reported, which is the check neither form skips.
 */
const FROM_AGENT = 'from_agent';
const TO_AGENT = 'to_agent';

/** The value of one key of a JSON document, where the attribute holds one and the key is a string. */
const namedIn = (value: string, key: string): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // A bare name is not JSON, and a blob the attribute ceiling truncated is no longer JSON either.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const named = (parsed as Record<string, unknown>)[key];
  return typeof named === 'string' && named.length > 0 ? named : undefined;
};

export type ObservedHandoff = {
  /** The agent that gave up control, as the run named it. */
  readonly fromAgent: string;
  /** The agent that took it. */
  readonly toAgent: string;
  readonly provenance: {
    readonly relation: ObservedValueProvenance;
    readonly from: ObservedValueProvenance;
    readonly to: ObservedValueProvenance;
  };
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

/**
 * The two agents a tool span names, in whichever of the two spellings it used.
 *
 * The documented form is read first and needs no absent tool name, because its keys say what it is. The
 * bare form is read only where the span named no tool, which is the reading argued from the Python
 * instrumentor's spans and the one a repository's own tool could otherwise be mistaken for.
 */
const endsOf = (span: NormalizedSpan): ObservedHandoff | undefined => {
  const input = readStringAttribute(span.attributes, INPUT_VALUE);
  const output = readStringAttribute(span.attributes, OUTPUT_VALUE);
  if (input === undefined || output === undefined) return undefined;
  const documented = {
    fromAgent: namedIn(input.value, FROM_AGENT),
    toAgent: namedIn(output.value, TO_AGENT),
  };
  const operation = operationWithProvenance(span.name, span.attributes).provenance;
  const provenance: ObservedHandoff['provenance'] = {
    relation: {
      attributes: [...new Set([...operation.attributes, input.attribute, output.attribute])],
      spanFields: ['operation'],
    },
    from: attributeProvenance(input.attribute),
    to: attributeProvenance(output.attribute),
  };
  if (documented.fromAgent !== undefined && documented.toAgent !== undefined) {
    return { fromAgent: documented.fromAgent, toAgent: documented.toAgent, provenance };
  }
  const named = readStringAttribute(
    span.attributes,
    GEN_AI.toolName,
    OPEN_INFERENCE.toolName,
    MCP.toolName,
  );
  return named === undefined
    ? { fromAgent: input.value, toAgent: output.value, provenance }
    : undefined;
};

export const recognizeHandoffs = (
  spans: readonly NormalizedSpan[],
): ReadonlyMap<string, ObservedHandoff> => {
  const agents = agentNamesReported(spans);
  const handoffs = new Map<string, ObservedHandoff>();
  for (const span of spans) {
    if (span.operation !== 'execute_tool') continue;
    const ends = endsOf(span);
    if (ends === undefined) continue;
    if (!agents.has(ends.fromAgent.toLowerCase())) continue;
    if (!agents.has(ends.toAgent.toLowerCase())) continue;
    handoffs.set(span.spanId, ends);
  }
  return handoffs;
};
