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

const scanPython = (source: string) => {
  const workspace = createTempWorkspace('orchescope-langgraph-receiver-py-');
  workspaces.push(workspace);
  writePythonProject(workspace, { name: 'graph-app', dependencies: ['langgraph>=1.0.0'] });
  workspace.write('src/graph.py', source);
  return scanWorkspace(workspace);
};

const scanTypeScript = (source: string) => {
  const workspace = createTempWorkspace('orchescope-langgraph-receiver-js-');
  workspaces.push(workspace);
  writeNodeProject(workspace, {
    name: 'graph-app',
    dependencies: { '@langchain/langgraph': '^1.0.0' },
  });
  workspace.write('src/graph.ts', source);
  return scanWorkspace(workspace);
};

const workflowStepNames = (result: Awaited<ReturnType<typeof scanPython>>) =>
  result.graph.components
    .filter((component) => component.kind === 'workflow_step')
    .map((component) => component.identity.localName)
    .sort();

describe('LangGraph provider and receiver identity', () => {
  it('preserves renamed and namespace constructor imports', async () => {
    const renamed = await scanPython(`from langgraph.graph import StateGraph as SG, START, END

def first(state):
    return state

builder = SG(dict)
builder.add_node("first", first)
builder.add_edge(START, "first")
builder.add_edge("first", END)
`);
    assert.deepEqual(workflowStepNames(renamed), ['first']);
    assert.equal(renamed.graph.coverage.topology?.status, 'complete');

    const namespaced = await scanTypeScript(`import * as lg from '@langchain/langgraph';
const builder = new lg.StateGraph({ channels: {} });
builder.addNode('first', first);
builder.addEdge(lg.START, 'first');
builder.addEdge('first', lg.END);
`);
    assert.deepEqual(workflowStepNames(namespaced), ['first']);
    assert.equal(namespaced.graph.coverage.topology?.status, 'complete');
  });

  it('rejects local, type-only and missing-origin graph constructor lookalikes', async () => {
    const local = await scanTypeScript(`import { START } from '@langchain/langgraph';
class StateGraph { addNode() {} }
const builder = new StateGraph();
builder.addNode('fake', fake);
void START;
`);
    assert.deepEqual(workflowStepNames(local), []);
    assert.equal(local.graph.coverage.topology?.status, 'incomplete');

    const typeOnly = await scanTypeScript(`import type { StateGraph } from '@langchain/langgraph';
const builder = new StateGraph({ channels: {} });
builder.addNode('fake', fake);
`);
    assert.deepEqual(workflowStepNames(typeOnly), []);

    const missing = await scanTypeScript(`const builder = new StateGraph({ channels: {} });
builder.addNode('fake', fake);
`);
    assert.deepEqual(workflowStepNames(missing), []);
  });

  it('refuses a verified constructor that is returned without a receiver variable', async () => {
    const result = await scanTypeScript(`import { StateGraph } from '@langchain/langgraph';
export function makeGraph() {
  return consume(new StateGraph({ channels: {} }));
}
`);
    assert.deepEqual(workflowStepNames(result), []);
    assert.equal(
      result.graph.components.some((component) => component.kind === 'workflow'),
      false,
    );
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        /not assigned to a locally verifiable graph receiver/.test(entry.reason),
      ),
    );
  });

  it('accepts methods only on the locally verified graph receiver', async () => {
    const result = await scanPython(`from langgraph.graph import StateGraph, START, END
from other_module import graph as imported_graph

def real(state):
    return state

builder = StateGraph(dict)
builder.add_node("real", real)
builder.add_edge(START, "real")
builder.add_edge("real", END)
imported_graph.add_node("fake", real)
imported_graph.add_edge("fake", "real")
`);
    assert.deepEqual(workflowStepNames(result), ['real']);
    assert.equal(
      result.graph.edges.some((edge) => edge.from.includes('fake') || edge.to.includes('fake')),
      false,
    );
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.location?.file === 'src/graph.py' && /not a locally verified/.test(entry.reason),
      ),
    );
  });

  it('does not treat a named import or same-scope shadow as a sentinel namespace', async () => {
    const namedImport = await scanPython(`from langgraph.graph import StateGraph, marker as lg

def first(state):
    return state

builder = StateGraph(dict)
builder.add_node("first", first)
builder.add_edge(lg.START, "first")
builder.add_edge("first", lg.END)
`);
    assert.equal(namedImport.graph.coverage.topology?.entryBoundaries, 0);
    assert.equal(namedImport.graph.coverage.topology?.terminalBoundaries, 0);
    assert.equal(namedImport.graph.coverage.topology?.status, 'incomplete');

    const shadowed = await scanPython(`from langgraph.graph import StateGraph
import langgraph.graph as lg

def first(state):
    return state

def build():
    lg = local_boundaries
    builder = StateGraph(dict)
    builder.add_node("first", first)
    builder.add_edge(lg.START, "first")
    builder.add_edge("first", lg.END)
    return builder
`);
    assert.equal(shadowed.graph.coverage.topology?.entryBoundaries, 0);
    assert.equal(shadowed.graph.coverage.topology?.terminalBoundaries, 0);
    assert.equal(shadowed.graph.coverage.topology?.status, 'incomplete');
  });

  it('refuses multi-builder topology instead of merging nodes or inventing cycles', async () => {
    const result = await scanPython(`from langgraph.graph import StateGraph

def first(state):
    return state

def second(state):
    return state

alpha = StateGraph(dict)
alpha.add_node("first", first)
alpha.add_edge("first", "first")

beta = StateGraph(dict)
beta.add_node("second", second)
beta.add_edge("second", "second")
`);
    assert.equal(
      result.graph.components.filter((component) => component.kind === 'workflow').length,
      2,
    );
    assert.deepEqual(workflowStepNames(result), []);
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'transitions_to'),
      false,
    );
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        /Multiple LangGraph/.test(entry.reason),
      ),
    );
  });

  it('refuses a graph receiver reassigned after its verified construction', async () => {
    const result = await scanTypeScript(`import { StateGraph } from '@langchain/langgraph';
let graph = new StateGraph({ channels: {} });
graph = replacement;
graph.addNode('fake', fake);
`);
    assert.deepEqual(workflowStepNames(result), []);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        /reassigned after construction/.test(entry.reason),
      ),
    );
  });

  it('does not extend a receiver identity into another lexical scope with the same name', async () => {
    const result =
      await scanTypeScript(`import { StateGraph, START, END } from '@langchain/langgraph';
const graph = new StateGraph({ channels: {} });
graph.addNode('real', real);
graph.addEdge(START, 'real');
graph.addEdge('real', END);

function configureOther(graph: { addNode: Function }) {
  graph.addNode('fake', fake);
}
void configureOther;
`);
    assert.deepEqual(workflowStepNames(result), ['real']);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(
      result.graph.components.some((component) => component.identity.localName === 'fake'),
      false,
    );
  });
});
