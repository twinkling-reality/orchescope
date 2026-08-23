import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
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

describe('prompt provider binding boundaries', () => {
  it('keeps inference payload and headers slots distinct at one call site', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'inference-payload-slots',
        dependencies: { axios: '^1.0.0' },
      });
      workspace.write(
        'src/app.ts',
        `import axios from 'axios';

export function answer() {
  return axios.post(
    'https://api.openai.com/v1/chat/completions',
    { messages: [{ role: 'user', content: 'Answer this request.' }] },
    { headers: { Authorization: 'Bearer token' } },
  );
}
`,
      );
    });

    assert.equal(promptProjection(result).length, 1);
    assert.equal(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.scope === 'prompt_use' && /no supported text-bearing property/u.test(entry.reason),
      ),
      true,
    );
  });

  it('refuses ambiguous repeated text keys inside a prompt container', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'duplicate-prompt-keys',
        dependencies: { openai: '^5.0.0' },
      });
      workspace.write(
        'src/app.ts',
        `import OpenAI from 'openai';
const client = new OpenAI();
export const answer = () => client.chat.completions.create({
  model: 'gpt-4.1-mini',
  messages: [{ role: 'user', content: 'decoy', content: 'runtime' }],
});
`,
      );
    });

    assert.deepEqual(promptProjection(result), []);
    assert.equal(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.scope === 'prompt_use' && /ambiguous repeated text property/u.test(entry.reason),
      ),
      true,
    );
  });

  it('follows one unchanged local import and refuses reassigned or shadowed prompt bindings', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'prompt-bindings',
        dependencies: { openai: '^5.0.0' },
      });
      workspace.write(
        'src/prompts.ts',
        `export const SYSTEM = 'Answer only from the supplied evidence and state when no evidence supports the answer.';
`,
      );
      workspace.write(
        'src/app.ts',
        `import OpenAI from 'openai';
import { SYSTEM } from './prompts.js';

const client = new OpenAI();
let CHANGING = 'First instruction that must not be treated as stable.';
CHANGING = 'Second instruction that proves the binding changed.';

export async function accepted() {
  return client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'system', content: SYSTEM }],
  });
}

export async function reassigned() {
  return client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'system', content: CHANGING }],
  });
}

export async function shadowed(client: { chat: OpenAI['chat'] }) {
  return client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'system', content: 'A shadowed receiver does not prove a provider call.' }],
  });
}
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]?.displayName, 'SYSTEM');
    assert.equal(
      prompts[0]?.sourceLocations.some((location) => location.file === 'src/prompts.ts'),
      true,
    );
    assert.equal(
      result.graph.coverage.topology?.unresolved.some(
        (entry) => entry.scope === 'prompt_use' && /reassigned/u.test(entry.reason),
      ),
      true,
    );
  });

  it('does not bind a Pydantic run input through a parameter shadowing a module agent', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'pydantic-shadowed-run',
        dependencies: ['pydantic-ai>=1.0'],
      });
      workspace.write(
        'src/desk.py',
        `from pydantic_ai import Agent

agent = Agent('openai:gpt-4.1-mini')

async def answer(agent):
    return await agent.run('This belongs to the parameter, not the module agent.')
`,
      );
    });

    assert.deepEqual(promptProjection(result), []);
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'uses_prompt'),
      false,
    );
  });

  it('does not bind an OpenAI Runner input through a shadowed agent argument', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'openai-shadowed-runner',
        dependencies: ['openai-agents>=0.1'],
      });
      workspace.write(
        'src/desk.py',
        `from agents import Agent, Runner

agent = Agent(name='desk')

async def answer(agent):
    return await Runner.run(agent, 'This belongs to the parameter, not the module agent.')

async def shadowed_runner(Runner):
    return await Runner.run(agent, 'The provider callable is shadowed even though the agent is real.')
`,
      );
    });

    assert.deepEqual(promptProjection(result), []);
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'uses_prompt'),
      false,
    );
  });

  it('reads OpenAI Runner keyword input and cites import, agent binding and invocation', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'openai-runner-keywords',
        dependencies: ['openai-agents>=0.1'],
      });
      workspace.write(
        'src/desk.py',
        `from agents import Agent, Runner

agent = Agent(name='desk')

async def answer():
    return await Runner.run(starting_agent=agent, input='Answer briefly.')
`,
      );
    });

    const prompt = result.graph.components.find((component) => component.kind === 'prompt');
    assert.ok(prompt);
    const edge = result.graph.edges.find((candidate) => candidate.kind === 'uses_prompt');
    assert.ok(edge);
    const cited = result.evidence.filter((record) => edge.evidence.includes(record.id));
    assert.equal(
      cited.some((record) => record.kind === 'source_span' && record.location?.startLine === 1),
      true,
    );
    assert.equal(
      cited.some((record) => record.kind === 'source_span' && record.location?.startLine === 3),
      true,
    );
    assert.equal(
      cited.some((record) => record.kind === 'source_span' && record.location?.startLine === 6),
      true,
    );
  });

  it('rejects provider callables shadowed by function parameters', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'shadowed-provider-callables',
        dependencies: ['openai-agents>=0.1'],
      });
      writeNodeProject(workspace, {
        name: 'shadowed-provider-callables',
        dependencies: { ai: '^5.0.0' },
      });
      workspace.write(
        'src/desk.py',
        `from agents import Agent, Runner

def build(Agent, Runner):
    local = Agent(name='false', instructions='A parameter is not the provider constructor.')
    return Runner.run(local, 'A parameter is not the provider runner.')
`,
      );
      workspace.write(
        'src/desk.ts',
        `import { generateText } from 'ai';

export function answer(generateText: (input: unknown) => unknown) {
  return generateText({ system: 'A parameter is not the Vercel generation API.' });
}
`,
      );
    });

    assert.deepEqual(promptProjection(result), []);
    assert.equal(
      result.graph.components.some(
        (component) =>
          component.sourceLocations.some((location) => /src\/desk\.(py|ts)/u.test(location.file)) &&
          (component.kind === 'agent' || component.kind === 'model'),
      ),
      false,
    );
  });

  it('does not report a completed-zero prompt producer for test-only inputs', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'test-only-prompt',
        dependencies: ['pydantic-ai>=1.0'],
      });
      workspace.write(
        'tests/test_agent.py',
        `from pydantic_ai import Agent

agent = Agent('openai:gpt-4.1-mini', instructions='Test fixture instruction.')
`,
      );
    });

    assert.equal(
      result.graph.coverage.adapters.find((entry) => entry.adapterId === 'adapter:prompts')?.status,
      'not_applicable',
    );
  });

  it('does not promote configuration prompts from a test fixture', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'test-only-config-prompt',
        dependencies: ['crewai>=0.80'],
      });
      workspace.write(
        'tests/fixtures/agents.yaml',
        `reviewer:
  role: Reviewer
  goal: Review the generated test answer.
  backstory: This is configuration for a fixture, not the deployed crew.
`,
      );
    });

    assert.deepEqual(promptProjection(result), []);
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'uses_prompt'),
      false,
    );
    assert.equal(
      result.graph.coverage.adapters.find((entry) => entry.adapterId === 'adapter:prompts')?.status,
      'not_applicable',
    );
  });
});
