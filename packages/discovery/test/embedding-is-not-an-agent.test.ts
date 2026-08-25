import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>) => {
  const workspace = createTempWorkspace('orchescope-embedding-');
  workspaces.push(workspace);
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'embedding-fixture',
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
    });
  } finally {
    deadline.dispose();
  }
};

const manifest = `${JSON.stringify(
  {
    name: 'embedding-app',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: { ai: '^5.0.0', '@ai-sdk/openai': '^2.0.0' },
  },
  null,
  2,
)}\n`;

/**
 * An embedding turns text into a vector. It selects no tool, holds no instructions and runs no loop, so a
 * repository whose only model usage is an embedding has no agent system for this adapter to detect.
 *
 * Reading `embed` as a generation call once gave a three line embedding helper an `agent` component, and
 * because `agent` is in the set detection reads, that helper carried `agentSystemDetected` for a
 * repository whose real framework agent had been refused by name. The bound below is that boundary.
 */
describe('an embedding call is not an agent system', () => {
  it('mints no agent, no model and no detection for a repository that only embeds', async () => {
    const result = await scan({
      'package.json': manifest,
      'src/embeddings.ts': [
        "import { createOpenAI } from '@ai-sdk/openai';",
        "import { embed } from 'ai';",
        '',
        "const EMBEDDING_MODEL = 'text-embedding-3-small';",
        '',
        'const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });',
        '',
        'export async function embedText(text: string) {',
        '  const { embedding } = await embed({',
        '    model: openai.embedding(EMBEDDING_MODEL),',
        '    value: text,',
        '  });',
        '  return embedding;',
        '}',
        '',
      ].join('\n'),
    });

    const fromVercel = result.graph.components.filter((component) =>
      component.discoveredBy.includes('adapter:vercel-ai-sdk'),
    );
    assert.deepEqual(fromVercel, [], 'an embedding call produced a component');

    const named = result.graph.components.filter((component) =>
      component.identity.localName.toLowerCase().includes('embedtext'),
    );
    assert.deepEqual(named, [], 'the enclosing function of an embedding became a component');
  });

  it('still reads a bare text generation in the same repository', async () => {
    const result = await scan({
      'package.json': manifest,
      'src/answer.ts': [
        "import { createOpenAI } from '@ai-sdk/openai';",
        "import { generateText } from 'ai';",
        '',
        'const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });',
        '',
        'export async function answer(question: string) {',
        '  const { text } = await generateText({',
        "    model: openai('gpt-4o'),",
        '    prompt: question,',
        '  });',
        '  return text;',
        '}',
        '',
      ].join('\n'),
    });

    const models = result.graph.components.filter(
      (component) =>
        component.kind === 'model' && component.discoveredBy.includes('adapter:vercel-ai-sdk'),
    );
    assert.equal(models.length, 1, 'a bare generation call stopped producing a model component');
  });
});
