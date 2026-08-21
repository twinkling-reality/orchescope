import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writePythonProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';
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
  namedConfigPaths(paths).paths.map((entry) => entry.path);

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
    const found = namedConfigPaths(['wrangler.toml', 'src/pkg/config/agents.yaml']).paths;
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
      namedConfigPaths(['config/agents.yaml']).paths,
    );
    const opened = documents.filter((document) => document.path === 'config/agents.yaml');
    assert.equal(opened.length, 1, 'the same document was handed to every adapter twice');
    assert.equal(opened[0]?.origin, 'known_path');
  });
});

const scan = async (build: (workspace: ReturnType<typeof createTempWorkspace>) => void) => {
  const workspace = createTempWorkspace('orchescope-config-scan-');
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
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 500,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 4,
    });
  } finally {
    handle.dispose();
  }
};

/**
 * A document this build opened and could not use is a gap in the scan, not an absence in the repository.
 *
 * The reader recorded both failures and had no consumer, so a crew whose only agents document has a syntax
 * error reported no agent and no reason, which reads exactly like a repository that declares none.
 */
describe('a configuration document that could not be parsed', () => {
  it('is counted and named in coverage rather than dropped', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'broken-crew', dependencies: ['crewai>=0.80'] });
      workspace.write(
        'src/broken/config/agents.yaml',
        'planner:\n  role: Planner\n   goal: badly indented\n',
      );
      workspace.write('src/broken/crew.py', 'from crewai import Agent\n');
    });
    const coverage = result.graph.coverage;
    const named = coverage.skipped.find((entry) => entry.file === 'src/broken/config/agents.yaml');
    assert.ok(
      named !== undefined,
      `the unread document is not in ${JSON.stringify(coverage.skipped)}`,
    );
    assert.equal(named.reason, 'parse_error');
    assert.ok((coverage.filesSkipped ?? 0) >= 1, 'the count did not move with the list');
  });
});

/**
 * A cap that truncates and says nothing reports the ceiling as though it were the answer.
 *
 * There is one flag for it and it does not name which ceiling was reached, which is a schema decision. What
 * it does say is that the scan was cut short, which is the difference between reading sixty four of seventy
 * documents and reading a repository that declares sixty four.
 */
describe('more agents documents than the cap reads', () => {
  it('reports the scan as cut short', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'many-crews', dependencies: ['crewai>=0.80'] });
      for (let index = 0; index < MAX_AGENT_DECLARATIONS + 6; index += 1) {
        workspace.write(
          `crews/crew_${String(index).padStart(3, '0')}/config/agents.yaml`,
          `worker_${index}:\n  role: Worker ${index}\n  goal: Do the work.\n`,
        );
      }
    });
    assert.equal(result.graph.coverage.truncated, true, 'a cap truncated and said nothing');
    assert.equal(
      result.graph.components.filter((component) => component.kind === 'agent').length,
      MAX_AGENT_DECLARATIONS,
    );
  });

  it('says nothing of the sort when every document fits', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, { name: 'few-crews', dependencies: ['crewai>=0.80'] });
      for (let index = 0; index < 4; index += 1) {
        workspace.write(
          `crews/crew_${index}/config/agents.yaml`,
          `worker_${index}:\n  role: Worker ${index}\n  goal: Do the work.\n`,
        );
      }
    });
    assert.equal(result.graph.coverage.truncated, false);
    assert.equal(
      result.graph.components.filter((component) => component.kind === 'agent').length,
      4,
    );
  });
});
