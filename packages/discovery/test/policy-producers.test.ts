import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { EdgePolicy } from '@orchescope/schema';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

/**
 * Every field a relation can carry, and whether reading source can produce it.
 *
 * `EdgePolicy.timeoutMs` existed in the schema and was selected by a rule, and the only thing in the
 * repository that had ever written it was a hand written manifest. So `model-call-without-timeout` fired
 * on every repository with a model call in it and no change to any source file could clear it, while the
 * goal cut from it asked for exactly that change. The same defect had already been found once in the
 * opposite polarity, where a strength could only be earned by writing the answer into a manifest, and
 * neither was noticed until somebody ran the product on their own code and read an answer that never
 * moved.
 *
 * The properties come from the schema rather than from a list here, so a field added later is a field
 * this asks about. A manifest is a first class input and not a fallback, so a field only a person can
 * declare is not a defect in itself: what makes one fatal is a rule a goal can be cut from filtering on
 * it, which is what `tests/e2e/goal-eligible-rules.test.ts` decides. This pins which fields are in that
 * position, so adding one is a decision somebody makes rather than something that happens.
 */

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

/**
 * One repository writing every relation policy a source adapter knows how to read.
 *
 * A timeout at a model call, a bounded retry with a backoff around a request, and a worker declaring how
 * many jobs it takes at once.
 */
const build = (workspace: ReturnType<typeof createTempWorkspace>): void => {
  writeNodeProject(workspace, {
    name: 'policy-fixture',
    dependencies: { openai: '^6.0.0', bullmq: '^5.0.0' },
  });
  workspace.write(
    'src/ask.ts',
    `import OpenAI from 'openai';

const client = new OpenAI();

export async function answer(prompt: string) {
  return client.chat.completions.create(
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] },
    { timeout: 20000 },
  );
}
`,
  );
  workspace.write(
    'src/charge.ts',
    `export async function charge(body: unknown) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch('https://pay.example.com/v1/charges', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt));
    }
  }
  return undefined;
}
`,
  );
  workspace.write(
    'src/jobs.ts',
    `import { Worker } from 'bullmq';

export const worker = new Worker('emails', async () => undefined, { concurrency: 4 });
`,
  );
};

/**
 * A field only a person can declare, with the reason it is not a defect.
 *
 * Approval is a property of the operation and of who is allowed to ask for it, and no framework here
 * declares it on a relation: the ones that declare approval at all declare it on the tool, which reaches
 * the graph as `details.approvalRequired` and is what `side-effect-approval-boundary` reads. The relation
 * level field is what a manifest is for, and the rule that reads it treats it as one of three ways an
 * operation can be guarded rather than as the only one.
 */
const DECLARED_BY_A_PERSON: readonly string[] = ['requiresApproval'];

describe('the relation policy fields reading source can produce', () => {
  it('produces every field except the ones only a person declares', async () => {
    const workspace = createTempWorkspace('orchescope-policy-');
    workspaces.push(workspace);
    build(workspace);
    const clock = fixedClock(0);
    const handle = createDeadline(60_000, clock.monotonicMs);
    const result = await discover({
      root: workspace.root,
      projectName: 'fixture',
      orchescopeVersion: '0.1.0',
      clock,
      deadline: handle,
      traversal,
      concurrency: 4,
    });
    handle.dispose();

    const produced = new Set<string>();
    for (const edge of result.graph.edges) {
      for (const field of Object.keys(edge.policy ?? {})) produced.add(field);
    }
    const declarable = Object.keys(EdgePolicy.properties);
    const missing = declarable.filter((field) => !produced.has(field)).sort();
    assert.deepEqual(
      missing,
      [...DECLARED_BY_A_PERSON].sort(),
      `the relation policy fields no adapter reading source produced are ${missing.join(', ')}. A field in this position cannot be cleared by editing a repository, so a rule filtering on it can only ever be answered from a manifest`,
    );
  });
});
