import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { claimDifference, differences } from '../../scripts/corpus/comparison.mjs';
import { isOffline, readCorpus } from '../../scripts/corpus/definition.mjs';

/**
 * The corpus harness measured against itself.
 *
 * Two claims are made here. The corpus covers what it says it covers: every framework adapter this repository
 * claims appears in at least one entry, and enough repositories that are not agent systems are pinned to keep the
 * readers honest in the other direction. And the check is a real gate: a number that moves is reported with the
 * path that moved, which for an adapter that went quiet is the adapter's own identifier.
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const execFileAsync = promisify(execFile);

const FRAMEWORK_ADAPTERS = [
  'adapter:openai-agents',
  'adapter:langgraph',
  'adapter:crewai',
  'adapter:pydantic-ai',
  'adapter:vercel-ai-sdk',
  'adapter:model-sdk',
];

type Expectation = {
  readonly name: string;
  readonly kind: string;
  readonly agentSystemDetected: boolean;
  readonly adapters: Record<
    string,
    { readonly status: string; readonly componentsFound: number; readonly edgesFound: number }
  >;
};

const entries = readCorpus(repositoryRoot) as readonly {
  name: string;
  kind: string;
  source: string;
}[];

const expectationOf = (name: string): Expectation =>
  JSON.parse(readFileSync(join(repositoryRoot, 'corpus/expected', `${name}.json`), 'utf8'));

describe('the corpus', () => {
  it('records an expectation for every pinned repository', () => {
    for (const entry of entries) {
      const path = join(repositoryRoot, 'corpus/expected', `${entry.name}.json`);
      assert.ok(existsSync(path), `${entry.name} has no recorded expectation`);
      const expectation = expectationOf(entry.name);
      assert.equal(expectation.name, entry.name);
      assert.equal(expectation.kind, entry.kind);
      assert.equal(
        expectation.agentSystemDetected,
        entry.kind === 'agent_system',
        `${entry.name} is pinned as ${entry.kind} and its expectation disagrees`,
      );
    }
  });

  it('covers every framework adapter this repository claims', () => {
    const contributing = new Set<string>();
    for (const entry of entries) {
      for (const [adapterId, run] of Object.entries(expectationOf(entry.name).adapters)) {
        if (run.componentsFound > 0 || run.edgesFound > 0) contributing.add(adapterId);
      }
    }
    const missing = FRAMEWORK_ADAPTERS.filter((adapter) => !contributing.has(adapter));
    assert.deepEqual(missing, [], `no corpus entry exercises ${missing.join(', ')}`);
  });

  it('pins repositories in both polarities, and an offline subset', () => {
    const precision = entries.filter((entry) => entry.kind === 'not_agent_system');
    assert.ok(
      precision.length >= 3,
      `a precision test needs at least three repositories that are not agent systems, saw ${precision.length}`,
    );
    assert.ok(entries.length >= 8, `the corpus holds ${entries.length} repositories`);
    assert.ok(
      entries.some((entry) => isOffline(entry)),
      'the required gate needs an offline subset',
    );
  });
});

describe('the corpus check', () => {
  const baseline = () => expectationOf('demonstration-system');

  it('reports nothing when a scan reproduces its expectation', () => {
    assert.deepEqual(differences(baseline(), baseline()), []);
  });

  it('names the adapter when one goes quiet', () => {
    const observed = baseline();
    const broken = {
      ...observed,
      adapters: {
        ...observed.adapters,
        'adapter:manifest': {
          status: 'completed',
          componentsFound: 0,
          edgesFound: 0,
          filesInspected: 1,
        },
      },
    };
    const found = differences(baseline(), broken);
    assert.ok(found.length > 0, 'an adapter contributing nothing has to be a difference');
    for (const difference of found) {
      assert.match(
        difference.path,
        /^adapters\.adapter:manifest\./,
        `a difference outside the broken adapter was reported: ${difference.path}`,
      );
    }
    assert.ok(
      found.some((difference) => difference.expected === '18' && difference.observed === '0'),
      `expected the component count to be named, saw ${JSON.stringify(found)}`,
    );
  });

  it('holds the claim the corpus file makes, not only the recorded numbers', () => {
    const entry = { name: 'flask', kind: 'not_agent_system' };
    assert.equal(claimDifference(entry, { agentSystemDetected: false }), undefined);
    const difference = claimDifference(entry, { agentSystemDetected: true });
    assert.equal(difference?.path, 'agentSystemDetected');
    assert.match(difference?.expected ?? '', /not_agent_system/);
  });

  it('passes over the offline subset', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [join(repositoryRoot, 'scripts/corpus.mjs'), '--check', '--offline'],
      {
        cwd: repositoryRoot,
        maxBuffer: 64 * 1024 * 1024,
        timeout: 240_000,
        env: { ...process.env, NO_COLOR: '1' },
      },
    );
    assert.match(stdout, /0 differing, 0 not measured/);
    assert.match(stdout, /parse rate/);
    assert.match(stdout, /adapters /);
    assert.match(stdout, /blind spots/);
  });
});
