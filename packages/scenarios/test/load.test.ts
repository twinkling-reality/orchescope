import assert from 'node:assert/strict';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createTempWorkspace } from '@orchescope/testkit';
import { loadScenarios } from '../src/load.ts';

/**
 * The loader is the only part of the package that reads the filesystem, so these cases are about its
 * boundaries: what it refuses to follow, what it refuses to leave, and what it reports instead of throwing.
 */

const workspace = createTempWorkspace('orchescope-load-');

after(() => {
  workspace.dispose();
});

const validScenario = (id: string) => `
id: ${id}
name: ${id}
target:
  command: [node, main.ts]
  timeoutMs: 1000
`;

workspace.write('scenarios/refund.yaml', validScenario('refund-flow'));
workspace.write('scenarios/nested/escalation.yml', validScenario('escalation-flow'));
workspace.write('scenarios/broken.yaml', 'id: 42\nname: 7\n');
workspace.write('scenarios/notes.md', 'not a scenario');
workspace.write('outside/secret.yaml', validScenario('outside-flow'));
symlinkSync(join(workspace.root, 'outside'), join(workspace.root, 'scenarios/link'));

describe('loadScenarios', () => {
  const loaded = loadScenarios(workspace.root, ['scenarios']);

  it('reads every scenario file under the given directory, including nested ones', () => {
    // Traversal is breadth first and each directory is read in sorted order, so the order is stable.
    assert.deepEqual(
      loaded.scenarios.map((entry) => entry.scenario.id),
      ['refund-flow', 'escalation-flow'],
    );
    assert.deepEqual(
      loaded.scenarios.map((entry) => entry.path),
      ['scenarios/refund.yaml', 'scenarios/nested/escalation.yml'],
    );
  });

  it('reports an invalid file as a problem instead of throwing', () => {
    const problem = loaded.problems.find((entry) => entry.file === 'scenarios/broken.yaml');
    assert.ok(problem !== undefined, JSON.stringify(loaded.problems));
    assert.match(problem.detail, /\/id/);
  });

  it('records that a symbolic link was not followed', () => {
    const problem = loaded.problems.find((entry) => entry.file === 'scenarios/link');
    assert.ok(problem !== undefined);
    assert.equal(problem.detail, 'symbolic links are not followed');
    assert.ok(
      loaded.scenarios.every((entry) => entry.scenario.id !== 'outside-flow'),
      'nothing outside the scanned directory may be loaded through a link',
    );
  });

  it('refuses a directory that climbs out of the repository root', () => {
    const escaped = loadScenarios(workspace.root, ['../']);
    assert.deepEqual(escaped.scenarios, []);
    assert.equal(escaped.problems.length, 1);
    assert.match(escaped.problems[0]?.detail ?? '', /inside the root/);
  });

  it('treats an absent scenario directory as no scenarios rather than a problem', () => {
    const empty = loadScenarios(workspace.root, ['scenarios-that-do-not-exist']);
    assert.deepEqual(empty.scenarios, []);
    assert.deepEqual(empty.problems, []);
  });

  it('reads a file once even when a directory is listed twice', () => {
    const twice = loadScenarios(workspace.root, ['scenarios', 'scenarios']);
    assert.equal(twice.scenarios.length, 2);
  });
});
