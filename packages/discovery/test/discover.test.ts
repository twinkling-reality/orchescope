import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject, writePythonProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

/**
 * End to end static discovery against a fixture repository that mixes both supported ecosystems, a
 * configured MCP server, a hand written model loop and an unsupported language.
 */

const traversal = {
  maxFileBytes: 512 * 1024,
  maxFiles: 500,
  followSymlinks: false,
  excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  excludePrefixes: [],
};

const workspaces: { dispose: () => void }[] = [];

const buildWorkspace = () => {
  const workspace = createTempWorkspace('orchescope-discover-');
  workspaces.push(workspace);
  writeNodeProject(workspace, {
    name: 'support-desk',
    dependencies: { '@openai/agents': '^0.5.0', openai: '^6.0.0' },
  });
  writePythonProject(workspace, { name: 'support-py', dependencies: ['openai-agents>=0.2', 'openai'] });

  workspace.write(
    'src/tools/account.ts',
    `import { tool } from '@openai/agents';

export const lookupAccount = tool({
  name: 'lookup_account',
  description: 'Read the account record for a customer.',
});

export const issueRefund = tool({
  name: 'issue_refund',
  description: 'Refund a charge.',
  needsApproval: true,
});
`,
  );

  workspace.write(
    'src/agents/triage.ts',
    `import { Agent } from '@openai/agents';
import { issueRefund, lookupAccount } from '../tools/account.ts';

export const triage = new Agent({
  name: 'triage',
  instructions: 'You are the triage agent. Always route to a worker and never invent an order number.',
  model: 'gpt-4o-mini',
  tools: [lookupAccount, issueRefund],
  handoffs: [],
  maxTurns: 4,
});
`,
  );

  workspace.write(
    'src/handwritten/summarize.ts',
    `import OpenAI from 'openai';

const client = new OpenAI({ timeout: 20000 });

export async function summarize(text: string) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: text }],
    temperature: 0.1,
  });
  return response;
}

export async function notifyOps(message: string) {
  await fetch('https://hooks.example.com/notify', { method: 'POST', body: message });
}
`,
  );

  workspace.write(
    'py/agents_app.py',
    `from agents import Agent, function_tool

@function_tool(name_override="check_inventory")
async def check_inventory(sku: str) -> str:
    return sku

worker = Agent(
    name="inventory-worker",
    instructions="You are the inventory worker. Answer with stock levels only.",
    tools=[check_inventory],
)
`,
  );

  workspace.write(
    '.mcp.json',
    `${JSON.stringify(
      {
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
          },
        },
      },
      null,
      2,
    )}\n`,
  );

  workspace.write(
    '.vscode/mcp.json',
    `${JSON.stringify({ servers: { docs: { url: 'https://docs.example.com/mcp' } } }, null, 2)}\n`,
  );

  workspace.write('cmd/main.go', 'package main\n\nfunc main() {}\n');
  return workspace;
};

const runDiscovery = async () => {
  const workspace = buildWorkspace();
  const clock = fixedClock(Date.parse('2026-01-01T00:00:00.000Z'), 1);
  const handle = createDeadline(30_000, clock.monotonicMs);
  try {
    return {
      workspace,
      result: await discover({
        root: workspace.root,
        orchescopeVersion: '0.1.0',
        clock,
        deadline: handle,
        traversal,
        concurrency: 4,
      }),
    };
  } finally {
    handle.dispose();
  }
};

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

describe('static discovery', () => {
  it('discovers agents, tools, models and MCP servers across both ecosystems', async () => {
    const { result } = await runDiscovery();
    const ids = result.graph.components.map((component) => component.id);

    assert.ok(result.agentSystemDetected, 'an agent system should be detected');
    assert.ok(ids.includes('agent:triage'), `expected agent:triage in ${ids.join(', ')}`);
    assert.ok(ids.includes('tool:lookup_account'), 'expected the lookup_account tool');
    assert.ok(ids.includes('tool:issue_refund'), 'expected the issue_refund tool');
    assert.ok(ids.includes('agent:inventory-worker'), 'expected the Python agent');
    assert.ok(ids.includes('tool:check_inventory'), 'expected the decorated Python tool');
    assert.ok(ids.includes('mcp_server:github'), 'expected the mcpServers entry');
    assert.ok(ids.includes('mcp_server:docs'), 'expected the VS Code servers entry');
    assert.ok(
      ids.some((id) => id.startsWith('model:')),
      'expected at least one model component',
    );
    assert.ok(ids.includes('provider:openai'), 'expected the openai provider');
  });

  it('links an agent to tools defined in another module', async () => {
    const { result } = await runDiscovery();
    const edges = result.graph.edges.filter((edge) => edge.from === 'agent:triage');
    const kinds = edges.map((edge) => `${edge.kind}:${edge.to}`);
    assert.ok(kinds.includes('calls_tool:tool:lookup_account'), `edges were ${kinds.join(', ')}`);
    assert.ok(kinds.includes('calls_tool:tool:issue_refund'));
    assert.ok(kinds.some((entry) => entry.startsWith('invokes_model:')));
  });

  it('records the retry ceiling declared on the agent', async () => {
    const { result } = await runDiscovery();
    const modelEdge = result.graph.edges.find(
      (edge) => edge.from === 'agent:triage' && edge.kind === 'invokes_model',
    );
    assert.equal(modelEdge?.policy?.retry?.maxAttempts, 4);
    assert.equal(modelEdge?.policy?.retry?.bounded, true);
  });

  it('classifies an outbound POST as an effect with an unresolved idempotency status', async () => {
    const { result } = await runDiscovery();
    const service = result.graph.components.find(
      (component) => component.kind === 'external_service',
    );
    assert.ok(service, 'expected an external service component');
    assert.equal(service.details?.for, 'external_service');
    assert.ok(
      ['non_idempotent_write', 'unknown', 'external_notification'].includes(service.sideEffect ?? ''),
      `unexpected effect class ${service.sideEffect}`,
    );
    assert.equal(service.permissions[0]?.kind, 'network');
  });

  it('gives every component evidence and a location', async () => {
    const { result } = await runDiscovery();
    for (const component of result.graph.components) {
      assert.ok(component.evidence.length > 0, `${component.id} has no evidence`);
      assert.ok(
        component.sourceLocations.length > 0 || component.configLocations.length > 0,
        `${component.id} has no location`,
      );
      assert.ok(component.discoveredBy.length > 0, `${component.id} has no producer`);
    }
    const evidenceIds = new Set(result.evidence.map((record) => record.id));
    for (const component of result.graph.components) {
      for (const reference of component.evidence) {
        assert.ok(evidenceIds.has(reference), `dangling evidence reference ${reference}`);
      }
    }
  });

  it('reports adapter coverage and unsupported languages honestly', async () => {
    const { result } = await runDiscovery();
    const coverage = result.graph.coverage;
    assert.ok(coverage.filesParsed > 0);
    assert.ok(coverage.adapters.length >= 5);
    const applied = coverage.adapters.filter((entry) => entry.status === 'completed');
    assert.ok(applied.some((entry) => entry.adapterId === 'adapter:openai-agents'));
    assert.ok(applied.some((entry) => entry.adapterId === 'adapter:mcp'));
    assert.ok(
      coverage.adapters.some((entry) => entry.status === 'not_applicable'),
      'adapters that do not apply must be recorded',
    );
    assert.ok(
      coverage.unsupported.some((entry) => entry.area.includes('go')),
      `expected Go to be reported as unsupported, got ${JSON.stringify(coverage.unsupported)}`,
    );
    assert.equal(coverage.languages.some((entry) => entry.language === 'python'), true);
  });

  it('notes that an MCP entry with a placeholder cannot be fully resolved', async () => {
    const { result } = await runDiscovery();
    const mcpRun = result.graph.coverage.adapters.find((entry) => entry.adapterId === 'adapter:mcp');
    assert.match(mcpRun?.detail ?? '', /placeholder/);
    const server = result.graph.components.find((component) => component.id === 'mcp_server:github');
    assert.deepEqual(server?.metadata['unresolvedPlaceholders'], ['GITHUB_TOKEN']);
  });

  it('produces the same graph identity for two scans of the same tree', async () => {
    const first = await runDiscovery();
    const second = await discover({
      root: first.workspace.root,
      orchescopeVersion: '0.1.0',
      clock: fixedClock(Date.parse('2026-01-01T00:00:00.000Z'), 1),
      deadline: createDeadline(30_000, fixedClock(0, 1).monotonicMs),
      traversal,
      concurrency: 4,
    });
    assert.deepEqual(
      second.graph.components.map((component) => component.id),
      first.result.graph.components.map((component) => component.id),
    );
    assert.equal(second.graph.graphId, first.result.graph.graphId);
  });
});
