import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { indexGraph, topologyRequirements } from '@orchescope/graph';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject, writePythonProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

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
  const workspace = createTempWorkspace('orchescope-prompt-');
  workspaces.push(workspace);
  build(workspace);
  const clock = fixedClock(0);
  const handle = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'fixture',
      orchescopeVersion: '0.1.0',
      clock,
      deadline: handle,
      traversal,
      concurrency: 4,
    });
  } finally {
    handle.dispose();
  }
};

const promptProjection = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components
    .filter((component) => component.kind === 'prompt')
    .map((component) => ({
      id: component.id,
      displayName: component.displayName,
      details: component.details,
      metadata: component.metadata,
    }));

describe('semantic prompt producer contracts', () => {
  it('keeps a computed prompt refusal out of complete LangGraph control-flow coverage', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'scoped-prompt-topology',
        dependencies: ['langchain>=1.2', 'langgraph>=1.1'],
      });
      workspace.write(
        'src/app.py',
        `from langchain.agents import create_agent
from langgraph.graph import StateGraph, START, END

assistant = create_agent(
    model="openai:gpt-4.1-mini",
    tools=[],
    name="assistant",
    system_prompt=load_prompt("assistant"),
)

builder = StateGraph(dict)
builder.add_node("assistant", assistant)
builder.add_edge(START, "assistant")
builder.add_edge("assistant", END)
`,
      );
    });

    assert.equal(
      result.graph.coverage.topology?.producers.some(
        (producer) => producer.scope === 'prompt_use' && producer.status === 'incomplete',
      ),
      true,
    );
    assert.equal(
      result.graph.coverage.unsupported.some(
        (entry) =>
          entry.kind === 'topology_incomplete' &&
          entry.scope === 'prompt_use' &&
          entry.area.startsWith('prompt use:'),
      ),
      true,
    );
    assert.equal(topologyRequirements(indexGraph(result.graph)).status, 'complete');
  });

  it('refuses spread-backed message populations instead of treating their visible items as complete', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'spread-messages',
        dependencies: { openai: '^5.0.0' },
      });
      workspace.write(
        'src/app.ts',
        `import OpenAI from 'openai';

const client = new OpenAI();
const inherited = [{ role: 'system', content: 'Unresolved inherited instruction.' }];
export async function answer() {
  return client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [...inherited, { role: 'user', content: 'Visible but incomplete instruction.' }],
  });
}
`,
      );
    });

    assert.deepEqual(promptProjection(result), []);
    assert.equal(
      result.graph.coverage.topology?.unresolved.some(
        (entry) => entry.scope === 'prompt_use' && /spread/u.test(entry.reason),
      ),
      true,
    );
  });

  it('records hidden prompt channels behind JavaScript spread and sole Python kwargs', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'hidden-prompt-properties',
        dependencies: { openai: '^5.0.0' },
      });
      writePythonProject(workspace, {
        name: 'hidden-prompt-properties',
        dependencies: ['pydantic-ai>=1.0'],
      });
      workspace.write(
        'src/app.ts',
        `import OpenAI from 'openai';

const client = new OpenAI();
export const answer = (options: object) =>
  client.responses.create({ model: 'gpt-4.1-mini', ...options });
`,
      );
      workspace.write(
        'src/desk.py',
        `from pydantic_ai import Agent

options = load_options()
desk = Agent(**options)
`,
      );
    });

    assert.deepEqual(promptProjection(result), []);
    const refusals =
      result.graph.coverage.topology?.unresolved.filter((entry) => entry.scope === 'prompt_use') ??
      [];
    assert.equal(refusals.length, 4);
    assert.equal(
      refusals.some((entry) => /adapter:model-sdk input/u.test(entry.reason)),
      true,
    );
    assert.equal(
      refusals.some((entry) => /adapter:pydantic-ai system_prompt/u.test(entry.reason)),
      true,
    );
  });
});
