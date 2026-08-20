import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ObservedEdge } from '@orchescope/schema';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson } from '../src/otlp.ts';
import { deriveTopology } from '../src/topology.ts';

/**
 * What LangChain's spans mean to this build.
 *
 * The spans below are copied from the stored run of the pinned `open-deep-research` checkout, the first
 * LangGraph application this build measured. Identifiers, names, nesting and the shape of every attribute
 * are the instrumentor's own; the timestamps are rounded and the `metadata` blobs are cut down to the keys
 * read here, because each one also carries a checkpoint namespace, the model settings and the library
 * versions, and nothing asserted below depends on any of them.
 *
 * This dialect has one kind for everything. A compiled graph, a node, a subgraph, a sequence, a lambda and
 * a model wrapper all arrive as `CHAIN`, so the rule that a chain span naming nothing is the
 * instrumentation's own structure declined twenty three of the thirty one spans this run produced and left
 * a model and a tool: none of the nine nodes the run walked, and no observed relation at all.
 *
 * They are held verbatim so that a rename in `openinference-instrumentation-langchain` fails here rather
 * than going quiet, which is the failure this build keeps hitting: an attribute moves, the join stops
 * happening, and every report afterwards names something nothing declared instead of saying it could not
 * tell.
 */

const TRACE = '242ea73a2bb9420347d72e51f45fdc52';

type SpanInput = {
  readonly name: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly start: number;
  readonly end: number;
  readonly attributes: Readonly<Record<string, string>>;
};

const attributeList = (attributes: Readonly<Record<string, string>>) =>
  Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: value } }));

const nanos = (ms: number): string => String(BigInt(ms) * 1_000_000n);

const bundleOf = (spans: readonly SpanInput[]) => {
  const decoded = decodeTraceJson({
    resourceSpans: [
      {
        resource: { attributes: attributeList({ 'service.name': 'open-deep-research-exercised' }) },
        scopeSpans: [
          {
            scope: { name: 'openinference.instrumentation.langchain' },
            spans: spans.map((span) => ({
              traceId: TRACE,
              spanId: span.spanId,
              ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
              name: span.name,
              kind: 1,
              startTimeUnixNano: nanos(span.start),
              endTimeUnixNano: nanos(span.end),
              attributes: attributeList(span.attributes),
              status: { code: 1 },
            })),
          },
        ],
      },
    ],
  });
  return normalizeTraces(decoded, {
    runId: `run_${'0'.repeat(16)}`,
    capturedAt: '2026-08-20T00:00:00.000Z',
    source: 'otlp_http_json',
    maxSpans: 100,
    maxAttributeBytes: 4096,
  }).bundle;
};

/** LangGraph's run metadata, as the instrumentor emits it: one JSON document under one attribute. */
const metadata = (node: string, step: number): string =>
  JSON.stringify({ ls_integration: 'langgraph', langgraph_step: step, langgraph_node: node });

const chain = (
  name: string,
  spanId: string,
  parentSpanId: string | undefined,
  start: number,
  end: number,
  node: string | undefined,
  step: number,
): SpanInput => ({
  name,
  spanId,
  ...(parentSpanId === undefined ? {} : { parentSpanId }),
  start,
  end,
  attributes: {
    'openinference.span.kind': 'CHAIN',
    ...(node === undefined ? {} : { metadata: metadata(node, step) }),
  },
});

/**
 * The compiled graph the application invoked. It is the only chain span in the run carrying no metadata
 * at all: `LangGraph` is the instrumentor's label for a pregel loop and names nothing the repository
 * declares, so this span is the one that has to keep declining.
 */
const ROOT = chain('LangGraph', 'ccc067df3e08af58', undefined, 0, 21846, undefined, 0);

/** A node that routed on its own without calling anything. */
const CLARIFY = chain(
  'clarify_with_user',
  '79cf5eae8eaa2b2c',
  ROOT.spanId,
  2,
  2,
  'clarify_with_user',
  1,
);

/** A node, and the three runnables it built inside itself, each stamped with the same node name. */
const BRIEF = chain(
  'write_research_brief',
  'aef3b71af9e3bfd0',
  ROOT.spanId,
  3,
  2431,
  'write_research_brief',
  2,
);
const BRIEF_CONFIGURABLE = chain(
  '_ConfigurableModel',
  'c42825f37d4db921',
  BRIEF.spanId,
  5,
  2430,
  'write_research_brief',
  2,
);
const BRIEF_SEQUENCE = chain(
  'RunnableSequence',
  'b3d721a0bef0795c',
  BRIEF_CONFIGURABLE.spanId,
  802,
  2429,
  'write_research_brief',
  2,
);
const BRIEF_LAMBDA = chain(
  'RunnableLambda',
  'c929412289f3190c',
  BRIEF_SEQUENCE.spanId,
  2428,
  2429,
  'write_research_brief',
  2,
);

/** The model call under all three of them, which carries the node it ran in and is not that node. */
const BRIEF_MODEL: SpanInput = {
  name: 'ChatOpenAI',
  spanId: 'd7f6a28e9c5e94c7',
  parentSpanId: BRIEF_SEQUENCE.spanId,
  start: 803,
  end: 2427,
  attributes: {
    'llm.model_name': 'gpt-4.1-mini-2025-04-14',
    'llm.provider': 'openai',
    'llm.token_count.completion': '100',
    'llm.token_count.prompt': '469',
    metadata: metadata('write_research_brief', 2),
    'openinference.span.kind': 'LLM',
  },
};

/**
 * A node whose implementation is a subgraph. The instrumentor opens the node's span and then the
 * subgraph's own pregel span beneath it, and the second is labelled `LangGraph` while carrying the
 * enclosing node's name, which is why a chain span is only read as the node it is named after.
 */
const SUPERVISOR_GRAPH = chain(
  'research_supervisor',
  '8be6e6da9ed48c97',
  ROOT.spanId,
  2432,
  14916,
  'research_supervisor',
  3,
);
const SUPERVISOR_PREGEL = chain(
  'LangGraph',
  '5f94b185664782f9',
  SUPERVISOR_GRAPH.spanId,
  2432,
  14916,
  'research_supervisor',
  3,
);
const SUPERVISOR = chain(
  'supervisor',
  'c8ca1d0b82be0352',
  SUPERVISOR_PREGEL.spanId,
  2433,
  4430,
  'supervisor',
  1,
);
const SUPERVISOR_TOOLS = chain(
  'supervisor_tools',
  '73ea6341eb4572c7',
  SUPERVISOR_PREGEL.spanId,
  6451,
  11973,
  'supervisor_tools',
  4,
);

/** The second subgraph, one level deeper, and the tool the run actually called. */
const RESEARCHER_PREGEL = chain(
  'LangGraph',
  '37ad9c1ac1470d61',
  SUPERVISOR_TOOLS.spanId,
  6452,
  11973,
  'supervisor_tools',
  4,
);
const RESEARCHER_TOOLS = chain(
  'researcher_tools',
  '9328bf570b876f07',
  RESEARCHER_PREGEL.spanId,
  8405,
  8408,
  'researcher_tools',
  2,
);
const THINK_TOOL: SpanInput = {
  name: 'think_tool',
  spanId: '4336ddb236a373f0',
  parentSpanId: RESEARCHER_TOOLS.spanId,
  start: 8408,
  end: 8408,
  attributes: {
    'input.value': '{"reflection":"The user wants one paragraph."}',
    metadata: metadata('researcher_tools', 2),
    'openinference.span.kind': 'TOOL',
    'tool.name': 'think_tool',
  },
};

const RECORDED_RUN: readonly SpanInput[] = [
  ROOT,
  CLARIFY,
  BRIEF,
  BRIEF_CONFIGURABLE,
  BRIEF_SEQUENCE,
  BRIEF_MODEL,
  BRIEF_LAMBDA,
  SUPERVISOR_GRAPH,
  SUPERVISOR_PREGEL,
  SUPERVISOR,
  SUPERVISOR_TOOLS,
  RESEARCHER_PREGEL,
  RESEARCHER_TOOLS,
  THINK_TOOL,
];

const describeEdge = (edge: ObservedEdge): string =>
  `${edge.kind} ${edge.fromKind}:${edge.fromObservedName} -> ${edge.toKind}:${edge.toObservedName}`;

const componentsOf = (spans: readonly SpanInput[]): readonly string[] =>
  deriveTopology(bundleOf(spans)).topology.components.map(
    (component) => `${component.kind}:${component.observedName}`,
  );

describe('a chain span that names a node of the application graph', () => {
  it('reports the node the metadata names, which the chain kind alone could not', () => {
    assert.deepEqual(componentsOf(RECORDED_RUN), [
      'agent:clarify_with_user',
      'agent:write_research_brief',
      'model:openai/gpt-4.1-mini-2025-04-14',
      'agent:research_supervisor',
      'agent:supervisor',
      'agent:supervisor_tools',
      'agent:researcher_tools',
      'tool:think_tool',
    ]);
  });

  it('reads the node as an agent, which is what the adapter reading add_node declares', () => {
    // The chain kind decides an operation of `invoke_workflow`, and a workflow is an agent group. Both
    // ends of the join have to be named by the same authority for the join to happen at all, and the
    // authority here is the application's own graph: `langgraph_node` and `add_node` carry one name.
    const topology = deriveTopology(bundleOf(RECORDED_RUN)).topology;
    const node = topology.components.find(
      (component) => component.observedName === 'research_supervisor',
    );
    assert.equal(node?.kind, 'agent');
  });

  it('counts the node once however many runnables it built inside itself', () => {
    // Every span inside a node carries the same `langgraph_node`, because the attribute names the node
    // the work happened in rather than the work. Reading it off all of them reports this node as having
    // run four times, and an inflated sample size is worse than a missing component.
    const topology = deriveTopology(bundleOf(RECORDED_RUN)).topology;
    const brief = topology.components.find(
      (component) => component.observedName === 'write_research_brief',
    );
    assert.equal(brief?.spanCount, 1);
  });

  it('leaves what ran inside a node attached to that node', () => {
    const edges = deriveTopology(bundleOf(RECORDED_RUN)).topology.edges.map(describeEdge);
    // Three chain spans stand between the node and its model call, and two between a node and its tool.
    assert.ok(
      edges.includes(
        'invokes_model agent:write_research_brief -> model:openai/gpt-4.1-mini-2025-04-14',
      ),
      edges.join('\n'),
    );
    assert.ok(
      edges.includes('calls_tool agent:researcher_tools -> tool:think_tool'),
      edges.join('\n'),
    );
    assert.ok(
      edges.includes('hands_off_to agent:research_supervisor -> agent:supervisor'),
      edges.join('\n'),
    );
  });

  it('calls a subgraph nested in the node that runs it a handoff, which is the decision', () => {
    // A node whose implementation is a subgraph nests that subgraph's nodes inside itself, so an agent
    // span contains another agent span, and a nesting between two agents is a handoff. That reading is
    // kept here rather than narrowed to containment: the declared `contains` runs from a graph to its
    // nodes, so a relation between two nodes joins neither way, and calling it containment would trade
    // five relations a reader can question for five a reader cannot see. What the trace shows is that
    // one node's work happened inside another's, and this dialect cannot show whether that is a node
    // delegating to a peer or a node built out of one.
    const edges = deriveTopology(bundleOf(RECORDED_RUN)).topology.edges.map(describeEdge);
    assert.deepEqual(
      edges.filter((edge) => edge.startsWith('hands_off_to')),
      [
        'hands_off_to agent:research_supervisor -> agent:supervisor',
        'hands_off_to agent:research_supervisor -> agent:supervisor_tools',
        'hands_off_to agent:supervisor_tools -> agent:researcher_tools',
      ],
    );
  });

  it('says how many spans it declined and why, rather than declining quietly', () => {
    // The compiled graph, the two subgraph loops, and the three runnables inside one node.
    assert.deepEqual(deriveTopology(bundleOf(RECORDED_RUN)).topology.unattributed, [
      { reason: 'no_name', count: 6 },
    ]);
  });
});

describe('a chain span that names no node', () => {
  it('declines a compiled graph, whose span name is the instrumentor label', () => {
    assert.deepEqual(componentsOf([ROOT]), []);
  });

  it('declines a chain span whose metadata says nothing about a node', () => {
    const foreign = {
      ...ROOT,
      attributes: {
        'openinference.span.kind': 'CHAIN',
        metadata: JSON.stringify({ ls_integration: 'langchain_chat_model' }),
      },
    };
    assert.deepEqual(componentsOf([foreign]), []);
  });

  it('declines a metadata blob the attribute ceiling truncated, rather than reading half of it', () => {
    const truncated = {
      ...ROOT,
      name: 'clarify_with_user',
      attributes: {
        'openinference.span.kind': 'CHAIN',
        metadata: '{"langgraph_node": "clarify_with_us[truncated]',
      },
    };
    assert.deepEqual(componentsOf([truncated]), []);
  });

  it('keeps reading a workflow that names itself, which is the other dialect', () => {
    const named = {
      ...ROOT,
      attributes: {
        'openinference.span.kind': 'CHAIN',
        'gen_ai.workflow.name': 'deep researcher',
      },
    };
    assert.deepEqual(componentsOf([named]), ['agent_group:deep researcher']);
  });
});

describe('a span of another kind that carries the node it ran in', () => {
  it('is what its own kind says it is, not the node named beside it', () => {
    // `langgraph_node` is on every span beneath the node, model calls and tool calls included. A model
    // span read through it would report the node twice and lose the model.
    assert.deepEqual(componentsOf([BRIEF_MODEL]), ['model:openai/gpt-4.1-mini-2025-04-14']);
    assert.deepEqual(componentsOf([THINK_TOOL]), ['tool:think_tool']);
  });
});

describe('the provider a span names', () => {
  it('reads llm.system, which is the only provider this instrumentor writes on some spans', () => {
    // The OpenAI Agents instrumentor writes `llm.system` and no `llm.provider`, so a model that run
    // reported was named without the provider serving it while every declared model carried one.
    const spoken = {
      ...BRIEF_MODEL,
      attributes: {
        'llm.model_name': 'gpt-5.2-2025-12-11',
        'llm.system': 'openai',
        'openinference.span.kind': 'LLM',
      },
    };
    assert.deepEqual(componentsOf([spoken]), ['model:openai/gpt-5.2-2025-12-11']);
  });

  it('prefers the host over the API it speaks, where a span names both', () => {
    const hosted = {
      ...BRIEF_MODEL,
      attributes: {
        'llm.model_name': 'gpt-4.1-mini-2025-04-14',
        'llm.provider': 'azure',
        'llm.system': 'openai',
        'openinference.span.kind': 'LLM',
      },
    };
    assert.deepEqual(componentsOf([hosted]), ['model:azure/gpt-4.1-mini-2025-04-14']);
  });
});
