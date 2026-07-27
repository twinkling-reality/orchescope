import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject, writePythonProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

/**
 * One fixture per supported ecosystem.
 *
 * Support is only claimed for what a test exercises, so each adapter named in the README has a repository here written
 * the way that framework is actually written, and each test asserts the components and relations the adapter promises to
 * find. A framework with no fixture is a framework Orchescope does not claim to understand.
 */

const traversal = {
  maxFileBytes: 512 * 1024,
  maxFiles: 500,
  followSymlinks: false,
  excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  excludePrefixes: [],
};

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (build: (workspace: ReturnType<typeof createTempWorkspace>) => void) => {
  const workspace = createTempWorkspace('orchescope-adapter-');
  workspaces.push(workspace);
  build(workspace);
  const clock = fixedClock(0);
  const handle = createDeadline(60_000, clock.monotonicMs);
  try {
    const result = await discover({
      root: workspace.root,
      projectName: 'fixture',
      orchescopeVersion: '0.1.0',
      clock,
      deadline: handle,
      traversal,
      concurrency: 4,
    });
    return {
      result,
      ids: result.graph.components.map((component) => component.id),
      edges: result.graph.edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`),
      adapters: result.graph.coverage.adapters,
    };
  } finally {
    handle.dispose();
  }
};

describe('LangGraph', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writeNodeProject(workspace, {
      name: 'graph-app',
      dependencies: { '@langchain/langgraph': '^0.4.0' },
    });
    workspace.write(
      'src/graph.ts',
      `import { StateGraph, START, END } from '@langchain/langgraph';

const graph = new StateGraph({ channels: {} });

graph.addNode('planner', planner);
graph.addNode('researcher', researcher);
graph.addNode('writer', writer);

graph.addEdge(START, 'planner');
graph.addEdge('planner', 'researcher');
graph.addConditionalEdges('researcher', route, { enough: 'writer', more: 'researcher' });
graph.addEdge('writer', END);

export const app = graph.compile();
`,
    );
  };

  it('discovers the graph as a group and every registered node as an agent', async () => {
    const { ids, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:langgraph' && entry.status === 'completed',
      ),
      `the langgraph adapter did not apply: ${adapters.map((entry) => `${entry.adapterId}=${entry.status}`).join(', ')}`,
    );
    assert.ok(ids.includes('agent:planner'), `expected agent:planner in ${ids.join(', ')}`);
    assert.ok(ids.includes('agent:researcher'));
    assert.ok(ids.includes('agent:writer'));
    assert.ok(
      ids.some((id) => id.startsWith('agent_group:')),
      'expected the graph itself as a group',
    );
  });

  it('records a declared edge as a handoff and keeps a conditional branch', async () => {
    const { edges } = await scan(build);
    assert.ok(
      edges.includes('hands_off_to:agent:planner->agent:researcher'),
      `expected the planner to researcher edge in ${edges.join(', ')}`,
    );
    assert.ok(
      edges.includes('hands_off_to:agent:researcher->agent:writer'),
      'expected the conditional branch to the writer',
    );
  });

  it('ignores the sentinel nodes, which are not components', async () => {
    const { ids } = await scan(build);
    assert.equal(ids.includes('agent:START'), false);
    assert.equal(ids.includes('agent:END'), false);
  });
});

describe('CrewAI', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'crew-app', dependencies: ['crewai>=0.80'] });
    workspace.write(
      'src/crew.py',
      `from crewai import Agent, Crew, Process

researcher = Agent(
    role="researcher",
    goal="Find the primary sources for a claim.",
    llm="gpt-4o-mini",
)

editor = Agent(
    role="editor",
    goal="Rewrite the draft so it states only what the sources support.",
)

crew = Crew(agents=[researcher, editor], process=Process.sequential)
`,
    );
    workspace.write(
      'config/agents.yaml',
      `planner:
  role: planner
  goal: Break the request into steps a worker can take.
  llm: gpt-4o-mini
reviewer:
  role: reviewer
  goal: Check the plan against the request.
`,
    );
  };

  it('discovers agents from source and from the configuration file', async () => {
    const { ids, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:crewai' && entry.status === 'completed',
      ),
      'the crewai adapter did not apply',
    );
    assert.ok(ids.includes('agent:researcher'), `expected agent:researcher in ${ids.join(', ')}`);
    assert.ok(ids.includes('agent:editor'));
    assert.ok(ids.includes('agent:planner'), 'expected the agent declared in agents.yaml');
    assert.ok(ids.includes('agent:reviewer'));
  });

  it('discovers the crew as a group that contains its members', async () => {
    const { ids, edges } = await scan(build);
    assert.ok(
      ids.some((id) => id.startsWith('agent_group:')),
      'expected the crew as a group',
    );
    assert.ok(
      edges.some((edge) => edge.startsWith('contains:agent_group:')),
      `expected containment edges in ${edges.join(', ')}`,
    );
  });

  it('links a configured agent to the model it names', async () => {
    const { ids, edges } = await scan(build);
    assert.ok(
      ids.some((id) => id.startsWith('model:')),
      'expected a model from the llm field',
    );
    assert.ok(
      edges.some((edge) => edge.startsWith('invokes_model:agent:planner->model:')),
      `expected the planner to model edge in ${edges.join(', ')}`,
    );
  });
});

describe('the Vercel AI SDK', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writeNodeProject(workspace, { name: 'ai-app', dependencies: { ai: '^5.0.0' } });
    workspace.write(
      'src/answer.ts',
      `import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';

export const searchDocs = tool({
  description: 'Search the documentation for a phrase and return the matching sections.',
});

export async function answer(question: string) {
  return generateText({
    model: openai('gpt-4o-mini'),
    prompt: question,
    tools: { searchDocs },
    maxSteps: 6,
  });
}
`,
    );
  };

  it('treats the generation call as the agent, because there is no agent object to find', async () => {
    const { ids, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:vercel-ai-sdk' && entry.status === 'completed',
      ),
      'the vercel adapter did not apply',
    );
    assert.ok(ids.includes('agent:answer'), `expected agent:answer in ${ids.join(', ')}`);
    assert.ok(ids.includes('tool:searchdocs'), `expected the declared tool in ${ids.join(', ')}`);
    assert.ok(
      ids.some((id) => id.startsWith('model:')),
      'expected the model named in the call',
    );
  });

  it('records the step ceiling as a bounded retry policy on the model relation', async () => {
    const { result } = await scan(build);
    const modelEdge = result.graph.edges.find((edge) => edge.kind === 'invokes_model');
    assert.ok(modelEdge !== undefined, 'expected a model relation');
    assert.equal(modelEdge.policy?.retry?.maxAttempts, 6);
    assert.equal(modelEdge.policy?.retry?.bounded, true);
    // Nothing in the syntax says the operation is safe to repeat, so the status stays unknown rather than assumed.
    assert.equal(modelEdge.policy?.retry?.idempotency, 'unknown');
  });

  it('links the agent to the tool the call names', async () => {
    const { edges } = await scan(build);
    assert.ok(
      edges.includes('calls_tool:agent:answer->tool:searchdocs'),
      `expected the tool relation in ${edges.join(', ')}`,
    );
  });
});

describe('model SDKs', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writeNodeProject(workspace, {
      name: 'sdk-app',
      dependencies: { openai: '^6.0.0', '@anthropic-ai/sdk': '^0.70.0' },
    });
    workspace.write(
      'src/clients.ts',
      `import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// A gateway in front of the provider is the case a permission scope has to record accurately.
export const routed = new OpenAI({ baseURL: 'https://gateway.internal/v1', timeout: 20000 });

export const direct = new Anthropic();

export async function answer(prompt: string) {
  return routed.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] });
}
`,
    );
  };

  it('discovers a provider per client, and the model each call names', async () => {
    const { ids, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:model-sdk' && entry.status === 'completed',
      ),
      'the model sdk adapter did not apply',
    );
    assert.ok(ids.includes('provider:openai'), `expected provider:openai in ${ids.join(', ')}`);
    assert.ok(ids.includes('provider:anthropic'));
    assert.ok(
      ids.includes('model:openai/gpt-4o-mini'),
      `expected the model named in the call, in ${ids.join(', ')}`,
    );
  });

  it('records a base URL override as the network scope, not the provider name', async () => {
    const { result } = await scan(build);
    const openai = result.graph.components.find((component) => component.id === 'provider:openai');
    assert.ok(openai !== undefined);
    assert.equal(openai.metadata['baseUrl'], 'https://gateway.internal/v1');
    assert.equal(openai.metadata['timeoutMs'], 20000);
    assert.deepEqual(openai.permissions, [
      { kind: 'network', scope: 'https://gateway.internal/v1', mode: 'write' },
    ]);
  });

  it('records a client with no override against the provider itself', async () => {
    const { result } = await scan(build);
    const anthropic = result.graph.components.find(
      (component) => component.id === 'provider:anthropic',
    );
    assert.equal(anthropic?.permissions[0]?.scope, 'anthropic');
  });
});

/**
 * LangGraph in Python.
 *
 * The fixture is written the way the library's own documentation writes it: `add_node(fn)` takes the function's
 * name as the node name, `add_node("name", fn)` names it explicitly, `add_edge` takes two node names, and
 * `add_conditional_edges` takes a source, a router and a mapping of branch to destination.
 */
describe('LangGraph in Python', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'graph-py', dependencies: ['langgraph>=0.2'] });
    workspace.write(
      'src/graph.py',
      `from typing_extensions import TypedDict
from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    question: str


def plan(state: State) -> State:
    return state


def research(state: State) -> State:
    return state


def write_answer(state: State) -> State:
    return state


def route(state: State) -> str:
    return "enough" if state["question"] else "more"


builder = StateGraph(State)
builder.add_node(plan)
builder.add_node("researcher", research)
builder.add_node("writer", write_answer)

builder.add_edge(START, "plan")
builder.add_edge("plan", "researcher")
builder.add_conditional_edges("researcher", route, {"enough": "writer", "more": "plan"})
builder.add_edge("writer", END)

graph = builder.compile()
`,
    );
  };

  it('discovers the graph as a group and every registered node as an agent', async () => {
    const { ids, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:langgraph' && entry.status === 'completed',
      ),
      `the langgraph adapter did not apply: ${adapters.map((entry) => `${entry.adapterId}=${entry.status}`).join(', ')}`,
    );
    assert.ok(
      ids.includes('agent:researcher'),
      `expected the explicitly named node in ${ids.join(', ')}`,
    );
    assert.ok(ids.includes('agent:writer'));
    assert.ok(
      ids.some((id) => id.startsWith('agent_group:')),
      'expected the graph itself as a group',
    );
  });

  it('takes the function name when the node is added without one', async () => {
    const { ids } = await scan(build);
    assert.ok(
      ids.includes('agent:plan'),
      `add_node(plan) should register a node called plan, saw ${ids.join(', ')}`,
    );
  });

  it('records a declared edge as a handoff and keeps a conditional branch', async () => {
    const { edges } = await scan(build);
    assert.ok(
      edges.includes('hands_off_to:agent:plan->agent:researcher'),
      `expected the plan to researcher edge in ${edges.join(', ')}`,
    );
    assert.ok(
      edges.includes('hands_off_to:agent:researcher->agent:writer'),
      'expected the conditional branch to the writer',
    );
    assert.ok(
      edges.includes('hands_off_to:agent:researcher->agent:plan'),
      'expected the other conditional branch',
    );
  });

  it('models the sentinels as neither nodes nor relations', async () => {
    const { ids, edges } = await scan(build);
    assert.equal(ids.includes('agent:START'), false);
    assert.equal(ids.includes('agent:END'), false);
    assert.equal(
      edges.some((edge) => edge.includes('START') || edge.includes('END')),
      false,
      `a sentinel became a relation in ${edges.join(', ')}`,
    );
  });
});

/**
 * The OpenAI Agents SDK in Python.
 *
 * Keyword arguments, the `@function_tool` decorator with and without an override, an MCP server whose command
 * is nested inside `params`, and a handoff that names the variable rather than the declared agent name. Every
 * shape here is taken from the SDK's own examples and dataclass fields.
 */
describe('the OpenAI Agents SDK in Python', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'desk-py', dependencies: ['openai-agents>=0.4'] });
    workspace.write(
      'src/desk.py',
      `from agents import Agent, function_tool
from agents.mcp import MCPServerStdio


@function_tool
def lookup_order(order_id: str) -> str:
    """Read the order record for a customer."""
    return order_id


@function_tool(name_override="issue_refund", needs_approval=True)
def refund(order_id: str) -> str:
    """Refund a charge."""
    return order_id


filesystem = MCPServerStdio(
    name="filesystem",
    params={"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]},
)

refunds_agent = Agent(
    name="refunds",
    instructions="Issue a refund when the order qualifies, and never twice for one request.",
    model="gpt-4.1-mini",
    tools=[lookup_order, refund],
)

triage_agent = Agent(
    name="triage",
    instructions="Route the request to the right worker and answer briefly.",
    model="gpt-4.1-mini",
    handoffs=[refunds_agent],
    mcp_servers=[filesystem],
)
`,
    );
  };

  it('discovers the agents, the model they name, and the tools', async () => {
    const { ids, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:openai-agents' && entry.status === 'completed',
      ),
      `the openai agents adapter did not apply: ${adapters.map((entry) => `${entry.adapterId}=${entry.status}`).join(', ')}`,
    );
    assert.ok(ids.includes('agent:triage'), `expected agent:triage in ${ids.join(', ')}`);
    assert.ok(ids.includes('agent:refunds'));
    // The model is named as a bare string here, so no provider is claimed: `model:gpt-4.1-mini`, not
    // `model:openai/gpt-4.1-mini`, which is what a call through a provider factory would produce.
    assert.ok(ids.includes('model:gpt-4.1-mini'), `expected the named model in ${ids.join(', ')}`);
    assert.equal(
      ids.some((id) => id.startsWith('provider:')),
      false,
      'nothing here named a provider, so none should be claimed',
    );
    assert.ok(ids.includes('tool:lookup_order'), 'expected the bare decorated tool');
    assert.ok(ids.includes('tool:issue_refund'), 'expected the overridden tool name');
  });

  it('resolves a handoff that names the variable rather than the declared name', async () => {
    const { edges } = await scan(build);
    assert.ok(
      edges.includes('hands_off_to:agent:triage->agent:refunds'),
      `expected the handoff in ${edges.join(', ')}`,
    );
  });

  it('links each agent to the model and each tool to the agent that holds it', async () => {
    const { edges } = await scan(build);
    assert.ok(edges.includes('invokes_model:agent:triage->model:gpt-4.1-mini'));
    assert.ok(edges.includes('calls_tool:agent:refunds->tool:lookup_order'));
    assert.ok(edges.includes('calls_tool:agent:refunds->tool:issue_refund'));
  });

  it('reads the MCP server command out of the params mapping', async () => {
    const { result, edges } = await scan(build);
    const server = result.graph.components.find(
      (component) => component.id === 'mcp_server:filesystem',
    );
    assert.ok(server !== undefined, 'the MCP server was not discovered');
    assert.equal(server.details?.for, 'mcp_server');
    assert.equal(
      (server.details as { transport?: string }).transport,
      'stdio',
      'a server configured with a command is a stdio server',
    );
    // The command and its arguments are one invocation, which is what the permission scope has to name.
    const invocation = 'npx -y @modelcontextprotocol/server-filesystem .';
    assert.equal((server.details as { command?: string }).command, invocation);
    assert.deepEqual(server.permissions, [{ kind: 'process', scope: invocation, mode: 'execute' }]);
    assert.ok(
      edges.includes('provides_tool:mcp_server:filesystem->agent:triage'),
      `expected the server to provide tools to the agent, saw ${edges.join(', ')}`,
    );
  });

  it('records that the refund tool needs approval', async () => {
    const { result } = await scan(build);
    const refund = result.graph.components.find(
      (component) => component.id === 'tool:issue_refund',
    );
    assert.equal(
      (refund?.details as { approvalRequired?: boolean } | undefined)?.approvalRequired,
      true,
      'needs_approval on the decorator was not read',
    );
  });
});

/**
 * The LangGraph prebuilt ReAct agent, which is the form the library's own example uses and the form most agents
 * are written in: one call that names the model, the tools and the prompt.
 */
describe('a LangGraph prebuilt agent', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'concierge', dependencies: ['langgraph>=0.2'] });
    workspace.write(
      'src/concierge.py',
      `from langgraph.prebuilt import create_react_agent


def check_weather(location: str) -> str:
    """Return the weather forecast for the specified location."""
    return f"It's always sunny in {location}"


def book_flight(destination: str) -> str:
    """Book a flight to the destination."""
    return destination


concierge = create_react_agent(
    "anthropic:claude-3-7-sonnet-latest",
    tools=[check_weather, book_flight],
    prompt="You are a helpful assistant",
)
`,
    );
  };

  it('discovers the agent, the model, the provider and the tools from one call', async () => {
    const { ids, edges, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:langgraph' && entry.status === 'completed',
      ),
      'the langgraph adapter did not apply',
    );
    assert.ok(ids.includes('agent:concierge'), `expected agent:concierge in ${ids.join(', ')}`);
    assert.ok(ids.includes('model:anthropic/claude-3-7-sonnet-latest'));
    assert.ok(ids.includes('provider:anthropic'));
    assert.ok(ids.includes('tool:check_weather'), 'a function passed as a tool is a tool');
    assert.ok(ids.includes('tool:book_flight'));
    assert.ok(
      edges.includes('invokes_model:agent:concierge->model:anthropic/claude-3-7-sonnet-latest'),
      `expected the model relation in ${edges.join(', ')}`,
    );
    assert.ok(
      edges.includes(
        'served_by_provider:model:anthropic/claude-3-7-sonnet-latest->provider:anthropic',
      ),
    );
    assert.ok(edges.includes('calls_tool:agent:concierge->tool:check_weather'));
    assert.ok(edges.includes('calls_tool:agent:concierge->tool:book_flight'));
  });

  it('points a tool at the function that defines it rather than at the call', async () => {
    const { result } = await scan(build);
    const tool = result.graph.components.find((component) => component.id === 'tool:check_weather');
    assert.equal(tool?.sourceLocations[0]?.file, 'src/concierge.py');
    assert.equal(
      tool?.sourceLocations[0]?.startLine,
      4,
      'the tool should be located where the function is defined',
    );
  });

  it('takes the prompt as the description without claiming it is a separate component', async () => {
    const { ids, result } = await scan(build);
    const agent = result.graph.components.find((component) => component.id === 'agent:concierge');
    assert.equal(agent?.description, 'You are a helpful assistant');
    assert.equal(
      ids.some((id) => id.startsWith('agent_group:')),
      false,
      'a prebuilt agent is one component, not a graph of them',
    );
  });
});

/**
 * Pydantic AI.
 *
 * The model is the first positional argument as `provider:model`, tools are registered by a decorator on the
 * agent itself, and an agent with no `name` is named after the variable it is assigned to, which is what the
 * library does at run time: "if `None`, we try to infer the agent name from the call frame". Every shape here is
 * taken from the project's own README and the `Agent` signature.
 */
describe('Pydantic AI', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writePythonProject(workspace, { name: 'desk-pai', dependencies: ['pydantic-ai>=1.0'] });
    workspace.write(
      'src/support.py',
      `from dataclasses import dataclass

from pydantic import BaseModel
from pydantic_ai import Agent, RunContext


@dataclass
class Deps:
    customer_id: int


class SupportOutput(BaseModel):
    advice: str
    block_card: bool


support_agent = Agent(
    'openai:gpt-4.1-mini',
    deps_type=Deps,
    output_type=SupportOutput,
    instructions='Answer the customer and judge the risk of the request.',
    retries=2,
)

triage_agent = Agent(
    'anthropic:claude-sonnet-4-6',
    name='triage',
    instructions='Route the request to the right worker.',
)


@support_agent.instructions
async def add_customer_name(ctx: RunContext[Deps]) -> str:
    return f"The customer is {ctx.deps.customer_id}"


@support_agent.tool
async def customer_balance(ctx: RunContext[Deps], include_pending: bool) -> float:
    """Return the customer's current account balance."""
    return 0.0


@support_agent.tool(retries=3, requires_approval=True)
async def issue_refund(ctx: RunContext[Deps], order_id: str) -> str:
    """Refund a charge against the payment gateway."""
    return order_id


@triage_agent.tool_plain
def business_hours() -> str:
    """Return the hours support is staffed."""
    return "09:00 to 17:00"
`,
    );
  };

  it('discovers an agent under its declared name and under the variable when it has none', async () => {
    const { ids, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:pydantic-ai' && entry.status === 'completed',
      ),
      `the pydantic ai adapter did not apply: ${adapters.map((entry) => `${entry.adapterId}=${entry.status}`).join(', ')}`,
    );
    assert.ok(ids.includes('agent:triage'), `expected the declared name in ${ids.join(', ')}`);
    assert.ok(
      ids.includes('agent:support_agent'),
      'an agent with no name is named after its variable, which is what the library infers',
    );
  });

  it('splits the model string into the provider and the model it names', async () => {
    const { ids, edges } = await scan(build);
    assert.ok(ids.includes('provider:openai'), `expected provider:openai in ${ids.join(', ')}`);
    assert.ok(ids.includes('provider:anthropic'));
    assert.ok(ids.includes('model:openai/gpt-4.1-mini'));
    assert.ok(ids.includes('model:anthropic/claude-sonnet-4-6'));
    assert.ok(
      edges.includes('served_by_provider:model:openai/gpt-4.1-mini->provider:openai'),
      `expected the model to name its provider in ${edges.join(', ')}`,
    );
    assert.ok(edges.includes('invokes_model:agent:support_agent->model:openai/gpt-4.1-mini'));
    assert.ok(edges.includes('invokes_model:agent:triage->model:anthropic/claude-sonnet-4-6'));
  });

  it('attributes a decorated tool to the agent the decorator names', async () => {
    const { ids, edges } = await scan(build);
    assert.ok(ids.includes('tool:customer_balance'));
    assert.ok(ids.includes('tool:issue_refund'));
    assert.ok(ids.includes('tool:business_hours'), 'expected the tool_plain decorator to register');
    assert.ok(
      edges.includes('calls_tool:agent:support_agent->tool:customer_balance'),
      `expected the tool relation in ${edges.join(', ')}`,
    );
    assert.ok(edges.includes('calls_tool:agent:support_agent->tool:issue_refund'));
    assert.ok(
      edges.includes('calls_tool:agent:triage->tool:business_hours'),
      'a tool_plain decorator belongs to the agent it was declared on',
    );
  });

  it('records the retry ceiling on the relation and never claims the effect is safe to repeat', async () => {
    const { result } = await scan(build);
    const edge = result.graph.edges.find(
      (candidate) =>
        candidate.kind === 'calls_tool' &&
        candidate.from === 'agent:support_agent' &&
        candidate.to === 'tool:issue_refund',
    );
    assert.ok(edge !== undefined, 'the refund relation was not discovered');
    assert.deepEqual(edge.policy?.retry, {
      maxAttempts: 3,
      bounded: true,
      backoff: 'unknown',
      idempotency: 'unknown',
    });
  });

  it('records that the refund tool requires approval', async () => {
    const { result } = await scan(build);
    const refund = result.graph.components.find(
      (component) => component.id === 'tool:issue_refund',
    );
    assert.equal(
      (refund?.details as { approvalRequired?: boolean } | undefined)?.approvalRequired,
      true,
    );
  });

  it('cites a source location and the framework for everything it adds', async () => {
    const { result } = await scan(build);
    const own = result.graph.components.filter((component) =>
      component.discoveredBy.includes('adapter:pydantic-ai'),
    );
    assert.ok(own.length >= 5, `expected several components, saw ${own.length}`);
    for (const component of own) {
      assert.equal(component.basis, 'discovered');
      assert.ok(component.evidence.length > 0, `${component.id} carries no evidence`);
      const cited = result.evidence.filter((record) => component.evidence.includes(record.id));
      assert.ok(
        cited.some((record) => record.kind === 'source_span'),
        `${component.id} is not backed by a source span`,
      );
    }
    const agent = result.graph.components.find((c) => c.id === 'agent:support_agent');
    assert.equal((agent?.details as { framework?: string } | undefined)?.framework, 'pydantic-ai');
    assert.equal(agent?.metadata['outputType'], 'SupportOutput');
  });

  it('stays quiet in a project that does not use it', async () => {
    const { adapters } = await scan((workspace) => {
      writePythonProject(workspace, { name: 'plain-py', dependencies: ['requests'] });
      workspace.write('src/plain.py', 'def add(a: int, b: int) -> int:\n    return a + b\n');
    });
    assert.equal(
      adapters.find((entry) => entry.adapterId === 'adapter:pydantic-ai')?.status,
      'not_applicable',
    );
  });
});

describe('the manifest', () => {
  const manifest = [
    'schemaVersion: 1',
    'components:',
    '  - kind: agent',
    '    name: orchestrator',
    '    runtimeName: orchestrator',
    '    definedIn: src/orchestrator.rb',
    '    definedAtLine: 12',
    '  - kind: tool',
    '    name: issue_refund',
    '    sideEffect: financial',
    'edges:',
    '  - kind: calls_tool',
    '    from: orchestrator',
    '    to: issue_refund',
    '    policy:',
    '      retry:',
    '        maxAttempts: 3',
    '        bounded: true',
    '        backoff: exponential',
    '        idempotency: absent',
    '',
  ].join('\n');

  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    workspace.write('.orchescope/manifest.yaml', manifest);
    workspace.write('src/orchestrator.rb', "puts 'a language this build does not parse'\n");
  };

  it('declares components and relations for a language no adapter parses', async () => {
    const { result, ids, edges, adapters } = await scan(build);
    assert.ok(
      adapters.some(
        (entry) => entry.adapterId === 'adapter:manifest' && entry.status === 'completed',
      ),
      `the manifest adapter did not apply: ${adapters.map((entry) => `${entry.adapterId}=${entry.status}`).join(', ')}`,
    );
    assert.ok(
      ids.includes('agent:orchestrator'),
      `expected the declared agent in ${ids.join(', ')}`,
    );
    assert.ok(ids.includes('tool:issue_refund'));
    assert.ok(
      edges.includes('calls_tool:agent:orchestrator->tool:issue_refund'),
      `expected the declared relation in ${edges.join(', ')}`,
    );
    assert.equal(result.agentSystemDetected, true);
  });

  it('cites the manifest entry as the evidence and never claims observation', async () => {
    const { result } = await scan(build);
    const agent = result.graph.components.find(
      (component) => component.id === 'agent:orchestrator',
    );
    assert.ok(agent !== undefined);
    assert.equal(agent.basis, 'discovered');
    assert.deepEqual(agent.presence, { static: true, runtime: false, manifest: true });
    assert.deepEqual(agent.configLocations, [
      { file: '.orchescope/manifest.yaml', pointer: '/components/0' },
    ]);
    assert.equal(agent.metadata['runtimeName'], 'orchestrator');
    assert.ok(agent.evidence.length > 0, 'the declared component carries no evidence');
    const cited = result.evidence.filter((record) => agent.evidence.includes(record.id));
    assert.equal(cited.length, agent.evidence.length, 'a cited evidence record is missing');
    assert.ok(
      cited.every((record) => record.kind === 'config_entry'),
      `a manifest declaration must be config entry evidence, saw ${cited.map((record) => record.kind).join(', ')}`,
    );
  });

  it('records a rejected manifest as a failed adapter naming the field', async () => {
    const { result, adapters } = await scan((workspace) => {
      workspace.write(
        '.orchescope/manifest.yaml',
        ['schemaVersion: 1', 'components:', '  - kind: tool', 'edges: []', ''].join('\n'),
      );
    });
    const entry = adapters.find((adapter) => adapter.adapterId === 'adapter:manifest');
    assert.equal(entry?.status, 'failed');
    assert.match(entry?.detail ?? '', /is not a valid manifest/);
    assert.match(entry?.detail ?? '', /name/);
    assert.equal(result.agentSystemDetected, false);
  });
});

/**
 * The ceiling of a per framework reader, made visible.
 *
 * A reader taught one form of a framework goes quiet when a repository uses another, and the result is
 * indistinguishable from a repository with no agent system in it. That is the failure this reports: not a
 * missing framework, but a framework this build claims and did not read.
 */
/**
 * A prompt needs a model to reach.
 *
 * The phrasing test alone matches ordinary English: "system", "answer", "never". On a repository that talks to no
 * model, every long string became a component, and one real codebase produced 285 of them.
 */
describe('prompt candidates', () => {
  const literal = `"You are a support assistant. Always answer briefly and never invent an order number."`;

  it('are recorded when the repository has a model for them to reach', async () => {
    const { ids, adapters } = await scan((workspace) => {
      writePythonProject(workspace, { name: 'with-model', dependencies: ['pydantic-ai>=1.0'] });
      workspace.write(
        'src/desk.py',
        `from pydantic_ai import Agent

desk = Agent('openai:gpt-4.1-mini', instructions=${literal})
`,
      );
    });
    assert.ok(
      (adapters.find((entry) => entry.adapterId === 'adapter:prompts')?.componentsFound ?? 0) > 0,
      `expected a prompt in ${ids.join(', ')}`,
    );
  });

  it('are not recorded at all when nothing in the repository talks to a model', async () => {
    const { ids, adapters } = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'no-model' });
      workspace.write(
        'src/copy.ts',
        `export const EMPTY_STATE = ${literal};
export const HELP = "Answer the question in the box. You are never charged for a preview.";
`,
      );
    });
    const prompts = adapters.find((entry) => entry.adapterId === 'adapter:prompts');
    assert.equal(prompts?.componentsFound, 0);
    assert.match(prompts?.detail ?? '', /no model or agent was discovered/);
    assert.equal(
      ids.some((id) => id.startsWith('prompt:')),
      false,
      `no prompt should exist, saw ${ids.join(', ')}`,
    );
  });
});

describe('an adapter that claims a framework and reads nothing from it', () => {
  const blindSpots = (result: Awaited<ReturnType<typeof scan>>) =>
    result.result.graph.coverage.unsupported.filter((area) => area.kind === 'adapter_blind_spot');

  it('reports the framework and the adapter rather than saying nothing was found', async () => {
    // LangGraph's functional API. The adapter reads graphs and prebuilt agents, not `@task` and `@entrypoint`.
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'functional', dependencies: ['langgraph>=0.2'] });
      workspace.write(
        'src/flow.py',
        `from langgraph.func import entrypoint, task


@task
def plan(question: str) -> str:
    return question


@entrypoint()
def workflow(question: str) -> str:
    return plan(question).result()
`,
      );
    });
    assert.equal(result.result.agentSystemDetected, false);
    const areas = blindSpots(result);
    assert.equal(areas.length, 1, `expected one blind spot, saw ${areas.length}`);
    assert.match(areas[0]?.area ?? '', /langgraph/);
    assert.match(areas[0]?.area ?? '', /adapter:langgraph/);
    assert.match(areas[0]?.reason ?? '', /found no component/);
    assert.match(areas[0]?.remediation ?? '', /manifest\.yaml/);
  });

  it('stays quiet when the adapter read the framework successfully', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'read-fine', dependencies: ['langgraph>=0.2'] });
      workspace.write(
        'src/graph.py',
        `from langgraph.graph import StateGraph


def plan(state: dict) -> dict:
    return state


builder = StateGraph(dict)
builder.add_node(plan)
graph = builder.compile()
`,
      );
    });
    assert.deepEqual(blindSpots(result), []);
  });

  it('stays quiet about a framework the repository does not import at all', async () => {
    const result = await scan((workspace) => {
      // The dependency is declared and never imported, which is a stale manifest rather than a blind spot.
      writePythonProject(workspace, { name: 'declared-only', dependencies: ['langgraph>=0.2'] });
      workspace.write('src/plain.py', 'def add(a: int, b: int) -> int:\n    return a + b\n');
    });
    assert.deepEqual(blindSpots(result), []);
  });

  it('never reports an adapter that reads a convention rather than a package', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'conventions', dependencies: ['requests'] });
      workspace.write('src/plain.py', 'import requests\n\n\ndef ping() -> None:\n    pass\n');
    });
    assert.deepEqual(blindSpots(result), []);
  });

  it('does not count a type only import, which cannot construct anything at run time', async () => {
    // Two real repositories carried a blind spot for this: a React component importing a framework's types.
    const result = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'types-only', dependencies: { ai: '4.0.0' } });
      workspace.write(
        'src/message.ts',
        `import type { UIMessage } from 'ai';

export const label = (message: UIMessage): string => message.id;
`,
      );
    });
    assert.deepEqual(
      blindSpots(result),
      [],
      'an erased import is not evidence that a reader is behind',
    );
  });
});

describe('a tool defined in one module and used in another', () => {
  it('is one component, whether the import is relative or rooted at an alias', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'aliased', dependencies: { ai: '^5.0.0' } });
      workspace.write(
        'lib/tools/get-weather.ts',
        `import { tool } from 'ai';

export const getWeather = tool({
  description: 'Get the current weather at a location.',
});
`,
      );
      workspace.write(
        'app/route.ts',
        `import { generateText } from 'ai';
import { getWeather } from '@/lib/tools/get-weather';

export async function answer(question: string) {
  return generateText({ model: 'gpt-4o-mini', prompt: question, tools: { getWeather } });
}
`,
      );
    });
    const weather = result.ids.filter((id) => id.startsWith('tool:getweather'));
    assert.deepEqual(
      weather,
      ['tool:getweather'],
      `the same tool was declared twice, once per module: ${weather.join(', ')}`,
    );
    assert.ok(
      result.edges.some((edge) => edge.endsWith('->tool:getweather')),
      `nothing calls the tool: ${result.edges.join(', ')}`,
    );
  });
});

describe('the Model Context Protocol in Python', () => {
  it('reads a FastMCP server and the tools its decorator registers', async () => {
    // The form the Python SDK documents: a submodule import, a server in a variable, and decorated functions.
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'calculator', dependencies: ['mcp>=1.0'] });
      workspace.write(
        'src/calculator_mcp.py',
        `from mcp.server import FastMCP

mcp = FastMCP("Calculator")


@mcp.tool(name="calculator")
def calculator(number1: float, number2: float, operator: str) -> str:
    return "0"


@mcp.tool()
def describe() -> str:
    return "a calculator"
`,
      );
    });
    assert.ok(
      result.ids.includes('mcp_server:calculator'),
      `no server among ${result.ids.join(', ')}`,
    );
    assert.ok(
      result.ids.includes('tool:calculator'),
      'the name the decorator overrides was not used',
    );
    assert.ok(
      result.ids.includes('tool:describe'),
      'a decorator with no name should take the function name, which is what the library does',
    );
    assert.ok(
      result.edges.includes('provides_tool:mcp_server:calculator->tool:calculator'),
      `the server was not joined to its tool: ${result.edges.join(', ')}`,
    );
    assert.deepEqual(
      result.result.graph.coverage.unsupported.filter((area) => area.kind === 'adapter_blind_spot'),
      [],
    );
  });

  it('does not read a local package that shares a distribution name', async () => {
    // A repository with its own `agents` package is not a repository using the OpenAI Agents SDK.
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'local-agents' });
      workspace.write('agents/__init__.py', '');
      workspace.write(
        'agents/agent.py',
        `class Agent:
    def __init__(self, name: str) -> None:
        self.name = name
`,
      );
      workspace.write(
        'agents/run.py',
        `from agents.agent import Agent

assistant = Agent(name="assistant")
`,
      );
    });
    assert.equal(
      result.result.agentSystemDetected,
      false,
      `a local package was read as a framework: ${result.ids.join(', ')}`,
    );
  });
});

describe('Cloudflare Workers bindings', () => {
  const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
    writeNodeProject(workspace, { name: 'worker-app' });
    // Not at the repository root, because a workspace puts the manifest beside the worker it deploys.
    workspace.write(
      'packages/worker/wrangler.toml',
      `name = "events-worker"
main = "src/index.ts"
compatibility_date = "2024-12-18"

[[kv_namespaces]]
binding = "SESSIONS"
id = "71502609ca734d54a4267176945025c7"

[[d1_databases]]
binding = "EVENTS_DB"
database_name = "app-events"
database_id = "c13a8424-bc2c-486c-8b50-9b8748a88b72"
`,
    );
    workspace.write(
      'packages/worker/src/settings.ts',
      `export const readSettings = async (db: D1Database): Promise<unknown> =>
  db.prepare('SELECT value_json FROM settings WHERE key = ?1').first();
`,
    );
    workspace.write(
      'packages/worker/src/index.ts',
      `import { readSettings } from './settings.ts';

export const overview = async (env: Env): Promise<unknown> => {
  const settings = await readSettings(env.EVENTS_DB);
  const pointer = await listPointers(env.SESSIONS);
  return { settings, pointer };
};
`,
    );
  };

  it('maps the database and the namespace the manifest binds, with the manifest as evidence', async () => {
    const { result, ids } = await scan(build);
    assert.ok(
      ids.includes('database:app-events'),
      `the bound D1 database should be a component, saw ${ids.join(', ')}`,
    );
    assert.ok(
      ids.includes('database:sessions'),
      `the bound KV namespace should be a component, saw ${ids.join(', ')}`,
    );

    const database = result.graph.components.find(
      (component) => component.id === 'database:app-events',
    );
    assert.ok(database !== undefined);
    assert.deepEqual(database.configLocations, [
      { file: 'packages/worker/wrangler.toml', pointer: '/d1_databases/0' },
    ]);
    assert.equal(database.metadata?.['binding'], 'EVENTS_DB');
    assert.equal(database.metadata?.['service'], 'cloudflare-d1');
  });

  it('draws the relation from the code that names the binding', async () => {
    const { edges } = await scan(build);
    assert.ok(
      edges.some((edge) => edge === 'queries_database:entrypoint:overview->database:app-events'),
      `the caller should reach the database, saw ${edges.join(', ')}`,
    );
    assert.ok(
      edges.some((edge) => edge === 'queries_database:entrypoint:overview->database:sessions'),
      `the caller should reach the namespace, saw ${edges.join(', ')}`,
    );
  });

  it('stays quiet on a repository with no such manifest', async () => {
    const { adapters } = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'plain-app' });
      workspace.write('src/math.ts', 'export const add = (a: number, b: number) => a + b;\n');
    });
    const run = adapters.find((adapter) => adapter.adapterId === 'adapter:workers-bindings');
    assert.ok(run !== undefined);
    assert.equal(run.status, 'not_applicable');
  });

  it('does not read a wrangler.toml that declares no binding as a source of components', async () => {
    const { ids } = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'static-site' });
      workspace.write('wrangler.toml', 'name = "static-site"\ncompatibility_date = "2024-12-18"\n');
    });
    assert.equal(
      ids.some((id) => id.startsWith('database:') || id.startsWith('queue:')),
      false,
      `a manifest with no binding declares no store, saw ${ids.join(', ')}`,
    );
  });
});

describe('external effects reached through a client member', () => {
  it('counts a promise chain as the one request it is', async () => {
    const { ids, edges } = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'chain-app' });
      workspace.write(
        'src/load.ts',
        `export const load = (url: string): Promise<Float32Array> =>
  fetch(url)
    .then((response) => response.arrayBuffer())
    .then((buffer) => new Float32Array(buffer))
    .catch(() => new Float32Array(0));
`,
      );
    });
    const services = ids.filter((id) => id.startsWith('external_service:'));
    const calls = edges.filter((edge) => edge.startsWith('calls_service:'));
    assert.equal(services.length, 1, `one service was expected, saw ${services.join(', ')}`);
    assert.equal(calls.length, 1, `one call was expected, saw ${calls.join(', ')}`);
  });

  it('still reads a client whose member names the operation', async () => {
    const { ids, edges } = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'axios-app', dependencies: { axios: '^1.7.0' } });
      workspace.write(
        'src/client.ts',
        `import axios from 'axios';

export const send = () => axios.post('https://api.example.com/orders', {});
`,
      );
    });
    assert.ok(
      ids.some((id) => id.startsWith('external_service:')),
      `the posted service should have been discovered, saw ${ids.join(', ')}`,
    );
    assert.ok(
      edges.some((edge) => edge.startsWith('calls_service:')),
      `the call should have been discovered, saw ${edges.join(', ')}`,
    );
  });

  it('does not read a configured test double as a request that leaves the process', async () => {
    const { ids, edges } = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'mock-app' });
      workspace.write(
        'src/api.check.ts',
        `export const prime = (body: unknown): void => {
  fetch.mockResolvedValue({ ok: true, json: () => body });
  fetch.mockResolvedValueOnce({ ok: false, status: 500 });
};
`,
      );
    });
    assert.equal(
      ids.some((id) => id.startsWith('external_service:')),
      false,
      `mock setup is not a request, saw ${ids.join(', ')}`,
    );
    assert.equal(
      edges.some((edge) => edge.startsWith('calls_service:')),
      false,
      `mock setup is not a request, saw ${edges.join(', ')}`,
    );
  });
});

describe('an effect a test harness reaches at a fake', () => {
  const writeStore = (workspace: ReturnType<typeof createTempWorkspace>, path: string): void => {
    writeNodeProject(workspace, { name: 'store-app' });
    workspace.write(
      path,
      `import { DatabaseSync } from 'node:sqlite';

export class Store {
  readonly db = new DatabaseSync(':memory:');
}
`,
    );
  };

  it('is not mapped as a datastore of the system', async () => {
    const { ids } = await scan((workspace) => writeStore(workspace, 'test/helpers/d1.ts'));
    assert.equal(
      ids.some((id) => id.startsWith('database:')),
      false,
      `a double is not the system's datastore, saw ${ids.join(', ')}`,
    );
  });

  it('is mapped when the same construction is in source', async () => {
    const { ids } = await scan((workspace) => writeStore(workspace, 'src/store.ts'));
    assert.ok(
      ids.includes('database:sqlite'),
      `the datastore should have been discovered, saw ${ids.join(', ')}`,
    );
  });
});

describe('a repository with none of them', () => {
  it('reports no agent system rather than inventing one', async () => {
    const { result, ids } = await scan((workspace) => {
      writeNodeProject(workspace, { name: 'plain-app' });
      workspace.write(
        'src/math.ts',
        'export const add = (a: number, b: number): number => a + b;\n',
      );
    });
    assert.equal(result.agentSystemDetected, false);
    assert.equal(
      ids.some((id) => id.startsWith('agent:')),
      false,
      `no agent should have been discovered, saw ${ids.join(', ')}`,
    );
  });
});
