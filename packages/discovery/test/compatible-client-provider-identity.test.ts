import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writePythonProject } from '@orchescope/testkit';
import { modelSdkAdapter } from '../src/adapters/model-sdk.ts';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (source: string) => {
  const workspace = createTempWorkspace('orchescope-compatible-provider-');
  workspaces.push(workspace);
  writePythonProject(workspace, { name: 'compatible-provider', dependencies: ['openai>=1.0'] });
  workspace.write('src/app.py', source);
  const clock = fixedClock(0);
  const deadline = createDeadline(30_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'compatible-provider',
      orchescopeVersion: '0.9.1',
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
      adapters: [modelSdkAdapter],
    });
  } finally {
    deadline.dispose();
  }
};

describe('compatible client provider identity', () => {
  it('names an alternate provider only from its exact recognized endpoint', async () => {
    const result = await scan(`from openai import OpenAI

client = OpenAI(base_url="https://api.groq.com/openai/v1")

def answer():
    return client.chat.completions.create(model="llama-3.3-70b-versatile", messages=[])
`);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('provider:groq'), ids.join(', '));
    assert.ok(ids.includes('model:groq/llama-3.3-70b-versatile'), ids.join(', '));
    assert.equal(ids.includes('provider:openai'), false);
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === 'served_by_provider' &&
          edge.from === 'model:groq/llama-3.3-70b-versatile' &&
          edge.to === 'provider:groq',
      ),
    );
    const groq = result.graph.components.find((component) => component.id === 'provider:groq');
    assert.equal(groq?.metadata['compatibleClient'], 'openai');
    assert.equal(groq?.metadata['providerBasis'], 'explicit_endpoint');
    assert.deepEqual(groq?.permissions, [
      { kind: 'network', scope: 'https://api.groq.com/openai/v1', mode: 'write' },
    ]);
  });

  it('refuses provider ownership for a literal compatible endpoint outside the bounded host table', async () => {
    const result = await scan(`from openai import OpenAI

client = OpenAI(base_url="https://models.example.invalid/v1")

def answer():
    return client.chat.completions.create(model="gpt-compatible", messages=[])
`);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('agent:answer'), ids.join(', '));
    assert.equal(
      ids.some((id) => id.startsWith('provider:')),
      false,
      ids.join(', '),
    );
    assert.ok(ids.includes('model:gpt-compatible'), ids.join(', '));
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'served_by_provider'),
      false,
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === 'invokes_model' &&
          edge.from === 'agent:answer' &&
          edge.to === 'model:gpt-compatible',
      ),
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.location?.file === 'src/app.py' &&
          entry.location.startLine === 3 &&
          entry.reason.includes('client class does not establish provider ownership'),
      ),
    );
  });

  it('keeps the imported client default when no endpoint override is declared', async () => {
    const result = await scan(`from openai import OpenAI

client = OpenAI()

def answer():
    return client.responses.create(model="gpt-4.1-mini", input="hello")
`);
    const provider = result.graph.components.find(
      (component) => component.id === 'provider:openai',
    );
    assert.equal(provider?.metadata['providerBasis'], 'library_default');
    assert.equal(provider?.metadata['compatibleClient'], 'openai');
    assert.ok(
      result.graph.components.some((component) => component.id === 'model:openai/gpt-4.1-mini'),
    );
  });

  it('keeps exact client-specific provider identities distinct from the SDK vendor', async () => {
    const result = await scan(`from openai import AzureOpenAI as AzureClient
from anthropic import AnthropicBedrock

azure = AzureClient()
bedrock = AnthropicBedrock()

def answer():
    azure.chat.completions.create(model="deployment", messages=[])
    return bedrock.messages.create(model="claude", messages=[])
`);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('provider:azure-openai'), ids.join(', '));
    assert.ok(ids.includes('model:azure-openai/deployment'), ids.join(', '));
    assert.ok(ids.includes('provider:bedrock'), ids.join(', '));
    assert.ok(ids.includes('model:bedrock/claude'), ids.join(', '));
    assert.equal(ids.includes('provider:openai'), false, ids.join(', '));
    assert.equal(ids.includes('provider:anthropic'), false, ids.join(', '));
  });
});
