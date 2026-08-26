import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

/**
 * A construction whose distribution is reached through this repository's own module.
 *
 * `from .llm import Agent` is refused as local before any argument test runs, and that refusal is a claim
 * about who owns the name rather than a bound on what this reader can see. If `llm.py` holds
 * `from anthropic_agents import Agent`, the owner is a distribution and the build has told itself
 * otherwise. Following the chain can only make the ownership answer more correct.
 *
 * It buys no coverage and the tests say so. Measured over fifty six pinned repositories the bridge
 * produces zero new refusals: every one of the four hundred and forty chain-resolved call sites fails the
 * argument-name test. What it corrects is thirty six ownership answers that were wrong, and it makes true
 * a sentence [ADR 0014](../../../docs/architecture/adr/0014-layer-three-refusal-and-the-model-call-frame.md)
 * records as a decision already taken.
 *
 * The latent cost is stated rather than discovered later: the bridge makes a hundred and sixty two call
 * sites newly eligible for the argument test, a hundred and fifty six of them `logger.debug` on the
 * `debug` package. They pass nothing today and any future loosening of the stems inherits them.
 */

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>) => {
  const workspace = createTempWorkspace('orchescope-reexport-');
  workspaces.push(workspace);
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 're-export-fixture',
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

const unclaimed = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.coverage.unsupported.filter(
    (area) => area.kind === 'unclaimed_imported_construction',
  );

describe('a construction reached through a module this repository writes', () => {
  /* FALSIFIER. Refused as local before the change, named after it. */
  it('names the distribution the local module imported it from, in Python', async () => {
    const result = await scan({
      'src/llm.py': 'from anthropic_agents import Agent\n',
      'src/app.py': `from .llm import Agent

assistant = Agent(model='claude-sonnet-4')
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'anthropic_agents.Agent is constructed at src/app.py:3 and no adapter claims that distribution',
    );
  });

  /* FALSIFIER. The same shape in the other language, through a barrel module. */
  it('names the distribution the local module imported it from, in JavaScript', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/llm.js': "import { Agent } from 'some-agent-runtime';\n\nexport { Agent };\n",
      'src/app.js': `import { Agent } from './llm.js';

export const assistant = new Agent({ model: 'gpt-4o' });
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'some-agent-runtime.Agent is constructed at src/app.js:3 and no adapter claims that distribution',
    );
  });

  /* GUARD. A name this repository really defines stays this repository's, however many modules it crosses. */
  it('stays quiet where the chain ends at a definition this repository writes', async () => {
    const result = await scan({
      'src/llm.py': 'class Agent:\n    def __init__(self, model):\n        self.model = model\n',
      'src/app.py': `from .llm import Agent

assistant = Agent(model='claude-sonnet-4')
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  /* GUARD. A chain reaching a distribution an adapter claims is that adapter's silence to answer for. */
  it('stays quiet where the chain ends at a distribution an adapter claims', async () => {
    const result = await scan({
      'src/llm.py': 'from openai import OpenAI\n',
      'src/app.py': `from .llm import OpenAI

client = OpenAI(model='gpt-4o')
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  /*
   * GUARD. Thirty real re-export cycles exist in the pinned corpus, every one of them a Python
   * `from . import X` inside a package `__init__.py`. Without a visited set a cycle is bounded only by the
   * hop ceiling, so it terminates by exhaustion and cannot be told apart from a chain that simply ran out.
   */
  it('terminates on a re-export cycle rather than exhausting its hops', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/a.js': "import { Agent } from './b.js';\n\nexport { Agent };\n",
      'src/b.js': "import { Agent } from './a.js';\n\nexport { Agent };\n",
      'src/app.js': `import { Agent } from './a.js';

export const assistant = new Agent({ model: 'gpt-4o' });
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });
});
