import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writePythonProject } from '@orchescope/testkit';
import { modelSdkAdapter } from '../src/adapters/model-sdk.ts';
import { searchIndexAdapter } from '../src/adapters/search-index.ts';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (source: string) => {
  const workspace = createTempWorkspace('orchescope-nested-module-binding-');
  workspaces.push(workspace);
  writePythonProject(workspace, {
    name: 'nested-bindings',
    dependencies: ['openai>=1.0', 'tavily-python>=0.7'],
  });
  workspace.write('src/app.py', source);
  const clock = fixedClock(0);
  const deadline = createDeadline(30_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'nested-bindings',
      orchescopeVersion: '0.9.0',
      clock,
      deadline,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 50,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 2,
      adapters: [modelSdkAdapter, searchIndexAdapter],
    });
  } finally {
    deadline.dispose();
  }
};

describe('nested module binding authority', () => {
  it('keeps real global SDK receivers and rejects a containing parameter with the same name', async () => {
    const result = await scan(`from openai import OpenAI

client = OpenAI()

def valid():
    return client.responses.create(model="real-global", input="hello")

def outer(client):
    def nested():
        return client.responses.create(model="false-nested-receiver", input="hello")
    return nested()
`);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('model:openai/real-global'));
    assert.equal(ids.includes('model:openai/false-nested-receiver'), false);
  });

  it('keeps a real global search receiver and rejects a containing parameter fallback', async () => {
    const result = await scan(`from tavily import TavilyClient

search = TavilyClient()

def valid():
    return search.search("real global query")

def outer(search):
    def nested():
        return search.search("false nested query")
    return nested()
`);
    const queries = result.graph.edges.filter((edge) => edge.kind === 'queries_retrieval');
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.sourceLocations.some((location) => location.startLine === 6));
    assert.equal(
      queries[0]?.sourceLocations.some((location) => location.startLine === 10),
      false,
    );
  });
});
