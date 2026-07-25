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
