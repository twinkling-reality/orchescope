import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock, moduleNamespace } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject, writePythonProject } from '@orchescope/testkit';
import { analyzePython } from '../../source-analysis/src/python/analyze.ts';
import { discover } from '../src/discover.ts';
import { readSinkEvidence, sinkKey } from '../src/sink-evidence.ts';

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
  const workspace = createTempWorkspace('orchescope-documentation-');
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

const pythonWithDocumentation = (documentation: string) =>
  scan((workspace) => {
    writePythonProject(workspace, {
      name: 'documented-agent',
      dependencies: ['pydantic-ai>=1.0', 'langchain>=1.2'],
    });
    workspace.write(
      'src/model.py',
      `from pydantic_ai import Agent

desk = Agent('openai:gpt-4.1-mini')
`,
    );
    workspace.write(
      'src/documented.py',
      `"""${documentation}"""

from langchain.agents.middleware import dynamic_prompt

class Documented:
    """${documentation}"""

    @dynamic_prompt
    def contextual(self, request):
        """${documentation}"""
        return None
`,
    );
  });

describe('Python documentation strings', () => {
  it('ignores prompt-like wording in formal Python documentation strings', async () => {
    const neutral = await pythonWithDocumentation(
      'Reference notes for the documented callable and its return value.',
    );
    const hintDense = await pythonWithDocumentation(
      'You are the system assistant. Your task is to always respond and answer the user step by step. Never ignore these instructions.',
    );

    for (const result of [neutral, hintDense]) {
      assert.ok(
        result.graph.components.some(
          (component) => component.kind === 'agent' || component.kind === 'model',
        ),
        'the separate model fixture must make the prompt adapter global gate applicable',
      );
      assert.deepEqual(promptProjection(result), []);
      assert.equal(
        result.graph.edges.some((edge) => edge.kind === 'uses_prompt'),
        false,
      );
    }
    assert.deepEqual(promptProjection(neutral), promptProjection(hintDense));
  });

  it('keeps a value-bearing Python prompt when documentation is present', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'python-value-prompt',
        dependencies: ['pydantic-ai>=1.0'],
      });
      workspace.write(
        'src/desk.py',
        `"""You are module documentation. Always answer questions about this assistant."""

from pydantic_ai import Agent

desk = Agent(
    'openai:gpt-4.1-mini',
    instructions="""You are a support assistant. Always answer briefly and never invent an order number.""",
)
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]?.sourceLocations[0]?.file, 'src/desk.py');
    assert.equal(prompts[0]?.sourceLocations[0]?.startLine, 7);
    const coverage = result.graph.coverage.adapters.find(
      (adapter) => adapter.adapterId === 'adapter:prompts',
    );
    assert.equal(coverage?.adapterVersion, '3');
    assert.equal(coverage?.componentsFound, 1);
  });

  it('keeps JavaScript and TypeScript value prompts unchanged', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'typescript-value-prompt',
        dependencies: { '@openai/agents': '^0.1.0' },
      });
      workspace.write(
        'src/desk.ts',
        `import { Agent } from '@openai/agents';

const SYSTEM = \`You are a TypeScript support assistant. Always answer briefly and never invent an order number.\`;
export const desk = new Agent({ name: 'desk', instructions: SYSTEM });
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]?.displayName, 'SYSTEM');
    assert.equal(prompts[0]?.sourceLocations[0]?.file, 'src/desk.ts');
    assert.equal(
      result.graph.coverage.adapters.find((adapter) => adapter.adapterId === 'adapter:prompts')
        ?.adapterVersion,
      '3',
    );
  });

  it('does not treat documentation-only SQL as sink deduplication evidence', async () => {
    const documentation = await analyzePython({
      file: 'src/payments.py',
      contentHash: 'a'.repeat(64),
      text: `def write_payment():
    """The example statement uses INSERT INTO payments ON CONFLICT DO NOTHING for illustration."""
    return send_payment()
`,
    });
    const value = await analyzePython({
      file: 'src/payments.py',
      contentHash: 'b'.repeat(64),
      text: `def write_payment():
    statement = """INSERT INTO payments (id) VALUES (1) ON CONFLICT DO NOTHING RETURNING id"""
    return execute(statement)
`,
    });

    assert.equal(readSinkEvidence([documentation]).size, 0);
    assert.equal(
      readSinkEvidence([value]).get(sinkKey(moduleNamespace(value.file), 'write_payment'))
        ?.deduplicates,
      'its statement deduplicates on conflict',
    );
  });
});
