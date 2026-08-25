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
  const workspace = createTempWorkspace('orchescope-unclaimed-construction-');
  workspaces.push(workspace);
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'unclaimed-construction-fixture',
      orchescopeVersion: '0.9.2',
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

const unclaimed = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.coverage.unsupported.filter(
    (area) => area.kind === 'unclaimed_imported_construction',
  );

const agentIdentities = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components
    .filter((component) => component.kind === 'agent')
    .map((component) => component.id);

describe('unclaimed imported constructions', () => {
  it('records a Python factory whose distribution no adapter claims', async () => {
    const result = await scan({
      'src/app.py': `from unknown_agents import Factory

runtime = Factory(tools=[search], model=model)
`,
    });

    assert.equal(result.agentSystemDetected, false);
    assert.deepEqual(agentIdentities(result), []);
    assert.equal(unclaimed(result).length, 1);
    const area = unclaimed(result)[0];
    assert.equal(
      area?.area,
      'unknown_agents.Factory is constructed at src/app.py:3 and no adapter claims that distribution',
    );
    assert.equal(area?.location?.file, 'src/app.py');
    assert.equal(area?.location?.startLine, 3);
    assert.equal(typeof area?.location?.fileHash, 'string');
    assert.match(area?.reason ?? '', /does not invent an agent identity/);
  });

  it('records a JavaScript construction whose object keys carry both populations', async () => {
    const result = await scan({
      'src/app.ts': `import { Factory } from 'unknown-agents';

export const runtime = new Factory({ tools, model });
`,
    });

    assert.equal(result.agentSystemDetected, false);
    assert.deepEqual(agentIdentities(result), []);
    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown-agents.Factory is constructed at src/app.ts:3 and no adapter claims that distribution',
    );
    assert.equal(unclaimed(result)[0]?.location?.startLine, 3);
  });

  it('records renamed and namespace imports by the exported name', async () => {
    const result = await scan({
      'src/alias.py': `from unknown_agents import Factory as Build

alias = Build(toolset=tools, llm=model)
`,
      'src/namespace.py': `import unknown_agents as ua

namespace = ua.Factory(tools=tools, chat_model=model)
`,
    });

    assert.deepEqual(
      unclaimed(result)
        .map((area) => area.area)
        .sort(),
      [
        'unknown_agents.Factory is constructed at src/alias.py:3 and no adapter claims that distribution',
        'unknown_agents.Factory is constructed at src/namespace.py:3 and no adapter claims that distribution',
      ],
    );
  });

  it('stays quiet when nothing is constructed', async () => {
    const result = await scan({
      'src/app.py': `from unknown_agents import Factory
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.equal(result.agentSystemDetected, false);
  });

  it('stays quiet for an ordinary web application', async () => {
    const result = await scan({
      'src/app.py': `from flask import Flask

app = Flask(__name__)

@app.get("/")
def index():
    return "ok"
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.equal(result.agentSystemDetected, false);
  });

  it('stays quiet for a claimed framework that already has a reader', async () => {
    const result = await scan({
      'src/agent.py': `from pydantic_ai import Agent

support = Agent("openai:gpt-4o")
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.ok(agentIdentities(result).includes('agent:support'));
    assert.equal(result.agentSystemDetected, true);
  });

  it('leaves a claimed LangGraph factory on its adapter rather than this gap', async () => {
    const result = await scan({
      'src/graph.py': `from langgraph.prebuilt import create_react_agent

graph = create_react_agent(model="openai:gpt-4o", tools=[])
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.equal(
      result.graph.coverage.unsupported.some(
        (area) => area.kind === 'unclaimed_imported_construction',
      ),
      false,
    );
  });

  it('stays quiet for a type-only import', async () => {
    const result = await scan({
      'src/app.py': `from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from unknown_agents import Factory

runtime = Factory(tools=[], model="x")
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('stays quiet for a local sibling module', async () => {
    const result = await scan({
      'src/unknown_agents.py': `def Factory(**kwargs):
    return kwargs
`,
      'src/app.py': `from unknown_agents import Factory

runtime = Factory(tools=[], model="x")
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.deepEqual(agentIdentities(result), []);
  });

  it('stays quiet for a relative JavaScript module', async () => {
    const result = await scan({
      'src/local-agents.ts': `export class Factory {}
`,
      'src/app.ts': `import { Factory } from './local-agents.ts';

export const runtime = new Factory({ tools: [], model: 'x' });
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('stays quiet for a model wrapper that names only a model identifier', async () => {
    const result = await scan({
      'src/model.py': `from unknown_agents import LiteLLMModel

model = LiteLLMModel(model_id="ollama_chat/qwen2.5")
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.deepEqual(agentIdentities(result), []);
  });

  it('stays quiet for a local class that happens to be named Agent', async () => {
    const result = await scan({
      'src/app.py': `class Agent:
    def __init__(self, tools, model):
        self.tools = tools
        self.model = model

runtime = Agent(tools=[], model="x")
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.deepEqual(agentIdentities(result), []);
  });

  it('stays quiet inside test files', async () => {
    const result = await scan({
      'tests/test_app.py': `from unknown_agents import Factory

runtime = Factory(tools=[], model="x")
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('stays quiet for an OpenAI-style tool-schema payload', async () => {
    const result = await scan({
      'src/client.py': `from unknown_llm import completion

completion(
    model="gpt-4o",
    tools=[{"type": "function", "function": {"name": "search"}}],
)
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.deepEqual(agentIdentities(result), []);
  });

  it('does not mint an agent from the argument names alone', async () => {
    const result = await scan({
      'src/app.py': `from unknown_agents import Agent, Tool, CodeAgent

agent = Agent(tools=[Tool()], model="x")
other = CodeAgent(tools=tools, model=model)
`,
    });

    assert.deepEqual(agentIdentities(result), []);
    assert.equal(result.agentSystemDetected, false);
    assert.equal(unclaimed(result).length, 2);
    assert.ok(result.graph.components.every((component) => component.kind !== 'agent'));
  });
});
