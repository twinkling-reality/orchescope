import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { loadScenario } from '../src/scenario.ts';
import { storeDouble, workspaceDouble } from './store-double.ts';
import * as documents from './stored-documents.ts';

/**
 * A scenario is a file its author edits, and editing it used to do nothing.
 *
 * The stored copy answered every lookup by identifier and the file was consulted only when the caller named
 * it directly, so changing `repetitions` from three to one and running `orchescope test --scenario example`
 * still ran three, with no message at all. Iterating on a scenario is the whole activity `init --scenario`
 * starts, and it was inert until an unrelated `orchescope audit` happened to resynchronise the store.
 */

const SCENARIO = (repetitions: number, id = 'example') => `schemaVersion: 1
id: ${id}
name: An example
description: A scenario an operator edits.
target:
  command: ['node', 'main.js']
  resultSource: exit_code
  timeoutMs: 30000
input:
  prompt: hello
expect:
  taskSuccess: true
evaluators:
  - kind: exit_code
    equals: 0
budgets:
  maxDurationMs: 30000
  maxTokens: 1000
  maxModelCalls: 10
  maxRetries: 2
faults: []
seed: 1
repetitions: ${repetitions}
requiredPermissions:
  - process:spawn
tags: []
`;

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PROJECT = 'prj_0000000000000001';

/** A workspace whose store holds one scenario recorded from a file, which the test then edits. */
const workspaceWith = (fileText: string, storedRepetitions: number) => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-scenario-'));
  roots.push(root);
  mkdirSync(join(root, 'scenarios'), { recursive: true });
  writeFileSync(join(root, 'scenarios/example.yaml'), fileText);
  const double = storeDouble({
    projectId: PROJECT,
    scenarios: [
      {
        scenario: documents.scenario({ id: 'example', repetitions: storedRepetitions }),
        sourcePath: 'scenarios/example.yaml',
      },
    ],
  });
  return {
    root,
    double,
    workspace: workspaceDouble({ projectId: PROJECT, root, store: double.store }),
  };
};

describe('the scenario a run is loaded from', () => {
  it('is the edited file rather than the copy recorded before the edit', () => {
    const { workspace } = workspaceWith(SCENARIO(1), 3);
    const scenario = loadScenario({ workspace, reference: 'example' });
    assert.equal(
      scenario.repetitions,
      1,
      'the run used the stored copy, so editing the scenario did nothing',
    );
  });

  it('records what it read, so the next lookup does not have to read it again', () => {
    const { workspace, double } = workspaceWith(SCENARIO(1), 3);
    loadScenario({ workspace, reference: 'example' });
    assert.equal(double.savedScenarios[0]?.repetitions, 1);
  });

  /*
   * Running the previous version of something an operator has just edited is the same silence pointed the
   * other way, so a file that no longer parses raises instead of quietly falling back.
   */
  it('refuses a file that no longer parses rather than running what was stored', () => {
    const { workspace } = workspaceWith('id: example\nthis: is not a scenario\n', 3);
    assert.throws(() => loadScenario({ workspace, reference: 'example' }), /not a valid scenario/);
  });

  /* A file that now declares another identifier is another scenario, so this reference is not about it. */
  it('keeps the stored copy when the file now declares a different scenario', () => {
    const { workspace } = workspaceWith(SCENARIO(1, 'renamed'), 3);
    assert.equal(loadScenario({ workspace, reference: 'example' }).repetitions, 3);
  });

  /* A deleted file leaves the stored copy as the last thing anybody recorded, which is what it is. */
  it('keeps the stored copy when the file it came from is gone', () => {
    const { workspace, root } = workspaceWith(SCENARIO(1), 3);
    rmSync(join(root, 'scenarios/example.yaml'));
    assert.equal(loadScenario({ workspace, reference: 'example' }).repetitions, 3);
  });
});
