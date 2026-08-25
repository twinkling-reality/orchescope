import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>) => {
  const workspace = createTempWorkspace('orchescope-deep-agents-');
  workspaces.push(workspace);
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'deep-agents-fixture',
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
    });
  } finally {
    deadline.dispose();
  }
};

const deepAgents = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components.filter(
    (component) =>
      component.kind === 'agent' && component.discoveredBy.includes('adapter:deep-agents'),
  );

describe('Deep Agents exact factory provenance', () => {
  it('discovers the exact agent, literal model and direct local tools', async () => {
    const result = await scan({
      'src/app.py': `from deepagents import create_deep_agent

def research():
    return "facts"

writer = create_deep_agent(
    model="anthropic:claude-sonnet-4-5",
    tools=[research],
    name="speechwriter",
    subagents=[],
    skills=[],
    permissions=[],
)
writer.invoke({"messages": []})
`,
    });

    assert.deepEqual(
      deepAgents(result).map((component) => component.id),
      ['agent:speechwriter'],
    );
    assert.ok(result.graph.components.some((component) => component.id === 'tool:research'));
    assert.ok(
      result.graph.components.some(
        (component) => component.id === 'model:anthropic/claude-sonnet-4-5',
      ),
    );
    assert.ok(result.graph.components.some((component) => component.id === 'provider:anthropic'));
    assert.deepEqual(
      result.graph.edges
        .filter((edge) => edge.discoveredBy.includes('adapter:deep-agents'))
        .map((edge) => edge.kind)
        .sort(),
      ['calls_tool', 'invokes_model', 'served_by_provider'],
    );
    const run = result.graph.coverage.adapters.find(
      (candidate) => candidate.adapterId === 'adapter:deep-agents',
    );
    assert.equal(run?.status, 'completed');
    assert.equal(run?.applicability?.relevantImports, 1);
  });

  it('preserves direct aliases and namespace imports by exact exported identity', async () => {
    const result = await scan({
      'src/alias.py': `from deepagents import create_deep_agent as build_agent

alias_agent = build_agent(model="openai:gpt-5", tools=[])
`,
      'src/namespace.py': `import deepagents as da

namespace_agent = da.create_deep_agent(model="openai:gpt-5", tools=[])
`,
    });

    assert.deepEqual(
      deepAgents(result)
        .map((component) => component.id)
        .sort(),
      ['agent:alias_agent', 'agent:namespace_agent'],
    );
  });

  it('keeps same-name assigned agents in their exact lexical scopes', async () => {
    const result = await scan({
      'src/factories.py': `from deepagents import create_deep_agent

def build_baseline(model):
    agent = create_deep_agent(model=model, tools=[])
    return agent

def build_researcher(model):
    agent = create_deep_agent(model=model, tools=[])
    return agent
`,
    });

    assert.deepEqual(
      deepAgents(result)
        .map((component) => component.id)
        .sort(),
      ['agent:build_baseline.agent', 'agent:build_researcher.agent'],
    );
  });

  it('rejects wrong, local, type-only and parameter-shadowed lookalikes', async () => {
    const result = await scan({
      'src/deepagents.py': `def create_deep_agent(**kwargs):
    return kwargs
`,
      'src/local.py': `from deepagents import create_deep_agent
local = create_deep_agent(model="openai:gpt-5", tools=[])
`,
      'src/wrong.py': `from another_package import create_deep_agent
wrong = create_deep_agent(model="openai:gpt-5", tools=[])
`,
      'src/type_only.py': `from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from deepagents import create_deep_agent
typed = create_deep_agent(model="openai:gpt-5", tools=[])
`,
      'src/shadow.py': `from deepagents import create_deep_agent

def build(create_deep_agent):
    return create_deep_agent(model="openai:gpt-5", tools=[])
`,
    });

    assert.deepEqual(deepAgents(result), []);
  });

  it('retains the target-shaped agent and source-locates every computed endpoint refusal', async () => {
    const result = await scan({
      'src/agent.py': `from deepagents import create_deep_agent

def build_agent(settings, model, sandbox):
    agent = create_deep_agent(
        model=model,
        tools=[],
        system_prompt=orchestrator_prompt(settings),
        subagents=build_subagents(settings, permissions=sandbox),
        skills=[settings.skills_vpath],
        permissions=sandbox,
        name="speechwriter",
    )
    return agent
`,
      'src/memory.py': `from typing import Callable

def _paginate(fetch: Callable[[int, int], list], offset: int = 0):
    page = fetch(100, offset)
    return page
`,
    });

    assert.deepEqual(
      deepAgents(result).map((component) => component.id),
      ['agent:speechwriter'],
    );
    assert.equal(
      result.graph.components.some((component) => component.kind === 'external_service'),
      false,
    );
    const topology = result.graph.coverage.topology;
    const deepProducer = topology?.producers.find(
      (producer) => producer.adapterId === 'adapter:deep-agents',
    );
    assert.deepEqual(deepProducer, {
      adapterId: 'adapter:deep-agents',
      status: 'incomplete',
      inspectedInputs: 1,
      relationsFound: 0,
    });
    const refusals = topology?.unresolved.filter((refusal) =>
      refusal.reason.includes('create_deep_agent'),
    );
    assert.equal(refusals?.length, 5);
    assert.deepEqual(refusals?.map((refusal) => refusal.kind).sort(), [
      'entry_boundary',
      'explicit_relation',
      'explicit_relation',
      'explicit_relation',
      'explicit_relation',
    ]);
    assert.deepEqual(
      refusals
        ?.map((refusal) => refusal.location?.startLine)
        .sort((left, right) => (left ?? 0) - (right ?? 0)),
      [4, 5, 8, 9, 10],
    );
  });
});
