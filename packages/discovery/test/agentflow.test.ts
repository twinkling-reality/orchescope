import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writePythonProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const workspaces: ReturnType<typeof createTempWorkspace>[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>, dependencies = ['agentflow']) => {
  const workspace = createTempWorkspace('orchescope-agentflow-');
  workspaces.push(workspace);
  writePythonProject(workspace, { name: 'agentflow-app', dependencies });
  for (const [file, source] of Object.entries(files)) workspace.write(file, source);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'agentflow-app',
      orchescopeVersion: '0.9.1',
      clock,
      deadline,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 100,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 2,
    });
  } finally {
    deadline.dispose();
  }
};

const targetFiles = {
  'src/browser_app/__init__.py': '',
  'src/browser_app/graph.py': `from agentflow.core import Agent, StateGraph, ToolNode
from agentflow.utils.constants import END

SYSTEM_PROMPT = "Use the browser tools to complete the user's request."

def route(state):
    return "TOOL"

def build_agent_graph(config, tools):
    tool_node = ToolNode(tools)
    agent = Agent(
        model=config.model,
        provider=config.provider,
        system_prompt=SYSTEM_PROMPT,
        tool_node=tool_node,
    )
    graph = StateGraph()
    graph.add_node("MAIN", agent)
    graph.add_node("TOOL", tool_node)
    graph.add_conditional_edges("MAIN", route, {"TOOL": "TOOL", END: END})
    graph.add_edge("TOOL", "MAIN")
    graph.set_entry_point("MAIN")
    return graph.compile()
`,
  'src/browser_app/runner.py': `from .graph import build_agent_graph

async def execute(config, tools, payload):
    graph = build_agent_graph(config, tools)
    return await graph.ainvoke(payload)
`,
} as const;

describe('AgentFlow discovery', () => {
  it('discovers the exact Agent, ToolNode, cyclic graph and compiled invocation boundary', async () => {
    const result = await scan(targetFiles);
    const components = result.graph.components.filter((component) =>
      component.discoveredBy.includes('adapter:agentflow'),
    );
    assert.deepEqual(
      components.map((component) => [component.kind, component.identity.localName]).sort(),
      [
        ['agent', 'build_agent_graph.agent'],
        ['tool', 'build_agent_graph.tool_node'],
        ['workflow', 'build_agent_graph.graph'],
        ['workflow_step', 'build_agent_graph.graph.main'],
        ['workflow_step', 'build_agent_graph.graph.tool'],
      ],
    );
    const relations = result.graph.edges.filter((edge) =>
      edge.discoveredBy.includes('adapter:agentflow'),
    );
    assert.deepEqual(relations.map((edge) => edge.kind).sort(), [
      'calls_tool',
      'contains',
      'contains',
      'transitions_to',
      'transitions_to',
    ]);
    assert.ok(
      relations.some(
        (edge) =>
          edge.kind === 'transitions_to' &&
          edge.from.endsWith('.main') &&
          edge.to.endsWith('.tool'),
      ),
    );
    assert.ok(
      relations.some(
        (edge) =>
          edge.kind === 'transitions_to' &&
          edge.from.endsWith('.tool') &&
          edge.to.endsWith('.main'),
      ),
    );
    const workflow = components.find((component) => component.kind === 'workflow');
    assert.deepEqual(
      workflow?.sourceLocations.map((location) => [location.file, location.startLine]).sort(),
      [
        ['src/browser_app/graph.py', 17],
        ['src/browser_app/graph.py', 23],
        ['src/browser_app/runner.py', 5],
      ],
    );
    const adapter = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:agentflow',
    );
    assert.equal(adapter?.status, 'completed');
    assert.equal(adapter?.componentsFound, 5);
    assert.equal(adapter?.edgesFound, 5);
    assert.equal(adapter?.filesInspected, 2);
    const topology = result.graph.coverage.topology;
    assert.equal(topology?.status, 'incomplete');
    assert.equal(topology?.entryBoundaries, 2);
    assert.equal(topology?.terminalBoundaries, 1);
    assert.equal(topology?.conditionalConstructs, 1);
    assert.equal(topology?.conditionalDestinations, 2);
    assert.equal(topology?.explicitRelations, 3);
    assert.ok(
      topology?.unresolved.some((entry) => entry.reason.includes('model input was computed')),
    );
    assert.ok(
      topology?.unresolved.some((entry) => entry.reason.includes('provider input was computed')),
    );
    assert.ok(
      topology?.unresolved.some((entry) => entry.reason.includes('tool population was computed')),
    );
  });

  it('recognizes renamed and namespace runtime imports', async () => {
    const renamed = await scan({
      'app.py': `from agentflow.core import Agent as FlowAgent, StateGraph as FlowGraph, ToolNode as FlowTool

def build():
    tools = FlowTool([])
    agent = FlowAgent(model="gemini:flash", tool_node=tools)
    graph = FlowGraph()
    graph.add_node("MAIN", agent)
    graph.add_node("TOOL", tools)
    graph.add_edge("MAIN", "TOOL")
`,
    });
    assert.equal(
      renamed.graph.components.filter((component) =>
        component.discoveredBy.includes('adapter:agentflow'),
      ).length,
      7,
    );

    const namespaced = await scan({
      'app.py': `import agentflow.core as flow

def build():
    tools = flow.ToolNode([])
    agent = flow.Agent(model="flash", tool_node=tools)
    graph = flow.StateGraph()
    graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      namespaced.graph.components.some(
        (component) =>
          component.kind === 'agent' && component.discoveredBy.includes('adapter:agentflow'),
      ),
    );
  });

  it('stays quiet for foreign, local, shadowed and rebound lookalikes', async () => {
    const foreign = await scan(
      {
        'app.py': `from something_else import Agent, StateGraph, ToolNode
agent = Agent()
tools = ToolNode([])
graph = StateGraph()
`,
      },
      ['agentflow', 'something-else'],
    );
    assert.equal(
      foreign.graph.components.filter((component) =>
        component.discoveredBy.includes('adapter:agentflow'),
      ).length,
      0,
    );

    const shadowed = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

def build(Agent, StateGraph, ToolNode):
    agent = Agent()
    tools = ToolNode([])
    graph = StateGraph()
`,
    });
    assert.equal(
      shadowed.graph.components.filter((component) =>
        component.discoveredBy.includes('adapter:agentflow'),
      ).length,
      0,
    );

    const rebound = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode
Agent = foreign
StateGraph = foreign
ToolNode = foreign
agent = Agent()
tools = ToolNode([])
graph = StateGraph()
`,
    });
    assert.equal(
      rebound.graph.components.filter((component) =>
        component.discoveredBy.includes('adapter:agentflow'),
      ).length,
      0,
    );

    const local = await scan({
      'agentflow/__init__.py': '',
      'agentflow/core.py': 'class Agent: pass\nclass StateGraph: pass\nclass ToolNode: pass\n',
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode
agent = Agent()
tools = ToolNode([])
graph = StateGraph()
`,
    });
    assert.equal(
      local.graph.components.filter((component) =>
        component.discoveredBy.includes('adapter:agentflow'),
      ).length,
      0,
    );
  });

  it('refuses unstable graph and invocation bindings instead of borrowing them', async () => {
    const result = await scan({
      'src/app/__init__.py': '',
      'src/app/graph.py': `from agentflow.core import StateGraph

def build():
    graph = StateGraph()
    graph = custom_graph
    return graph.compile()
`,
      'src/app/runner.py': `from .graph import build

async def execute(payload):
    graph = build()
    graph = custom_graph
    return await graph.ainvoke(payload)
`,
    });
    assert.equal(
      result.graph.components.filter((component) =>
        component.discoveredBy.includes('adapter:agentflow'),
      ).length,
      0,
    );
    const adapter = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:agentflow',
    );
    assert.equal(adapter?.status, 'completed');
    assert.ok(adapter?.detail?.includes('no stable supported construction'));
    assert.ok(result.graph.coverage.topology?.unresolvedCount);
  });

  it('requires constructions to dominate graph and tool relations', async () => {
    const result = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

def build(flag):
    graph.add_node("EARLY", agent)
    agent = Agent(tool_node=tools)
    tools = ToolNode([])
    if flag:
        conditional_graph = StateGraph()
    conditional_graph.add_node("LATE", agent)
    graph = StateGraph()
`,
    });
    const edges = result.graph.edges.filter((edge) =>
      edge.discoveredBy.includes('adapter:agentflow'),
    );
    assert.equal(edges.length, 0);
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('used before construction'),
      ),
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('outside the control-flow path'),
      ),
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('Agent endpoint population did not prove stable'),
      ),
    );
  });

  it('refuses duplicate factories and locally escaped compiled receivers', async () => {
    const duplicateFactory = await scan({
      'src/app/__init__.py': '',
      'src/app/graph.py': `from agentflow.core import StateGraph

def build():
    graph = StateGraph()
    return graph.compile()

def build():
    return foreign
`,
      'src/app/runner.py': `from .graph import build

async def execute(payload):
    graph = build()
    return await graph.ainvoke(payload)
`,
    });
    assert.equal(duplicateFactory.graph.coverage.topology?.entryBoundaries, 0);
    assert.ok(
      duplicateFactory.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('one unchanged synchronous definition'),
      ),
    );

    const escaped = await scan({
      'src/app/__init__.py': '',
      'src/app/graph.py': `from agentflow.core import StateGraph

def build():
    graph = StateGraph()
    return graph.compile()
`,
      'src/app/runner.py': `from .graph import build

async def execute(payload):
    graph = build()
    def alter():
        nonlocal graph
        graph = foreign
    alter()
    return await graph.ainvoke(payload)
`,
    });
    assert.equal(escaped.graph.coverage.topology?.entryBoundaries, 0);
    assert.ok(
      escaped.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('did not prove stable'),
      ),
    );
  });

  it('settles ToolNode identifiers in the exact lexical scope and source order', async () => {
    const result = await scan({
      'app.py': `from agentflow.core import ToolNode

def click():
    return "global"

def parameter_shadow(click):
    tools = ToolNode([click])

def use_before_definition():
    tools = ToolNode([later])
    def later():
        return "late"

click = foreign
module_tools = ToolNode([click])
`,
    });
    assert.equal(
      result.graph.edges.filter(
        (edge) => edge.kind === 'calls_tool' && edge.discoveredBy.includes('adapter:agentflow'),
      ).length,
      0,
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.filter((entry) =>
        entry.reason.includes('no unique local function implementation'),
      ).length === 3,
    );
  });

  it('supports module-scope graphs and counts repeated shared tools once', async () => {
    const result = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

def click():
    return "ok"

tools = ToolNode([click, click])
other_tools = ToolNode([click])
agent = Agent(tool_node=tools)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    const adapter = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:agentflow',
    );
    assert.equal(adapter?.componentsFound, 6);
    assert.equal(adapter?.edgesFound, 4);
    assert.ok(
      result.graph.components.some(
        (component) =>
          component.kind === 'workflow_step' && component.identity.localName === 'graph.main',
      ),
    );
  });

  it('does not compile or invoke a graph after an unsettled topology operation', async () => {
    const sources = [
      'graph.add_node("EARLY", agent)\n    graph = StateGraph()',
      'graph = StateGraph()\n    if flag:\n        graph.add_node("MAIN", agent)',
      'graph = StateGraph()\n    graph.configure()',
      'graph = StateGraph()\n    mutate(graph)',
      'graph = StateGraph()\n    box = {"graph": graph}',
    ];
    for (const [index, body] of sources.entries()) {
      const result = await scan({
        'src/app/__init__.py': '',
        'src/app/graph.py': `from agentflow.core import StateGraph

def build(flag=False):
    ${body}
    return graph.compile()
`,
        'src/app/runner.py': `from .graph import build

async def execute(payload):
    graph = build()
    return await graph.ainvoke(payload)
`,
      });
      assert.equal(
        result.graph.coverage.topology?.entryBoundaries,
        0,
        `fixture ${index} must not lend an invocation boundary`,
      );
      assert.equal(
        result.graph.edges.some(
          (edge) => edge.kind === 'contains' && edge.discoveredBy.includes('adapter:agentflow'),
        ),
        false,
      );
      assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    }
  });

  it('refuses a compiled receiver after an invoked alias of a local callable', async () => {
    const result = await scan({
      'src/app/__init__.py': '',
      'src/app/graph.py': `from agentflow.core import StateGraph

def build():
    graph = StateGraph()
    return graph.compile()
`,
      'src/app/runner.py': `from .graph import build

async def execute(payload):
    runner = build()
    def mutate():
        nonlocal runner
        runner = foreign
    helper = mutate
    helper()
    return await runner.ainvoke(payload)
`,
    });
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 0);
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('did not prove stable'),
      ),
    );
  });

  it('settles direct compile receivers and source-declared recursion ceilings', async () => {
    const result = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

LIMITS = {"small": 20, "large": 40}
agent = Agent()

first = StateGraph()
first.add_node("MAIN", agent)
first.add_edge("MAIN", "MAIN")
first_app = first.compile()
first_app.invoke(payload, {"recursion_limit": 10})

second = StateGraph()
second.add_node("MAIN", agent)
second.add_edge("MAIN", "MAIN")
second_app = second.compile()
tier = choose_tier()
step_budget = LIMITS.get(tier, 15)
config = {"recursion_limit": step_budget}
await second_app.ainvoke(payload, config=config)
`,
    });
    const topology = result.graph.coverage.topology;
    assert.equal(topology?.entryBoundaries, 2);
    assert.equal(topology?.configurationBounds, 2);
    assert.deepEqual(
      topology?.configurationBoundFacts
        .map((entry) => ('ceilingValue' in entry ? entry.ceilingValue : entry.defaultValue))
        .sort((a, b) => a - b),
      [10, 40],
    );
    const boundedTransitions = result.graph.edges.filter(
      (edge) =>
        edge.kind === 'transitions_to' &&
        edge.metadata['conditionalBoundKind'] === 'invocation_ceiling',
    );
    assert.equal(boundedTransitions.length, 2);
    assert.deepEqual(
      boundedTransitions
        .map((edge) => edge.metadata['conditionalBoundDefault'])
        .sort((a, b) => Number(a) - Number(b)),
      [10, 40],
    );
  });

  it('refuses a dynamic recursion limit without hiding the invocation', async () => {
    const result = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
config = {"recursion_limit": runtime_limit}
app.invoke(payload, config=config)
`,
    });
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 1);
    assert.equal(result.graph.coverage.topology?.configurationBounds, 0);
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) => entry.kind === 'config_backed_bound' && entry.reason.includes('recursion_limit'),
      ),
    );
  });

  it('keeps Agent identity but refuses unstable model, prompt and tool endpoints', async () => {
    for (const operation of ['agent.configure(model="other")', 'mutate(agent)']) {
      const result = await scan({
        'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

def click():
    return "ok"

tools = ToolNode([click])
agent = Agent(model="gemini:flash", system_prompt="Act", tool_node=tools)
${operation}
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
      });
      assert.ok(
        result.graph.components.some(
          (component) =>
            component.kind === 'agent' && component.discoveredBy.includes('adapter:agentflow'),
        ),
      );
      assert.equal(
        result.graph.edges.some(
          (edge) =>
            edge.from.includes('agent:') &&
            (edge.kind === 'invokes_model' || edge.kind === 'calls_tool'),
        ),
        false,
      );
      assert.ok(
        result.graph.coverage.topology?.unresolved.some((entry) =>
          entry.reason.includes('Agent endpoint population did not prove stable'),
        ),
      );
    }
  });

  it('refuses changed, escaped and aliased ToolNode populations', async () => {
    const operations = [
      'tools.add_tool(other)',
      'mutate(tools)',
      'box = {"tools": tools}',
      'alias = tools',
    ];
    for (const operation of operations) {
      const result = await scan({
        'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

def click():
    return "ok"

tools = ToolNode([click])
agent = Agent(tool_node=tools)
${operation}
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
      });
      assert.equal(
        result.graph.edges.some((edge) => edge.to.includes('click') && edge.kind === 'calls_tool'),
        false,
      );
      assert.ok(
        result.graph.edges.some(
          (edge) =>
            edge.from.includes('agent:') && edge.to.includes('tool:') && edge.kind === 'calls_tool',
        ),
      );
      assert.ok(
        result.graph.coverage.topology?.unresolved.some((entry) =>
          entry.reason.includes('ToolNode population did not prove stable'),
        ),
      );
    }
  });

  it('authorizes component reuse only in exact AgentFlow consumer slots', async () => {
    const agentMetadata = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

first = Agent(model="gemini:flash")
second = Agent(model="other", metadata=first)
graph = StateGraph()
graph.add_node("MAIN", first)
`,
    });
    assert.equal(
      agentMetadata.graph.edges.some(
        (edge) => edge.from.includes('first') && edge.kind === 'invokes_model',
      ),
      false,
    );

    const toolMetadata = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

def click():
    return "ok"

tools = ToolNode([click])
agent = Agent(metadata={"tools": tools})
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      toolMetadata.graph.edges.some(
        (edge) => edge.from.includes('tools') && edge.to.includes('click'),
      ),
      false,
    );

    const graphPayload = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
graph = StateGraph()
graph.add_node("MAIN", {"agent": agent})
`,
    });
    assert.equal(
      graphPayload.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );
    for (const result of [agentMetadata, toolMetadata, graphPayload]) {
      assert.ok(
        result.graph.coverage.topology?.unresolved.some((entry) =>
          entry.reason.includes('did not prove stable'),
        ),
      );
    }

    const duplicatedToolUse = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

def click():
    return "ok"

tools = ToolNode([click])
agent = Agent(tool_node=tools, metadata={"also": tools})
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      duplicatedToolUse.graph.edges.some(
        (edge) => edge.from.includes('tools') && edge.to.includes('click'),
      ),
      false,
    );
    assert.ok(
      duplicatedToolUse.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('ToolNode population did not prove stable'),
      ),
    );

    const selectedToolUse = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

tools = ToolNode([])
agent = Agent(tool_node=tools, metadata=tools if flag else foreign)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      selectedToolUse.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('ToolNode population did not prove stable'),
      ),
    );

    const duplicatedAgentUse = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
graph = StateGraph()
graph.add_node("MAIN", agent, metadata={"also": agent})
`,
    });
    assert.equal(
      duplicatedAgentUse.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );
    assert.ok(
      duplicatedAgentUse.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('Agent endpoint population did not prove stable'),
      ),
    );
  });

  it('refuses endpoint populations changed through invoked local helpers and aliases', async () => {
    const agent = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def mutate():
    agent.configure(model="other")
mutate()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      agent.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );

    const toolNode = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph, ToolNode

def click():
    return "ok"

tools = ToolNode([click])
def mutate():
    tools.add_tool(other)
def wrapper():
    mutate()
helper = wrapper
helper()
agent = Agent(tool_node=tools)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      toolNode.graph.edges.some((edge) => edge.from.includes('tools') && edge.to.includes('click')),
      false,
    );
    assert.ok(
      toolNode.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('ToolNode population did not prove stable'),
      ),
    );

    const distinctSameName = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def dangerous():
    agent.configure(model="other")
def wrapper():
    def dangerous():
        return "harmless"
    dangerous()
wrapper()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      distinctSameName.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );
    assert.equal(
      distinctSameName.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('Agent endpoint population did not prove stable'),
      ),
      false,
    );

    const repeatedSources = [
      `def mutate():
    return "safe"
def mutate():
    agent.configure(model="other")
helper = mutate
helper()`,
      `def mutate():
    agent.configure(model="other")
def mutate():
    return "safe"
mutate()`,
      `if flag:
    def mutate():
        agent.configure(model="other")
else:
    def mutate():
        return "safe"
mutate()`,
    ];
    const repeatedResults: Awaited<ReturnType<typeof scan>>[] = [];
    for (const repeated of repeatedSources) {
      repeatedResults.push(
        await scan({
          'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
${repeated}
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
        }),
      );
    }
    assert.equal(
      repeatedResults[0]?.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );
    assert.ok(
      repeatedResults[1]?.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );
    assert.equal(
      repeatedResults[2]?.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );
    for (const result of [repeatedResults[0], repeatedResults[2]]) {
      assert.ok(
        result?.graph.coverage.topology?.unresolved.some((entry) =>
          entry.reason.includes('Agent endpoint population did not prove stable'),
        ),
      );
    }

    const parameterPrelude = `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def mutate():
    agent.configure(model="other")
def noop():
    return "safe"
def wrapper(mutate):
    mutate()
`;
    const safeParameter = await scan({
      'app.py': `${parameterPrelude}
wrapper(noop)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      safeParameter.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    const safeOppositeBranch = await scan({
      'app.py': `${parameterPrelude}
def branched_wrapper(fn, flag):
    if flag:
        fn = mutate
    else:
        fn()
branched_wrapper(noop, False)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      safeOppositeBranch.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    const mutatingOppositeBranch = await scan({
      'app.py': `${parameterPrelude}
def branched_wrapper(fn, flag):
    if flag:
        fn()
    else:
        fn = noop
branched_wrapper(mutate, True)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      mutatingOppositeBranch.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );

    const mutatingParameter = await scan({
      'app.py': `${parameterPrelude}
wrapper(mutate)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      mutatingParameter.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );

    const dynamicParameter = await scan({
      'app.py': `${parameterPrelude}
wrapper(select_callable())
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      dynamicParameter.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );
    assert.ok(
      dynamicParameter.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('Agent endpoint population did not prove stable'),
      ),
    );

    const localImport = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def mutate():
    agent.configure(model="other")
def wrapper():
    from harmless import mutate
    mutate()
wrapper()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      localImport.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    for (const [argument, expectedModel] of [
      ['noop', true],
      ['mutate', false],
    ] as const) {
      const aliasParameter = await scan({
        'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def mutate():
    agent.configure(model="other")
def noop():
    return "safe"
def wrapper(fn):
    helper = fn
    helper()
wrapper(${argument})
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
      });
      assert.equal(
        aliasParameter.graph.edges.some(
          (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
        ),
        expectedModel,
      );
    }

    const helperLocalAliases = await Promise.all(
      [
        'alias = agent\n    alias.configure(model="other")',
        'box = {"agent": agent}\n    mutate_container(box)',
        'alias = agent\n    pass_on(alias)',
      ].map((body) =>
        scan({
          'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def mutate_container(value):
    return value
def pass_on(value):
    return value
def mutate():
    ${body}
mutate()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
        }),
      ),
    );
    for (const result of helperLocalAliases) {
      assert.equal(
        result.graph.edges.some(
          (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
        ),
        false,
      );
      assert.ok(
        result.graph.coverage.topology?.unresolved.some((entry) =>
          entry.reason.includes('Agent endpoint population did not prove stable'),
        ),
      );
    }

    const assignmentEscapes = await Promise.all(
      [
        'alias, = (agent,)\n    alias.configure(model="other")',
        '[alias] = [agent]\n    alias.configure(model="other")',
        'holder.agent = agent',
        'holder["agent"] = agent',
      ].map((body) =>
        scan({
          'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
holder = {}
def mutate():
    ${body}
mutate()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
        }),
      ),
    );
    for (const result of assignmentEscapes) {
      assert.equal(
        result.graph.edges.some(
          (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
        ),
        false,
      );
    }

    const unrelatedAssignment = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
holder = {}
def inspect():
    agent = foreign
    alias, = (agent,)
    holder["agent"] = agent
    alias.configure(model="other")
inspect()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      unrelatedAssignment.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    const assignmentAfterUse = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def inspect():
    alias = foreign
    alias.configure(model="other")
    alias, = (agent,)
inspect()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      assignmentAfterUse.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    const returnedAliases = await Promise.all(
      [
        'return agent',
        'alias = agent\n    return alias',
        'box = {"agent": agent}\n    return box',
        'if flag:\n        return agent\n    return foreign',
      ].map((body, index) => {
        const parameter = index === 3 ? 'flag' : '';
        const argument = index === 3 ? 'select_flag()' : '';
        return scan({
          'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def expose(${parameter}):
    ${body}
def mutate():
    alias = expose(${argument})
    alias.configure(model="other")
mutate()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
        });
      }),
    );
    for (const result of returnedAliases) {
      assert.equal(
        result.graph.edges.some(
          (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
        ),
        false,
      );
      assert.ok(
        result.graph.coverage.topology?.unresolved.some((entry) =>
          entry.reason.includes('Agent endpoint population did not prove stable'),
        ),
      );
    }

    const returnedMemberStore = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
holder = {}
def expose():
    return agent
def mutate():
    holder.agent = expose()
mutate()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      returnedMemberStore.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );

    const unrelatedReturn = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def expose():
    agent = foreign
    return agent
def inspect():
    alias = expose()
    alias.configure(model="other")
inspect()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      unrelatedReturn.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    const ignoredReturn = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def expose():
    return agent
def inspect():
    expose()
inspect()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      ignoredReturn.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    const unrelatedSameName = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def inspect():
    agent = foreign
    agent.configure(model="other")
inspect()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      unrelatedSameName.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    const mixedSource = `${parameterPrelude}
wrapper(noop)
wrapper(mutate)
graph = StateGraph()
graph.add_node("MAIN", agent)
`;
    const mixedInvocations = await scan({ 'app.py': mixedSource });
    const mutatingLine = mixedSource.split('\n').indexOf('wrapper(mutate)') + 1;
    assert.equal(
      mixedInvocations.graph.coverage.topology?.unresolved.find((entry) =>
        entry.reason.includes('Agent endpoint population did not prove stable'),
      )?.location?.startLine,
      mutatingLine,
    );

    const beforeConstruction = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

def mutate():
    agent.configure(model="other")
def noop():
    return "safe"
def wrapper(fn):
    fn()
wrapper(mutate)
agent = Agent(model="gemini:flash")
wrapper(noop)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      beforeConstruction.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    for (const [argument, expectedModel] of [
      ['noop', true],
      ['mutate', false],
    ] as const) {
      const forwarded = await scan({
        'app.py': `${parameterPrelude}
def outer(fn):
    wrapper(fn)
outer(${argument})
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
      });
      assert.equal(
        forwarded.graph.edges.some(
          (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
        ),
        expectedModel,
      );
    }

    for (const [argument, expectedModel] of [
      ['noop', true],
      ['mutate', false],
    ] as const) {
      const captured = await scan({
        'app.py': `${parameterPrelude}
def outer(fn):
    def inner():
        helper = fn
        helper()
    inner()
outer(${argument})
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
      });
      assert.equal(
        captured.graph.edges.some(
          (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
        ),
        expectedModel,
      );
    }

    const capturedImport = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent(model="gemini:flash")
def mutate():
    agent.configure(model="other")
def outer():
    from harmless import mutate
    def inner():
        mutate()
    inner()
outer()
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      capturedImport.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    for (const [argument, replacement, expectedModel] of [
      ['mutate', 'noop', true],
      ['noop', 'mutate', false],
    ] as const) {
      const reassignedParameter = await scan({
        'app.py': `${parameterPrelude}
def replace(fn):
    fn = ${replacement}
    fn()
replace(${argument})
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
      });
      assert.equal(
        reassignedParameter.graph.edges.some(
          (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
        ),
        expectedModel,
      );
    }

    const postCallReplacement = await scan({
      'app.py': `${parameterPrelude}
def replace(fn):
    fn()
    fn = mutate
replace(noop)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.ok(
      postCallReplacement.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
    );

    const conditionalReplacement = await scan({
      'app.py': `${parameterPrelude}
def replace(fn, flag):
    if flag:
        fn = mutate
    fn()
replace(noop, dynamic)
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
    });
    assert.equal(
      conditionalReplacement.graph.edges.some(
        (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
      ),
      false,
    );

    for (const [argument, replacement, expectedModel] of [
      ['mutate', 'noop', true],
      ['noop', 'mutate', false],
    ] as const) {
      const nonlocalReplacement = await scan({
        'app.py': `${parameterPrelude}
def outer(fn):
    def inner():
        nonlocal fn
        fn = ${replacement}
        fn()
    inner()
outer(${argument})
graph = StateGraph()
graph.add_node("MAIN", agent)
`,
      });
      assert.equal(
        nonlocalReplacement.graph.edges.some(
          (edge) => edge.from.includes('agent:') && edge.kind === 'invokes_model',
        ),
        expectedModel,
      );
    }
  });

  it('refuses mutated, reassigned and escaped invocation config objects', async () => {
    const operations = [
      'config["recursion_limit"] = dynamic',
      'config = dynamic',
      'mutate(config)',
    ];
    for (const operation of operations) {
      const result = await scan({
        'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
config = {"recursion_limit": 10}
${operation}
app.invoke(payload, config=config)
`,
      });
      assert.equal(result.graph.coverage.topology?.entryBoundaries, 1);
      assert.equal(result.graph.coverage.topology?.configurationBounds, 0);
      assert.ok(
        result.graph.coverage.topology?.unresolved.some(
          (entry) => entry.kind === 'config_backed_bound',
        ),
      );
    }
  });

  it('refuses incomplete and duplicate recursion-limit objects', async () => {
    const invocations = [
      'app.invoke(payload, {"recursion_limit": 10, **dynamic})',
      'config = {**dynamic, "recursion_limit": 10}\napp.invoke(payload, config=config)',
      'config = {"recursion_limit": 10, "recursion_limit": dynamic}\napp.invoke(payload, config)',
    ];
    for (const invocation of invocations) {
      const result = await scan({
        'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
${invocation}
`,
      });
      assert.equal(result.graph.coverage.topology?.entryBoundaries, 1);
      assert.equal(result.graph.coverage.topology?.configurationBounds, 0);
      assert.ok(
        result.graph.coverage.topology?.unresolved.some(
          (entry) => entry.kind === 'config_backed_bound',
        ),
      );
    }
  });

  it('settles direct compiled receivers independently at each invocation', async () => {
    const beforeMember = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
app.invoke = foreign
app.invoke(payload)
`,
    });
    const beforeReceiver = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
app = foreign
app.invoke(payload)
`,
    });
    const escaped = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
alias = app
app.invoke(payload)
`,
    });
    for (const [index, result] of [beforeMember, beforeReceiver, escaped].entries()) {
      assert.equal(result.graph.coverage.topology?.entryBoundaries, 0);
      assert.equal(result.graph.coverage.topology?.status, 'incomplete', `fixture ${index}`);
      assert.ok(
        result.graph.coverage.topology?.unresolved.some((entry) =>
          entry.reason.includes('did not prove stable'),
        ),
      );
    }

    const after = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
app.invoke(payload)
alias = app
app = foreign
`,
    });
    assert.equal(after.graph.coverage.topology?.entryBoundaries, 1);

    const between = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
app.invoke(first)
app.invoke = foreign
app.invoke(second)
`,
    });
    assert.equal(between.graph.coverage.topology?.entryBoundaries, 1);
    assert.equal(between.graph.coverage.topology?.status, 'incomplete');
  });

  it('does not borrow a bound map through parameter shadowing or replacement', async () => {
    const parameterShadow = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

LIMITS = {"x": 10}
def run(LIMITS):
    agent = Agent()
    graph = StateGraph()
    graph.add_node("MAIN", agent)
    app = graph.compile()
    budget = LIMITS.get("x", 5)
    config = {"recursion_limit": budget}
    app.invoke(payload, config=config)
`,
    });
    const replacement = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
app = graph.compile()
LIMITS = {"x": 10}
LIMITS = dynamic
budget = LIMITS.get("x", 5)
config = {"recursion_limit": budget}
app.invoke(payload, config=config)
`,
    });
    for (const result of [parameterShadow, replacement]) {
      assert.equal(result.graph.coverage.topology?.configurationBounds, 0);
      assert.ok(
        result.graph.coverage.topology?.unresolved.some(
          (entry) => entry.kind === 'config_backed_bound',
        ),
      );
    }
  });

  it('does not apply one bounded invocation to an unbounded invocation population', async () => {
    const result = await scan({
      'app.py': `from agentflow.core import Agent, StateGraph

agent = Agent()
graph = StateGraph()
graph.add_node("MAIN", agent)
graph.add_edge("MAIN", "MAIN")
app = graph.compile()
app.invoke(first, {"recursion_limit": 10})
app.invoke(second)
`,
    });
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 2);
    assert.equal(result.graph.coverage.topology?.configurationBounds, 1);
    assert.equal(
      result.graph.edges.some(
        (edge) => edge.metadata['conditionalBoundKind'] === 'invocation_ceiling',
      ),
      false,
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('1 of 2 AgentFlow invocation boundaries'),
      ),
    );
  });
});
