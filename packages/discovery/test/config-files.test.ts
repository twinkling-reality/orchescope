import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createTempWorkspace } from '@orchescope/testkit';
import {
  MAX_AGENT_DECLARATIONS,
  MAX_PLATFORM_CONFIGS,
  namedConfigPaths,
  readConfigDocuments,
} from '../src/config-files.ts';

/**
 * The two properties the named config mechanism exists for.
 *
 * Every path it returns is one the bounded traversal already walked, and the count of each kind is capped
 * separately. A shared cap is what put forty agent and task documents in front of a `wrangler.toml` and cut
 * the manifest off the end of a sorted list, which is the fix 0.6.0 made undone by a name added to the wrong
 * set. Neither cap is reached by anything in the pinned corpus, so the corpus cannot hold this and a test
 * has to.
 */

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const pathsOf = (paths: readonly string[]): readonly string[] =>
  namedConfigPaths(paths).map((entry) => entry.path);

describe('config documents found by file name', () => {
  const crowd = (count: number): readonly string[] =>
    Array.from(
      { length: count },
      (_, index) => `crews/crew_${String(index).padStart(3, '0')}/config/agents.yaml`,
    );

  it('does not spend one kind of cap on another kind of document', () => {
    const found = pathsOf([
      ...crowd(MAX_AGENT_DECLARATIONS),
      'wrangler.toml',
      'packages/worker/wrangler.toml',
    ]);
    assert.ok(found.includes('wrangler.toml'), 'the root manifest was cut off a crowded list');
    assert.ok(found.includes('packages/worker/wrangler.toml'));
    assert.equal(
      found.filter((path) => path.endsWith('agents.yaml')).length,
      MAX_AGENT_DECLARATIONS,
    );
  });

  it('caps each kind at its own ceiling rather than at the total', () => {
    const found = pathsOf([...crowd(MAX_AGENT_DECLARATIONS + 10), 'wrangler.toml']);
    assert.equal(
      found.filter((path) => path.endsWith('agents.yaml')).length,
      MAX_AGENT_DECLARATIONS,
      'a repository past the cap should keep exactly the cap',
    );
    assert.ok(found.includes('wrangler.toml'));
    assert.ok(MAX_PLATFORM_CONFIGS > 0);
  });

  it('records which kind found each path, so a reader of one kind cannot claim another', () => {
    const found = namedConfigPaths(['wrangler.toml', 'src/pkg/config/agents.yaml']);
    assert.deepEqual(found, [
      { path: 'wrangler.toml', origin: 'platform_manifest' },
      { path: 'src/pkg/config/agents.yaml', origin: 'agent_declaration' },
    ]);
  });

  it('ignores a name that only ends in one it knows', () => {
    assert.deepEqual(pathsOf(['tests/cassettes/test_between_agents.yaml', 'my-wrangler.toml']), []);
  });
});

describe('a path the fixed list and the traversal both name', () => {
  it('is read once, and as a path this build knows the name of', () => {
    const workspace = createTempWorkspace('orchescope-config-');
    workspaces.push(workspace);
    workspace.write('config/agents.yaml', 'planner:\n  role: Planner\n  goal: Plan it.\n');

    const { documents } = readConfigDocuments(
      workspace.root,
      namedConfigPaths(['config/agents.yaml']),
    );
    const opened = documents.filter((document) => document.path === 'config/agents.yaml');
    assert.equal(opened.length, 1, 'the same document was handed to every adapter twice');
    assert.equal(opened[0]?.origin, 'known_path');
  });
});
