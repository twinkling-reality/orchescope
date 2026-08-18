import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import {
  componentDraft,
  createTempWorkspace,
  edgeDraft,
  writeNodeProject,
  writePythonProject,
} from '@orchescope/testkit';
import type { AgentSystemAdapter } from '../src/adapter.ts';
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
  writePythonProject(workspace, {
    name: 'support-py',
    dependencies: ['openai-agents>=0.2', 'openai'],
  });

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
            // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture references an environment variable in this exact form
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

/** One scan of a workspace the caller built, for the cases that need their own repository. */
const scanWorkspace = async (workspace: ReturnType<typeof createTempWorkspace>) => {
  const clock = fixedClock(Date.parse('2026-01-01T00:00:00.000Z'), 1);
  const handle = createDeadline(30_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
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
      ['non_idempotent_write', 'unknown', 'external_notification'].includes(
        service.sideEffect ?? '',
      ),
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
      coverage.unsupported.some(
        (entry) => entry.kind === 'language_not_analysed' && entry.area.includes('go'),
      ),
      `expected Go to be reported as unsupported, got ${JSON.stringify(coverage.unsupported)}`,
    );
    assert.equal(
      coverage.languages.some((entry) => entry.language === 'python'),
      true,
    );
  });

  it('notes that an MCP entry with a placeholder cannot be fully resolved', async () => {
    const { result } = await runDiscovery();
    const mcpRun = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:mcp',
    );
    assert.match(mcpRun?.detail ?? '', /placeholder/);
    const server = result.graph.components.find(
      (component) => component.id === 'mcp_server:github',
    );
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

/**
 * The three unsupported areas have three different owners, and the corpus harness holds them apart, so the
 * discriminator each one carries is asserted here rather than left to be read out of the prose.
 */
/**
 * What an adapter read, measured from the files rather than declared on the adapter.
 *
 * The fact model is language neutral, so one adapter covers a framework in both ecosystems and any
 * ecosystem it declared in advance was wrong for half the repositories it ran on. Six of twelve declared
 * `javascript`, so a Python majority repository was told by its own coverage block, adapter by adapter,
 * that JavaScript had been read.
 */
describe('the languages an adapter run reports', () => {
  it('are the ones its files are written in', async () => {
    const workspace = createTempWorkspace('orchescope-languages-');
    workspaces.push(workspace);
    writePythonProject(workspace, { name: 'python-only', dependencies: ['openai'] });
    workspace.write(
      'src/ask.py',
      `from openai import AsyncOpenAI

client = AsyncOpenAI()


async def answer(prompt: str):
    return await client.chat.completions.create(model="gpt-4o", messages=[])
`,
    );
    const result = await scanWorkspace(workspace);
    const modelSdk = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:model-sdk',
    );
    assert.equal(modelSdk?.status, 'completed');
    assert.deepEqual(modelSdk?.languages, ['python']);
  });

  it('are empty for an adapter that did not apply, rather than a language it never read', async () => {
    const workspace = createTempWorkspace('orchescope-languages-none-');
    workspaces.push(workspace);
    writePythonProject(workspace, { name: 'python-only', dependencies: ['openai'] });
    workspace.write('src/ask.py', 'value = 1\n');
    const result = await scanWorkspace(workspace);
    const idle = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:langgraph',
    );
    assert.equal(idle?.status, 'not_applicable');
    assert.deepEqual(idle?.languages, []);
  });
});

describe('a relation whose endpoint the adapter never added', () => {
  const scanWithAdapter = async (adapter: AgentSystemAdapter) => {
    const workspace = createTempWorkspace('orchescope-discard-');
    workspaces.push(workspace);
    writeNodeProject(workspace, { name: 'plain-app' });
    workspace.write('src/index.ts', 'export const value = 1;\n');
    const clock = fixedClock(0, 1);
    const handle = createDeadline(30_000, clock.monotonicMs);
    try {
      return await discover({
        root: workspace.root,
        orchescopeVersion: '0.1.0',
        clock,
        deadline: handle,
        traversal,
        concurrency: 4,
        adapters: [adapter],
      });
    } finally {
      handle.dispose();
    }
  };

  const stub = (discoverEdge: boolean): AgentSystemAdapter => ({
    id: 'adapter:stub',
    version: '1',
    packages: [],
    appliesTo: () => true,
    discover: (_context, builder) => {
      const of = (kind: 'agent' | 'tool', name: string) =>
        componentDraft({ kind, name, file: 'src/index.ts', discoveredBy: 'adapter:stub' });
      const agent = of('agent', 'triage');
      const missing = of('tool', 'ghost');
      builder.addComponent(agent);
      if (discoverEdge) {
        builder.addEdge(edgeDraft('calls_tool', agent, missing, { discoveredBy: 'adapter:stub' }));
      }
      return { componentsFound: 1, edgesFound: discoverEdge ? 1 : 0, filesInspected: ['src/x.ts'] };
    },
  });

  it('is reported as a discarded relation naming the adapter that produced it', async () => {
    const result = await scanWithAdapter(stub(true));
    const discarded = result.graph.coverage.unsupported.filter(
      (area) => area.kind === 'discarded_relation',
    );
    assert.equal(discarded.length, 1, JSON.stringify(result.graph.coverage.unsupported));
    assert.match(discarded[0]?.area ?? '', /adapter:stub/);
    assert.equal(result.graph.edges.length, 0);
  });

  it('reports nothing when every endpoint exists', async () => {
    const result = await scanWithAdapter(stub(false));
    assert.deepEqual(
      result.graph.coverage.unsupported.filter((area) => area.kind === 'discarded_relation'),
      [],
    );
  });
});

/**
 * `filesParsed` over `filesDiscovered` reads as a coverage rate and measures something else. A repository of 1233
 * test fixtures and 598 Python files reported a third when every Python file in it had been read, so the coverage
 * report carries the denominator that means what a reader assumes it means.
 */
describe('how much of what this build reads was read', () => {
  it('counts a file this build claims to read and could not, and excludes one it never claimed', async () => {
    const workspace = createTempWorkspace('orchescope-coverage-');
    workspaces.push(workspace);
    writeNodeProject(workspace, { name: 'mixed' });
    workspace.write('src/small.ts', 'export const value = 1;\n');
    workspace.write('src/big.ts', `export const text = '${'x'.repeat(2048)}';\n`);
    workspace.write('fixtures/cassette.yaml', `recorded: ${'y'.repeat(2048)}\n`);
    const clock = fixedClock(0, 1);
    const handle = createDeadline(30_000, clock.monotonicMs);
    try {
      const result = await discover({
        root: workspace.root,
        orchescopeVersion: '0.1.0',
        clock,
        deadline: handle,
        traversal: { ...traversal, maxFileBytes: 1024 },
        concurrency: 4,
      });
      const coverage = result.graph.coverage;
      assert.equal(coverage.filesParsed, 1, 'only the small TypeScript file could be parsed');
      assert.equal(
        coverage.filesInSupportedLanguages,
        2,
        'the TypeScript file that was too large is still a file this build claims to read',
      );
      assert.ok(
        coverage.filesDiscovered >= 2,
        'the YAML fixture is discovered and is not a file this build claims to read',
      );
    } finally {
      handle.dispose();
    }
  });
});

/**
 * A bundle in a directory the exclusion list does not know about.
 *
 * Across a sweep of thirty six repositories the retry rules produced no true positive, and two of their
 * three matches were inside build artifacts: `.docs-out/js` and `packages/extension/media/assets`. Neither
 * name is on the default exclusion list and neither ever will be, because the list is by directory name
 * and a project can call its output anything. The minifier symbols those matches raised became real
 * components: `entrypoint:jy` was counted in the inventory and named in a finding.
 */
describe('build output that no exclusion list knows the name of', () => {
  it('raises no component, and says why it was set aside', async () => {
    const workspace = createTempWorkspace('orchescope-generated-');
    workspaces.push(workspace);
    writeNodeProject(workspace, { name: 'bundled', dependencies: { openai: '^6.0.0' } });
    const packed = Array.from(
      { length: 60 },
      (_unused, index) =>
        `function ${String.fromCharCode(97 + (index % 26))}${index}(e,t,n){var r=e[t];try{for(var i=0;i<n;i++){r=r(i)}}catch(o){return o}return r}`,
    ).join('');
    workspace.write(
      '.docs-out/js/39.06467a79.js',
      `!function(e,t){"use strict";${packed}}(0,0);\n`,
    );
    const clock = fixedClock(0, 1);
    const handle = createDeadline(30_000, clock.monotonicMs);
    try {
      const result = await discover({
        root: workspace.root,
        orchescopeVersion: '0.1.0',
        clock,
        deadline: handle,
        traversal,
        concurrency: 4,
      });
      assert.deepEqual(
        result.graph.components.map((component) => component.id),
        [],
        'a minifier symbol must never become a component',
      );
      const skipped = result.graph.coverage.skipped.find(
        (entry) => entry.file === '.docs-out/js/39.06467a79.js',
      );
      assert.ok(skipped !== undefined, 'setting a file aside silently is the failure this avoids');
      assert.equal(skipped.reason, 'generated');
      assert.match(skipped.detail ?? '', /minifier/);
      assert.equal(result.graph.coverage.filesParsed, 0);
    } finally {
      handle.dispose();
    }
  });
});
