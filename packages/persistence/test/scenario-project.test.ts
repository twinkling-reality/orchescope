import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import type { Scenario } from '@orchescope/schema';
import { createArtifactStore } from '../src/artifacts.ts';
import { openDatabase } from '../src/database.ts';
import { createStore } from '../src/store.ts';

/**
 * A scenario belongs to a project, and a store can hold more than one.
 *
 * Every other identifier this store keys on is minted from content: a run, a scan, a report and a finding all
 * carry a digest projection, so two of them collide only when they are the same thing. A scenario identifier
 * is the one an author types, bounded to `^[a-z0-9][a-z0-9-]{1,63}$`, and the identifier this product's own
 * `init --scenario` writes into every template it hands out is `example`. The name most likely to be shared
 * between two repositories is the one the product supplies.
 *
 * The table keyed on that name alone, so one store holding two projects held one scenario. Copying a
 * repository together with its `.orchescope` directory is enough to produce that store, because a project
 * identifier is minted from the scan root and the database travels with the copy.
 */

const directories: string[] = [];

after(() => {
  for (const root of directories) rmSync(root, { recursive: true, force: true });
});

const storeIn = () => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-scenario-project-'));
  directories.push(root);
  const database = openDatabase(join(root, 'state/orchescope.db'));
  const now = () => '2026-08-28T00:00:00.000Z';
  const artifacts = createArtifactStore(join(root, 'state/artifacts'), database, now);
  const store = createStore({ database, artifacts, now });
  for (const id of ['prj_a', 'prj_b']) {
    database.run(
      'INSERT INTO project (id, name, path_hash, created_at) VALUES (?, ?, ?, ?)',
      id,
      id,
      id,
      '2026-08-28T00:00:00.000Z',
    );
  }
  return store;
};

const scenario = (command: string): Scenario => ({
  schemaVersion: 1,
  id: 'example',
  name: 'One run of the system',
  target: { command: ['node', command], resultSource: 'exit_code', timeoutMs: 1000 },
  evaluators: [{ kind: 'exit_code', equals: 0 }],
  budgets: {},
  faults: [],
  requiredPermissions: ['process:spawn'],
  tags: [],
  metadata: {},
});

const scenarioResult = (id: string, passed: boolean) =>
  ({
    schemaVersion: 1,
    id,
    scenarioId: 'example',
    startedAt: '2026-08-28T00:00:00.000Z',
    finishedAt: '2026-08-28T00:00:01.000Z',
    environment: {
      platform: 'darwin',
      arch: 'arm64',
      cpuCount: 8,
      nodeVersion: 'v24.0.0',
      orchescopeVersion: '0.9.2',
    },
    repetitions: [],
    aggregate: {},
    passed,
  }) as never;

describe('a scenario named the same thing in two projects', () => {
  /*
   * The falsifier, asked through the one reader whose signature this change does not touch, so what it
   * reports is the behaviour and not the shape of the call.
   */
  it('is two scenarios, and neither save disturbs the other', () => {
    const store = storeIn();
    store.saveScenario(scenario('src/a-only.js'), 'prj_a', 'scenarios/a.yaml');
    store.saveScenario(scenario('src/b-only.js'), 'prj_b', 'scenarios/b.yaml');

    assert.deepEqual(
      store.listScenarios('prj_a').map((entry) => entry.target.command),
      [['node', 'src/a-only.js']],
      'saving under the second project overwrote or hid the first project scenario',
    );
    assert.deepEqual(
      store.listScenarios('prj_b').map((entry) => entry.target.command),
      [['node', 'src/b-only.js']],
      'the second project cannot see the scenario it just stored',
    );
    store.database.close();
  });

  /*
   * The readers that took a scenario identifier and nothing else. These cannot be run against the tree
   * before this change, because the call there takes one argument, so they are guards on the new shape
   * rather than falsifiers: what falsifies is the case above and the end to end case that executes an argv.
   */
  it('answers a lookup with the asking project scenario', () => {
    const store = storeIn();
    store.saveScenario(scenario('src/a-only.js'), 'prj_a', 'scenarios/a.yaml');
    store.saveScenario(scenario('src/b-only.js'), 'prj_b', 'scenarios/b.yaml');
    assert.deepEqual(store.scenarioById('prj_a', 'example')?.target.command, [
      'node',
      'src/a-only.js',
    ]);
    assert.deepEqual(store.scenarioById('prj_b', 'example')?.target.command, [
      'node',
      'src/b-only.js',
    ]);
    assert.equal(store.scenarioSourceById('prj_a', 'example'), 'scenarios/a.yaml');
    assert.equal(store.scenarioSourceById('prj_b', 'example'), 'scenarios/b.yaml');
    store.database.close();
  });

  it('tells a project that stored none that it has none', () => {
    const store = storeIn();
    store.saveScenario(scenario('src/a-only.js'), 'prj_a', 'scenarios/a.yaml');
    assert.equal(store.scenarioById('prj_b', 'example'), undefined);
    assert.equal(store.scenarioSourceById('prj_b', 'example'), undefined);
    assert.deepEqual(store.listScenarios('prj_b'), []);
    store.database.close();
  });

  /*
   * The results are the same sentence one table over, and the column to filter on was already there. A goal
   * is judged from the newest result of the scenario its plan reruns, so a result read across projects
   * decides a goal in one repository from a run in another.
   */
  it('keeps the results of each project apart', () => {
    const store = storeIn();
    store.saveScenarioResult(scenarioResult('scr_a', true), 'prj_a');
    store.saveScenarioResult(scenarioResult('scr_b', false), 'prj_b');
    assert.deepEqual(
      store.scenarioResults('prj_a', 'example').map((entry) => entry.id),
      ['scr_a'],
    );
    assert.deepEqual(
      store.scenarioResults('prj_b', 'example').map((entry) => entry.id),
      ['scr_b'],
    );
    store.database.close();
  });
});
