/// <reference types="node" />

import type { Scenario, ScenarioRunSummary } from '@orchescope/schema';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { orderScenariosForVerification } from '../src/presentation/scenario-order.ts';

const scenario = (id: string): Scenario =>
  ({
    id,
    name: id,
    version: 1,
    target: { kind: 'process', command: ['node', 'main.ts'] },
    evaluators: [],
    tags: [],
  }) as unknown as Scenario;

const run = (scenarioId: string): ScenarioRunSummary => ({
  runId: `run_${scenarioId}`,
  scenarioId,
  scenarioName: scenarioId,
  status: 'passed',
  durationMs: 1,
  evaluators: [],
  faultsApplied: [],
});

describe('orderScenariosForVerification', () => {
  it('puts a scenario nothing has run ahead of one that has', () => {
    const ordered = orderScenariosForVerification(
      [scenario('ran'), scenario('never-ran')],
      [run('ran')],
    );
    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ['never-ran', 'ran'],
    );
  });

  it('keeps the repository own order inside each group rather than sorting by name', () => {
    const ordered = orderScenariosForVerification(
      [scenario('zulu'), scenario('alpha'), scenario('mike')],
      [],
    );
    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ['zulu', 'alpha', 'mike'],
    );
  });

  it('leaves a list where everything has run in its own order', () => {
    const ordered = orderScenariosForVerification(
      [scenario('a'), scenario('b')],
      [run('a'), run('b')],
    );
    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ['a', 'b'],
    );
  });

  it('ignores a run naming a scenario this report does not carry', () => {
    const ordered = orderScenariosForVerification([scenario('a')], [run('gone')]);
    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ['a'],
    );
  });

  it('returns an empty list unchanged', () => {
    assert.deepEqual(orderScenariosForVerification([], [run('a')]), []);
  });
});
