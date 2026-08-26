import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  AGENT_SYSTEM_KINDS,
  createDeadline,
  establishesAgentSystem,
  fixedClock,
  isInferredEntryPoint,
  isModelCallFrame,
} from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (
  files: Readonly<Record<string, string>>,
  dependencies: Record<string, string>,
) => {
  const created = createTempWorkspace('orchescope-model-call-frame-');
  workspaces.push(created);
  writeNodeProject(created, { name: 'frame-fixture', dependencies });
  for (const [path, contents] of Object.entries(files)) created.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: created.root,
      projectName: 'frame-fixture',
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

const ids = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components.map((component) => component.id).sort();

/**
 * The function a model call was written inside is a frame, not an agent.
 *
 * The 0.9.2 acceptance check measured the cost of calling it one: seven demonstration functions in a
 * single example file, each one `chat.completions.create` with no tools and no loop, were reported as
 * seven agents, and the repository's real agents were invisible. `agent` asserts a loop, a tool
 * population and a decision, and a bare generation call shows none of the three.
 *
 * Everything the component carried it still carries. The `invokes_model` edge, the declared timeout on
 * that edge, the prompt attribution and the provider qualification all move with it, which is why this
 * is a reclassification and not a deletion.
 */
describe('the frame a model call was written in', () => {
  const bareCompletion = {
    'src/examples.js': `import OpenAI from 'openai';

const client = new OpenAI();

export async function basicCompletion() {
  return client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hi' }],
  });
}
`,
  };

  it('is an inferred entry point rather than an agent', async () => {
    const result = await scan(bareCompletion, { openai: '^4.0.0' });

    assert.ok(ids(result).includes('entrypoint:basiccompletion'), ids(result).join(', '));
    assert.equal(ids(result).includes('agent:basiccompletion'), false, ids(result).join(', '));
  });

  it('carries the inferred entry point vocabulary the effects reader already uses', async () => {
    const result = await scan(bareCompletion, { openai: '^4.0.0' });
    const frame = result.graph.components.find(
      (component) => component.id === 'entrypoint:basiccompletion',
    );

    assert.ok(frame !== undefined);
    assert.equal(isInferredEntryPoint(frame), true);
    assert.ok(frame.tags.includes('model-call-frame'));
    /* `componentViolations` requires `details.for` to equal the kind, so writing none is the only
     * correct answer for a component whose details vocabulary is an agent's. */
    assert.equal(frame.details, undefined);
  });

  it('keeps the invokes_model edge it anchors', async () => {
    const result = await scan(bareCompletion, { openai: '^4.0.0' });

    assert.ok(
      result.graph.edges.some(
        (edge) => edge.kind === 'invokes_model' && edge.from === 'entrypoint:basiccompletion',
      ),
      result.graph.edges.map((edge) => `${edge.kind} ${edge.from}`).join(', '),
    );
  });

  it('is not one of the kinds detection is written in terms of', async () => {
    const result = await scan(bareCompletion, { openai: '^4.0.0' });
    const frame = result.graph.components.find(
      (component) => component.id === 'entrypoint:basiccompletion',
    );

    assert.ok(frame !== undefined);
    assert.equal(AGENT_SYSTEM_KINDS.has(frame.kind), false);
    /* It answers detection all the same, through `establishesAgentSystem` rather than through its kind,
     * because a repository that calls a model implements an agent system whether or not this build can
     * name the model. See the unnameable case below. */
    assert.equal(establishesAgentSystem(frame), true);
  });

  /**
   * The one answer this changes: a repository that calls a model this build cannot identify.
   *
   * The client takes a base URL chosen at run time, so no provider is settled, and the model is a
   * variable, so no model is settled. Nothing is minted for either, and before the frame answered
   * detection the only thing saying this repository calls a model was a component invented from the call
   * site and called an `agent`. That repository is `tubemind`, the blind evaluation positive for
   * candidate `df99c97c`, pinned because "reported no agent system" about it blocked a release.
   *
   * The first is a FALSIFIER against the revision that reclassified the frame without this. The second
   * is the GUARD that keeps it from being a widening: a repository that makes no generation call has no
   * frame, and every pinned negative stays where it was.
   */
  it('says a repository calls a model even where neither the model nor its provider can be named', async () => {
    const result = await scan(
      {
        'src/utils.py': `import os

def llm_call(messages, model):
    import openai as openai_lib
    client = openai_lib.OpenAI(base_url=os.environ["API_BASE"], api_key=os.environ["API_KEY"])
    resp = client.chat.completions.create(model=model, messages=messages)
    return resp.choices[0].message.content
`,
      },
      { openai: '^4.0.0' },
    );

    const frame = result.graph.components.find(
      (component) => component.id === 'entrypoint:llm_call',
    );
    assert.ok(frame !== undefined, ids(result).join(', '));
    assert.equal(isModelCallFrame(frame), true);
    /* Nothing was invented to stand in for what could not be read. */
    assert.equal(
      result.graph.components.some((component) => component.kind === 'model'),
      false,
      ids(result).join(', '),
    );
    assert.equal(
      result.graph.components.some((component) => component.kind === 'agent'),
      false,
      ids(result).join(', '),
    );
    assert.equal(result.graph.components.some(establishesAgentSystem), true);
  });

  it('GUARD: a repository that calls no model has no frame and is not detected', async () => {
    const result = await scan(
      {
        'src/server.js': `import express from 'express';

const app = express();
app.get('/health', (request, response) => response.json({ ok: true }));
`,
      },
      { express: '^4.0.0' },
    );

    assert.equal(
      result.graph.components.some((component) => isModelCallFrame(component)),
      false,
      ids(result).join(', '),
    );
    assert.equal(
      result.graph.components.some(establishesAgentSystem),
      false,
      ids(result).join(', '),
    );
  });

  it('collapses into one component where the same function also reaches the outside world', async () => {
    const result = await scan(
      {
        'src/handler.js': `import OpenAI from 'openai';

const client = new OpenAI();

export async function handleRequest(text) {
  const reply = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: text }],
  });
  await fetch('https://hooks.example.com/notify', { method: 'POST', body: '{}' });
  return reply;
}
`,
      },
      { openai: '^4.0.0' },
    );

    const forHandleRequest = ids(result).filter((id) => id.endsWith(':handlerequest'));
    assert.deepEqual(forHandleRequest, ['entrypoint:handlerequest'], ids(result).join(', '));
  });
});
