import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>) => {
  const created = createTempWorkspace('orchescope-self-hosted-model-');
  workspaces.push(created);
  writeNodeProject(created, { name: 'self-hosted', dependencies: {} });
  for (const [path, contents] of Object.entries(files)) created.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: created.root,
      projectName: 'self-hosted',
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

const named = (result: Awaited<ReturnType<typeof scan>>, kind: string) =>
  result.graph.components
    .filter((component) => component.kind === kind)
    .map((component) => component.displayName)
    .sort();

/**
 * A model served from an address this build does not recognise.
 *
 * The provider table has twelve entries and every OpenAI compatible server there is fails it: vLLM, LM
 * Studio, LocalAI, llama.cpp, LiteLLM, OpenRouter, Together and Ollama's `/v1` shim. The 0.9.2 acceptance
 * check ran one of them: seven agents and both models executed, and the report said nine declared
 * components were never exercised and that either no scenario reached them or they were unreachable in
 * practice. Both disjuncts were false, about the file the run had just executed.
 *
 * The first three are FALSIFIERS. The last two are GUARDS: they pass against the revision before this,
 * because the host gate made both questions unreachable, and they are the two ways this widening could
 * have become a wrong claim instead of a missing one.
 */
describe('a model reached at an address with no named provider', () => {
  it('reads an OpenAI compatible path on a loopback address as a model call', async () => {
    const result = await scan({
      'src/app.js': `await fetch('http://127.0.0.1:11434/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'qwen2.5', messages: [] }),
});
`,
    });

    assert.deepEqual(named(result, 'model'), ['unspecified/qwen2.5']);
  });

  it('names no provider rather than inventing one from the host', async () => {
    const result = await scan({
      'src/app.js': `await fetch('http://my-vllm.internal:8000/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'llama-3.1-70b', messages: [] }),
});
`,
    });

    assert.deepEqual(named(result, 'model'), ['unspecified/llama-3.1-70b']);
    assert.deepEqual(named(result, 'provider'), []);
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'served_by_provider'),
      false,
    );
  });

  it('still names the provider where the host settles it', async () => {
    const result = await scan({
      'src/app.js': `await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
});
`,
    });

    assert.deepEqual(named(result, 'model'), ['openai/gpt-4o']);
    assert.deepEqual(named(result, 'provider'), ['openai']);
  });

  it('GUARD: mints nothing where neither the provider nor the model is settled', async () => {
    const result = await scan({
      'src/app.js': `await fetch('http://127.0.0.1:11434/v1/chat/completions', {
  method: 'POST',
  body: payload,
});
`,
    });

    assert.deepEqual(named(result, 'model'), []);
    assert.deepEqual(named(result, 'provider'), []);
  });

  it('GUARD: leaves a same-origin path to the application that serves it', async () => {
    const result = await scan({
      'src/app.js': `await fetch('/api/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
});
`,
    });

    assert.deepEqual(named(result, 'model'), []);
    assert.deepEqual(named(result, 'provider'), []);
  });

  it('GUARD: leaves a resource path that ends with an operation word alone', async () => {
    const result = await scan({
      'src/app.js': `await fetch('https://app.example.com/users/1/messages', {
  method: 'POST',
  body: JSON.stringify({ model: 'gpt-4o' }),
});
`,
    });

    assert.deepEqual(named(result, 'model'), []);
  });
});
