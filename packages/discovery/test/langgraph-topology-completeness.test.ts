import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject, writePythonProject } from '@orchescope/testkit';
import { langGraphAdapter } from '../src/adapters/langgraph.ts';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scanWorkspace = async (workspace: ReturnType<typeof createTempWorkspace>) => {
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'fixture',
      orchescopeVersion: '0.9.0',
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
      adapters: [langGraphAdapter],
    });
  } finally {
    deadline.dispose();
  }
};

const scan = (graphSource: string, configurationSource?: string) => {
  const workspace = createTempWorkspace('orchescope-langgraph-topology-');
  workspaces.push(workspace);
  writePythonProject(workspace, { name: 'router-app', dependencies: ['langgraph>=1.1.0'] });
  workspace.write('src/router_app/__init__.py', '');
  workspace.write('src/router_app/graph.py', graphSource);
  if (configurationSource !== undefined) {
    workspace.write('src/router_app/configuration.py', configurationSource);
  }
  return scanWorkspace(workspace);
};

const scanTypeScript = (graphSource: string) => {
  const workspace = createTempWorkspace('orchescope-langgraph-topology-js-');
  workspaces.push(workspace);
  writeNodeProject(workspace, {
    name: 'router-app',
    dependencies: { '@langchain/langgraph': '^1.0.0' },
  });
  workspace.write('src/graph.ts', graphSource);
  return scanWorkspace(workspace);
};

const edgeNames = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`);

describe('LangGraph topology completeness', () => {
  it('discovers a named Literal router, its cycle, handled boundaries and static config default', async () => {
    const result = await scan(
      `from typing import Literal
from langgraph.graph import StateGraph, START, END
from router_app.configuration import Configuration

def reflect(state):
    return state

def research(state):
    return state

def finish(state):
    return state

def route(state, config) -> Literal["finish", "research"]:
    configurable = Configuration.from_runnable_config(config)
    if state.count <= configurable.max_loops:
        return "research"
    return "finish"

builder = StateGraph(dict)
builder.add_node("reflect", reflect)
builder.add_node("research", research)
builder.add_node("finish", finish)
builder.add_edge(START, "reflect")
builder.add_conditional_edges("reflect", route)
builder.add_edge("research", "reflect")
builder.add_edge("finish", END)
`,
      `from pydantic import BaseModel, Field

class Configuration(BaseModel):
    max_loops: int = Field(default=3)

    @classmethod
    def from_runnable_config(cls, config):
        return cls()
`,
    );

    const edges = edgeNames(result);
    assert.ok(edges.includes('transitions_to:workflow_step:reflect->workflow_step:research'));
    assert.ok(edges.includes('transitions_to:workflow_step:reflect->workflow_step:finish'));
    assert.ok(edges.includes('transitions_to:workflow_step:research->workflow_step:reflect'));
    assert.equal(
      result.graph.components.some((component) => /START|END/.test(component.id)),
      false,
    );

    const topology = result.graph.coverage.topology;
    assert.equal(topology?.status, 'complete');
    assert.equal(topology?.conditionalConstructs, 1);
    assert.equal(topology?.conditionalDestinations, 2);
    assert.equal(topology?.entryBoundaries, 1);
    assert.equal(topology?.terminalBoundaries, 1);
    assert.equal(topology?.unresolvedCount, 0);
    assert.deepEqual(topology?.configurationBoundFacts, [
      {
        name: 'max_loops',
        defaultValue: 3,
        reference: {
          file: 'src/router_app/graph.py',
          startLine: 16,
          startColumn: 7,
          endLine: 16,
          endColumn: 44,
          fileHash: result.graph.coverage.topology?.configurationBoundFacts[0]?.reference.fileHash,
        },
        declaration: {
          file: 'src/router_app/configuration.py',
          startLine: 4,
          startColumn: 4,
          endLine: 4,
          endColumn: 37,
          fileHash:
            result.graph.coverage.topology?.configurationBoundFacts[0]?.declaration.fileHash,
        },
      },
    ]);

    const conditional = result.graph.edges.find(
      (edge) => edge.from === 'workflow_step:reflect' && edge.to === 'workflow_step:research',
    );
    assert.equal(conditional?.metadata['conditionalBoundDefault'], 3);
    assert.ok(
      conditional?.sourceLocations.some(
        (location) =>
          location.file === 'src/router_app/configuration.py' && location.startLine === 4,
      ),
    );
  });

  it('reports annotation and return disagreement while retaining both bounded destinations', async () => {
    const result = await scan(`from typing import Literal
from langgraph.graph import StateGraph, START, END

def first(state):
    return state

def second(state):
    return state

def route(state) -> Literal["first"]:
    return "second"

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_node("second", second)
builder.add_edge(START, "first")
builder.add_conditional_edges("first", route)
builder.add_edge("second", END)
`);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.match(
      result.graph.coverage.topology?.unresolved[0]?.reason ?? '',
      /disagreeing Literal annotation and literal return destinations/,
    );
    assert.ok(
      edgeNames(result).includes('transitions_to:workflow_step:first->workflow_step:second'),
    );
    assert.ok(
      edgeNames(result).includes('transitions_to:workflow_step:first->workflow_step:first'),
    );
  });

  it('reports a dynamic router without guessing an edge', async () => {
    const result = await scan(`from langgraph.graph import StateGraph, START, END

def first(state):
    return state

def second(state):
    return state

def route(state):
    return state.destination

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_node("second", second)
builder.add_edge(START, "first")
builder.add_conditional_edges("first", route)
builder.add_edge("second", END)
`);
    const topology = result.graph.coverage.topology;
    assert.equal(topology?.status, 'incomplete');
    assert.equal(topology?.conditionalDestinations, 0);
    assert.equal(topology?.unresolvedCount, 2);
    assert.ok(
      topology?.unresolved.every((entry) => entry.location?.file === 'src/router_app/graph.py'),
    );
    assert.equal(
      result.graph.edges.some(
        (edge) => edge.from === 'workflow_step:first' && edge.to === 'workflow_step:second',
      ),
      false,
    );
    assert.match(result.graph.coverage.unsupported.at(-1)?.area ?? '', /topology: 2 unresolved/);
  });

  it('keeps explicit destination lists supported without inspecting the router body', async () => {
    const result = await scan(`from langgraph.graph import StateGraph, START, END

def first(state):
    return state

def second(state):
    return state

def dynamic_route(state):
    return state.destination

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_node("second", second)
builder.add_edge(START, "first")
builder.add_conditional_edges("first", dynamic_route, ["first", "second"])
builder.add_edge("second", END)
`);
    assert.equal(result.graph.coverage.topology?.status, 'complete');
    assert.equal(result.graph.coverage.topology?.conditionalDestinations, 2);
    assert.ok(
      edgeNames(result).includes('transitions_to:workflow_step:first->workflow_step:second'),
    );
  });

  it('qualifies aliased LangGraph boundaries through their imports', async () => {
    const result = await scan(`from langgraph.graph import StateGraph, START as BEGIN, END as FINISH

def first(state):
    return state

def second(state):
    return state

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_node("second", second)
builder.add_edge(BEGIN, "first")
builder.add_edge("first", "second")
builder.add_edge("second", FINISH)
`);
    assert.equal(result.graph.coverage.topology?.status, 'complete');
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 1);
    assert.deepEqual(result.graph.coverage.topology?.entryTargets, [
      result.graph.components.find((component) => component.id === 'workflow_step:first')?.identity,
    ]);
    assert.equal(result.graph.coverage.topology?.terminalBoundaries, 1);
  });

  it('does not treat local variables named START or END as framework boundaries', async () => {
    const result = await scan(`from langgraph.graph import StateGraph, START, END

START = "first"
END = "second"

def first(state):
    return state

def second(state):
    return state

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_node("second", second)
builder.add_edge(START, "first")
builder.add_edge("second", END)
`);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 0);
    assert.deepEqual(result.graph.coverage.topology?.entryTargets, []);
    assert.equal(result.graph.coverage.topology?.terminalBoundaries, 0);
    assert.equal(
      result.graph.components.some((component) => /START|END/.test(component.id)),
      false,
    );
  });

  it('does not use type-only START or END imports as runtime boundaries', async () => {
    const result =
      await scanTypeScript(`import { StateGraph, type START, type END } from '@langchain/langgraph';

const first = () => ({});
const second = () => ({});
const graph = new StateGraph({ channels: {} });
graph.addNode('first', first);
graph.addNode('second', second);
graph.addEdge(START, 'first');
graph.addEdge('second', END);
`);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 0);
    assert.deepEqual(result.graph.coverage.topology?.entryTargets, []);
    assert.equal(result.graph.coverage.topology?.terminalBoundaries, 0);
  });

  it('handles an aliased LangGraph END returned by a local Command node', async () => {
    const result = await scan(`from langgraph.graph import StateGraph, START
from langgraph.types import Command, END as FINISH

def first(state):
    return Command(goto=FINISH)

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_edge(START, "first")
`);
    assert.equal(result.graph.coverage.topology?.status, 'complete');
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 1);
    assert.equal(result.graph.coverage.topology?.terminalBoundaries, 1);
    assert.equal(
      result.graph.edges.some((edge) => edge.from === 'workflow_step:first'),
      false,
    );
  });

  it('uses a local function shorthand but refuses a dynamic node-name variable', async () => {
    const result = await scan(`from langgraph.graph import StateGraph, START, END

def actual(state):
    return state

name = "computed_at_runtime"
builder = StateGraph(dict)
builder.add_node(actual)
builder.add_node(name)
builder.add_edge(START, "actual")
builder.add_edge("actual", END)
`);
    assert.equal(
      result.graph.components.some((component) => component.id === 'workflow_step:actual'),
      true,
    );
    assert.equal(
      result.graph.components.some((component) => component.id === 'workflow_step:name'),
      false,
    );
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(result.graph.coverage.topology?.unresolved[0]?.kind, 'node_registration');
  });

  it('refuses an imported member router body rather than joining it to a local lookalike', async () => {
    const result = await scan(`from typing import Literal
from langgraph.graph import StateGraph, START, END
from router_app import routing

def first(state):
    return state

def second(state):
    return state

def route(state) -> Literal["second"]:
    return "second"

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_node("second", second)
builder.add_edge(START, "first")
builder.add_conditional_edges("first", routing.route)
builder.add_edge("second", END)
`);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(
      result.graph.edges.some(
        (edge) => edge.from === 'workflow_step:first' && edge.to === 'workflow_step:second',
      ),
      false,
    );
    assert.match(
      result.graph.coverage.topology?.unresolved[0]?.reason ?? '',
      /named local function/,
    );
  });

  it('retains a negative configuration default as a static fact', async () => {
    const result = await scan(
      `from typing import Literal
from langgraph.graph import StateGraph, START, END
from router_app.configuration import Configuration

def first(state):
    return state

def second(state):
    return state

def route(state, config) -> Literal["first", "second"]:
    configurable = Configuration.from_runnable_config(config)
    if state.count <= configurable.max_loops:
        return "first"
    return "second"

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_node("second", second)
builder.add_edge(START, "first")
builder.add_conditional_edges("first", route)
builder.add_edge("second", END)
`,
      `from pydantic import BaseModel, Field

class Configuration(BaseModel):
    max_loops: int = Field(default=-1)

    @classmethod
    def from_runnable_config(cls, config):
        return cls()
`,
    );
    const bound = result.graph.coverage.topology?.configurationBoundFacts[0];
    assert.ok(bound && 'defaultValue' in bound);
    assert.equal(bound.defaultValue, -1);
    assert.equal(
      result.graph.edges.find(
        (edge) => edge.from === 'workflow_step:first' && edge.to === 'workflow_step:first',
      )?.metadata['conditionalBoundDefault'],
      -1,
    );
  });
});
