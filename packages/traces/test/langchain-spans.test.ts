import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ObservedEdge } from '@orchescope/schema';
import { normalizeTraces } from '../src/normalize.ts';
import { decodeTraceJson } from '../src/otlp.ts';
import { deriveTopology } from '../src/topology.ts';

/**
 * What LangChain's spans mean to this build.
 *
 * The spans below are copied from two stored runs: the pinned `open-deep-research` checkout, which is the
 * first LangGraph application this build measured, and the pinned `memory-agent-js` checkout, which is the
 * first one in JavaScript. Identifiers, names, nesting and the shape of every attribute are each
 * instrumentor's own; the timestamps are rounded and the `metadata` blobs are cut down to the keys read
 * here, because each one also carries a checkpoint namespace, the model settings and the library versions,
 * and nothing asserted below depends on any of them.
 *
 * This dialect has one kind for everything. A compiled graph, a node, a subgraph, a sequence, a lambda and
 * a model wrapper all arrive as `CHAIN`, so the rule that a chain span naming nothing is the
 * instrumentation's own structure declined twenty three of the thirty one spans the Python run produced and
 * left a model and a tool: none of the nine nodes the run walked, and no observed relation at all.
 *
 * Both runs are here because the two instrumentors are two programs, and everything this build reads out of
 * this dialect was argued from the first of them. They agree about the shape that carries the join and
 * disagree about what else gets a span, which is the whole reason for measuring the second.
 *
 * They are held verbatim so that a rename in either `openinference-instrumentation-langchain` fails here
 * rather than going quiet, which is the failure this build keeps hitting: an attribute moves, the join stops
 * happening, and every report afterwards names something nothing declared instead of saying it could not
 * tell.
 */

/** The run a set of spans came out of, so a bundle carries the service and the trace that produced it. */
type Run = { readonly service: string; readonly trace: string };

const PYTHON_RUN: Run = {
  service: 'open-deep-research-exercised',
  trace: '242ea73a2bb9420347d72e51f45fdc52',
};

const JAVASCRIPT_RUN: Run = {
  service: 'memory-agent-js-exercised',
  trace: 'bcc135e8df4c58c9788f6a369057fa6f',
};

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

const bundleOf = (spans: readonly SpanInput[], run: Run = PYTHON_RUN) => {
  const decoded = decodeTraceJson({
    resourceSpans: [
      {
        resource: { attributes: attributeList({ 'service.name': run.service }) },
        scopeSpans: [
          {
            scope: { name: 'openinference.instrumentation.langchain' },
            spans: spans.map((span) => ({
              traceId: run.trace,
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

const componentsOf = (spans: readonly SpanInput[], run: Run = PYTHON_RUN): readonly string[] =>
  deriveTopology(bundleOf(spans, run)).topology.components.map(
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
    const evidence = deriveTopology(bundleOf([hosted])).evidence.find(
      (record) => record.kind === 'span',
    );
    assert.equal(evidence?.kind, 'span');
    if (evidence?.kind === 'span') {
      assert.deepEqual(evidence.observedComponent, {
        kind: 'model',
        observedName: 'azure/gpt-4.1-mini-2025-04-14',
      });
      assert.equal(evidence.attribute, 'llm.model_name');
      assert.equal(evidence.attributeValue, 'gpt-4.1-mini-2025-04-14');
    }
  });
});

/**
 * The JavaScript instrumentor's spans, from the stored run of the pinned `memory-agent-js` checkout.
 *
 * Two nodes, one tool between them, and sixteen spans. The node spans are siblings under the compiled
 * graph rather than nested in whichever node routed to them, which is how LangGraph runs a pregel step and
 * is why neither relation this application declares between its own nodes can be joined by a run of it.
 */
const AGENT_ROOT = chain('MemoryAgent', '4fd7288107597002', undefined, 0, 2807, undefined, 0);

/**
 * The span the Python instrumentor does not open. `__start__` is the name LangGraph keeps for the entry of
 * a graph, `addNode` rejects it in both ecosystems, and it arrives here named after itself and carrying
 * itself in `langgraph_node`, which is exactly the shape a node's own span has.
 */
const ENTRY = chain('__start__', 'ab7672870a808263', AGENT_ROOT.spanId, 7, 14, '__start__', 0);
const ENTRY_WRITE = chain(
  'ChannelWrite<...>',
  'e74bf68d019fb1d8',
  ENTRY.spanId,
  8,
  13,
  '__start__',
  0,
);
const ENTRY_ROUTE = chain(
  'ChannelWrite<branch:to:call_model>',
  'ac6568953bc86b2c',
  ENTRY.spanId,
  15,
  15,
  '__start__',
  0,
);

/** The first turn: the node, the model it called, and the two runnables LangGraph builds inside every node. */
const FIRST_TURN = chain(
  'call_model',
  '3176e54d53dd92b2',
  AGENT_ROOT.spanId,
  16,
  1732,
  'call_model',
  1,
);
const FIRST_MODEL: SpanInput = {
  name: 'ChatOpenAI',
  spanId: '844aafcdafe056f0',
  parentSpanId: FIRST_TURN.spanId,
  start: 215,
  end: 1729,
  attributes: {
    'llm.model_name': 'gpt-4o-mini',
    'llm.token_count.completion': '39',
    'llm.token_count.prompt': '219',
    metadata: metadata('call_model', 1),
    'openinference.span.kind': 'LLM',
  },
};
const FIRST_WRITE = chain(
  'ChannelWrite<...>',
  'f14734ea8f8534cc',
  FIRST_TURN.spanId,
  1730,
  1730,
  'call_model',
  1,
);
const FIRST_BRANCH = chain(
  'Branch<call_model,store_memory,__end__>',
  'c9943b6e518e222f',
  FIRST_TURN.spanId,
  1732,
  1732,
  'call_model',
  1,
);

/** The node the model routed to, and the application's own tool underneath it. */
const STORE = chain(
  'store_memory',
  '53604d96cef08798',
  AGENT_ROOT.spanId,
  1734,
  1736,
  'store_memory',
  2,
);
const UPSERT: SpanInput = {
  name: 'upsertMemory',
  spanId: 'fe6458c7d44373c9',
  parentSpanId: STORE.spanId,
  start: 1735,
  end: 1735,
  attributes: {
    metadata: metadata('store_memory', 2),
    'openinference.span.kind': 'TOOL',
    'tool.name': 'upsertMemory',
  },
};
const STORE_WRITE = chain(
  'ChannelWrite<...>',
  '7355b2b25c4867f6',
  STORE.spanId,
  1736,
  1736,
  'store_memory',
  2,
);
const STORE_ROUTE = chain(
  'ChannelWrite<branch:to:call_model>',
  '4bf080c9d978779d',
  STORE.spanId,
  1736,
  1736,
  'store_memory',
  2,
);

/** The same node again, which is what makes its sample size two rather than one. */
const SECOND_TURN = chain(
  'call_model',
  '8f24e03bd1258f0e',
  AGENT_ROOT.spanId,
  1737,
  2798,
  'call_model',
  3,
);
const SECOND_MODEL: SpanInput = {
  name: 'ChatOpenAI',
  spanId: '5a67dc08f0bf2ef7',
  parentSpanId: SECOND_TURN.spanId,
  start: 1738,
  end: 2796,
  attributes: {
    'llm.model_name': 'gpt-4o-mini',
    'llm.token_count.completion': '34',
    'llm.token_count.prompt': '359',
    metadata: metadata('call_model', 3),
    'openinference.span.kind': 'LLM',
  },
};
const SECOND_WRITE = chain(
  'ChannelWrite<...>',
  '4ffaa9ba2672c4ab',
  SECOND_TURN.spanId,
  2797,
  2797,
  'call_model',
  3,
);
const SECOND_BRANCH = chain(
  'Branch<call_model,store_memory,__end__>',
  'f09ed7328abfa6b8',
  SECOND_TURN.spanId,
  2797,
  2797,
  'call_model',
  3,
);

const RECORDED_JAVASCRIPT_RUN: readonly SpanInput[] = [
  ENTRY_WRITE,
  ENTRY_ROUTE,
  ENTRY,
  FIRST_MODEL,
  FIRST_WRITE,
  FIRST_BRANCH,
  FIRST_TURN,
  UPSERT,
  STORE_WRITE,
  STORE_ROUTE,
  STORE,
  SECOND_MODEL,
  SECOND_WRITE,
  SECOND_BRANCH,
  SECOND_TURN,
  AGENT_ROOT,
];

describe('the same dialect from the JavaScript instrumentor', () => {
  it('reads the nodes out of the metadata document, which is the shape that crosses', () => {
    // Everything this build reads out of this dialect was argued from the Python instrumentor's spans. What
    // makes it generalise is that this one writes the same document under the same attribute and names a
    // node's span after the node, so both declared nodes of the application join.
    assert.deepEqual(componentsOf(RECORDED_JAVASCRIPT_RUN, JAVASCRIPT_RUN), [
      'agent:call_model',
      'model:gpt-4o-mini',
      'agent:store_memory',
      'tool:upsertMemory',
    ]);
  });

  it('declines the entry sentinel, which this instrumentor opens a span for and the other does not', () => {
    // `__start__` is named after itself and carries itself in `langgraph_node`, so it has a node span's
    // exact shape. It is LangGraph's own entry rather than a node of the application: `addNode` rejects the
    // name, so nothing in a repository can ever declare it, and reported as a component it arrives as a
    // part of the system that ran undeclared with nothing a reader could do about it.
    assert.ok(!componentsOf(RECORDED_JAVASCRIPT_RUN, JAVASCRIPT_RUN).includes('agent:__start__'));
  });

  it('declines the exit sentinel on the same ground', () => {
    const exit = {
      ...ENTRY,
      name: '__end__',
      attributes: { ...ENTRY.attributes, metadata: metadata('__end__', 4) },
    };
    assert.deepEqual(componentsOf([exit], JAVASCRIPT_RUN), []);
  });

  it('counts a node once per time the graph ran it', () => {
    // `call_model` runs, routes to `store_memory`, and runs again. Two spans, two steps, one component with
    // a sample size of two, which is the number every metric about it is reported against.
    const topology = deriveTopology(bundleOf(RECORDED_JAVASCRIPT_RUN, JAVASCRIPT_RUN)).topology;
    const node = topology.components.find((component) => component.observedName === 'call_model');
    assert.equal(node?.spanCount, 2);
  });

  it('names the model without a provider, because this instrumentor writes neither attribute', () => {
    // The Python instrumentor writes `llm.provider` and the OpenAI Agents one writes `llm.system`. This one
    // writes no provider at all, so the model is named by itself rather than by who serves it, and that is
    // what the span said rather than something this build can infer.
    assert.deepEqual(componentsOf([FIRST_MODEL], JAVASCRIPT_RUN), ['model:gpt-4o-mini']);
  });

  it('attaches what ran inside a node to that node, across the runnables between them', () => {
    const edges = deriveTopology(
      bundleOf(RECORDED_JAVASCRIPT_RUN, JAVASCRIPT_RUN),
    ).topology.edges.map(describeEdge);
    assert.deepEqual(edges, [
      'invokes_model agent:call_model -> model:gpt-4o-mini',
      'calls_tool agent:store_memory -> tool:upsertMemory',
    ]);
  });

  it('says how many spans it declined and why', () => {
    // The compiled graph, the entry sentinel, four channel writes, two branches and the two route writes.
    assert.deepEqual(
      deriveTopology(bundleOf(RECORDED_JAVASCRIPT_RUN, JAVASCRIPT_RUN)).topology.unattributed,
      [{ reason: 'no_name', count: 10 }],
    );
  });
});
