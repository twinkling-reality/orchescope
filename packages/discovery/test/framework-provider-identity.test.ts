import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject } from '@orchescope/testkit';
import { crewAiAdapter } from '../src/adapters/crewai.ts';
import { mcpAdapter } from '../src/adapters/mcp.ts';
import { openAiAgentsAdapter } from '../src/adapters/openai-agents.ts';
import { pydanticAiAdapter } from '../src/adapters/pydantic-ai.ts';
import { vercelAiSdkAdapter } from '../src/adapters/vercel-ai-sdk.ts';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (sources: Readonly<Record<string, string>>) => {
  const workspace = createTempWorkspace('orchescope-framework-provider-');
  workspaces.push(workspace);
  writeNodeProject(workspace, {
    name: 'framework-providers',
    dependencies: {
      '@modelcontextprotocol/sdk': '^1.0.0',
      '@openai/agents': '^0.3.0',
      ai: '^5.0.0',
      crewai: '^0.80.0',
      'pydantic-ai': '^1.0.0',
    },
  });
  for (const [file, source] of Object.entries(sources)) workspace.write(file, source);
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
      adapters: [
        mcpAdapter,
        openAiAgentsAdapter,
        crewAiAdapter,
        pydanticAiAdapter,
        vercelAiSdkAdapter,
      ],
    });
  } finally {
    deadline.dispose();
  }
};

const identities = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components.map((component) => `${component.kind}:${component.identity.localName}`);

describe('framework runtime provider identity', () => {
  it('preserves imported aliases and registrations on verified local framework receivers', async () => {
    const result = await scan({
      'src/frameworks.ts': `import { Server as ProtocolServer } from '@modelcontextprotocol/sdk/server/index.js';
import { Agent as OpenAgent, tool as openTool } from '@openai/agents';
import { tool as defineTool, generateText as generate } from 'ai';

const server = new ProtocolServer({ name: 'protocol-server' });
server.registerTool('protocol_lookup', { description: 'lookup' }, () => ({}));

const openLookup = openTool({ name: 'open_lookup', execute: () => ({}) });
new OpenAgent({ name: 'open-agent', tools: [openLookup] });

const vercelLookup = defineTool({ description: 'lookup', execute: () => ({}) });
export async function runVercel() {
  return generate({ model: 'test-model', tools: { vercelLookup } });
}
`,
      'src/frameworks.py': `from agents import function_tool as ft
from crewai import Agent as CrewAgent, Crew as CrewGroup
from pydantic_ai import Agent as TypedAgent

@ft
def decorated_lookup():
    return "ok"

crew_agent = CrewAgent(role="crew-worker", goal="work")
crew = CrewGroup(agents=[crew_agent])
typed_agent = TypedAgent("test:model", name="typed-agent")
`,
    });
    const found = identities(result);
    for (const expected of [
      'mcp_server:protocol-server',
      'tool:protocol_lookup',
      'tool:open_lookup',
      'agent:open-agent',
      'tool:decorated_lookup',
      'agent:crew-worker',
      'agent_group:crew',
      'agent:typed-agent',
      'tool:vercellookup',
    ]) {
      assert.ok(found.includes(expected), `missing ${expected} in ${found.join(', ')}`);
    }
    const versions = new Map(
      result.graph.coverage.adapters.map((adapter) => [adapter.adapterId, adapter.adapterVersion]),
    );
    assert.equal(versions.get('adapter:mcp'), '2');
    assert.equal(versions.get('adapter:openai-agents'), '2');
    assert.equal(versions.get('adapter:crewai'), '2');
    assert.equal(versions.get('adapter:pydantic-ai'), '2');
    assert.equal(versions.get('adapter:vercel-ai-sdk'), '2');
  });

  it('rejects same-name constructors, functions and methods from local or unrelated providers', async () => {
    const result = await scan({
      'src/lookalikes.ts': `import { marker } from '@openai/agents';
import { marker as mcpMarker } from '@modelcontextprotocol/sdk';
import { marker as aiMarker } from 'ai';

class Agent {}
class Server { registerTool() {} }
const tool = () => ({});
const embed = () => ({});

const server = new Server();
server.registerTool('false_protocol_tool');
new Agent();
tool({ name: 'false_tool' });
embed({ model: 'false-model' });
void marker;
void mcpMarker;
void aiMarker;
`,
      'src/lookalikes.py': `from crewai import Process
from pydantic_ai import RunContext

class Agent:
    pass

def tool(fn):
    return fn

Agent()

@tool
def false_decorated_tool():
    return "no"

_ = Process
_ = RunContext
`,
    });
    const found = identities(result).join(',');
    for (const falseName of [
      'false_protocol_tool',
      'false_tool',
      'false-model',
      'false_decorated_tool',
    ]) {
      assert.doesNotMatch(found, new RegExp(falseName));
    }
    assert.equal(result.graph.components.length, 0);
  });
});
