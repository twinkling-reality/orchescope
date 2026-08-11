/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDeltaMeter,
  buildUnmeasuredMeter,
  CELL_LIMIT,
  DENSE_ABOVE,
  type MeterCell,
} from '../src/presentation/delta-meter.ts';

const count = (cells: readonly MeterCell[], kind: MeterCell): number =>
  cells.filter((cell) => cell === kind).length;

describe('buildDeltaMeter', () => {
  it('draws one cell per component while the repository fits under the ceiling', () => {
    const meter = buildDeltaMeter({ declared: 22, exercised: 14, exercisedNotDeclared: 1 });
    assert.equal(meter.componentsPerCell, 1);
    assert.equal(meter.cells.length, 22);
    assert.equal(count(meter.cells, 'exercised'), 14);
    assert.equal(count(meter.cells, 'declared_only'), 8);
    assert.equal(meter.outside, 1);
    assert.equal(meter.caption, null);
  });

  it('holds the rail at the ceiling instead of halving it as the repository grows past it', () => {
    const at = buildDeltaMeter({ declared: CELL_LIMIT, exercised: 0, exercisedNotDeclared: 0 });
    const over = buildDeltaMeter({
      declared: CELL_LIMIT + 1,
      exercised: 0,
      exercisedNotDeclared: 0,
    });
    assert.equal(at.cells.length, CELL_LIMIT);
    assert.equal(over.cells.length, CELL_LIMIT);
    assert.equal(at.componentsPerCell, 1);
    assert.equal(over.componentsPerCell, 2);
  });

  it('never rounds a non zero exercised count away to nothing', () => {
    // pydantic-ai-exercised: 2 of 952 is a quarter of a cell, and the rail used to draw none of it
    // while its own accessible name said two components were reached.
    const meter = buildDeltaMeter({ declared: 952, exercised: 2, exercisedNotDeclared: 1 });
    assert.equal(count(meter.cells, 'exercised'), 1);
    assert.match(meter.label, /^2 of 952 parts a run could reach were seen running\./);
  });

  it('never rounds a non zero unexercised count away either', () => {
    const meter = buildDeltaMeter({ declared: 952, exercised: 951, exercisedNotDeclared: 0 });
    assert.equal(count(meter.cells, 'declared_only'), 1);
    assert.equal(count(meter.cells, 'exercised'), CELL_LIMIT - 1);
  });

  it('fills the whole rail only when nothing was left unexercised', () => {
    const meter = buildDeltaMeter({ declared: 952, exercised: 952, exercisedNotDeclared: 0 });
    assert.equal(count(meter.cells, 'declared_only'), 0);
    assert.equal(count(meter.cells, 'exercised'), CELL_LIMIT);
  });

  it('never rounds a non zero undeclared count away to nothing', () => {
    const meter = buildDeltaMeter({ declared: 952, exercised: 2, exercisedNotDeclared: 1 });
    assert.equal(meter.outside, 1);
  });

  it('draws nothing filled when nothing was exercised', () => {
    const meter = buildDeltaMeter({ declared: 30, exercised: 0, exercisedNotDeclared: 0 });
    assert.equal(count(meter.cells, 'exercised'), 0);
    assert.equal(count(meter.cells, 'declared_only'), 30);
    assert.equal(meter.outside, 0);
    assert.match(meter.label, /Nothing ran that this repository does not write down\./);
  });

  it('names how many parts one cell stands for only when that is not one', () => {
    assert.equal(
      buildDeltaMeter({ declared: 10, exercised: 3, exercisedNotDeclared: 0 }).caption,
      null,
    );
    assert.match(
      buildDeltaMeter({ declared: 952, exercised: 3, exercisedNotDeclared: 0 }).caption ?? '',
      /One cell stands for 8 parts/,
    );
  });

  it('closes the gaps once there are more cells than the sparse rail can carry', () => {
    assert.equal(
      buildDeltaMeter({ declared: DENSE_ABOVE, exercised: 0, exercisedNotDeclared: 0 }).dense,
      false,
    );
    assert.equal(
      buildDeltaMeter({ declared: DENSE_ABOVE + 1, exercised: 0, exercisedNotDeclared: 0 }).dense,
      true,
    );
  });

  it('counts every set with its own basis, including an undeclared count of zero', () => {
    const meter = buildDeltaMeter({ declared: 22, exercised: 14, exercisedNotDeclared: 0 });
    assert.deepEqual(
      meter.counts.map((entry) => [entry.presence, entry.count, entry.basis]),
      [
        ['exercised', 14, 'observed'],
        ['declared_only', 8, 'inferred'],
        ['undeclared', 0, 'observed'],
      ],
    );
  });

  it('reports a repository that declares nothing without inventing a rail', () => {
    const meter = buildDeltaMeter({ declared: 0, exercised: 0, exercisedNotDeclared: 0 });
    assert.equal(meter.cells.length, 0);
    assert.equal(meter.outside, 0);
    assert.equal(meter.declared, 0);
  });

  it('refuses a negative or non finite count rather than drawing it', () => {
    const meter = buildDeltaMeter({
      declared: Number.NaN,
      exercised: -4,
      exercisedNotDeclared: Number.POSITIVE_INFINITY,
    });
    assert.equal(meter.cells.length, 0);
    assert.equal(meter.outside, 0);
  });
});

describe('buildUnmeasuredMeter', () => {
  it('draws the declared set in the fourth state and counts nothing', () => {
    const meter = buildUnmeasuredMeter(32);
    assert.equal(meter.measured, false);
    assert.equal(meter.declared, 32);
    assert.equal(count(meter.cells, 'unmeasured'), 32);
    assert.equal(count(meter.cells, 'declared_only'), 0);
    assert.equal(meter.outside, 0);
    assert.deepEqual(meter.counts, []);
  });

  it('says nothing has been recorded rather than that nothing was reached', () => {
    const meter = buildUnmeasuredMeter(987);
    assert.match(meter.label, /No run has been recorded/);
    assert.doesNotMatch(meter.label, /seen running/);
  });

  it('names the observable subset when the bundle carries both counts', () => {
    // The kind classification is baked into the bundle by packages/report. This workspace may import
    // types and nothing else, so the caption reports the two counts it was given rather than
    // reclassifying. `crewai` writes down 987 and 273 of them are traceable.
    assert.match(
      buildUnmeasuredMeter(273, { observable: 273, totalWritten: 987 }).caption ?? '',
      /273 of 987 parts a run can reach/,
    );
    assert.match(buildUnmeasuredMeter(32).caption ?? '', /Parts a run can reach/);
  });

  it('holds the same ceiling as the measured rail', () => {
    const meter = buildUnmeasuredMeter(1726);
    assert.equal(meter.cells.length, CELL_LIMIT);
    assert.equal(meter.componentsPerCell, 15);
    assert.equal(meter.dense, true);
  });

  it('draws nothing for a repository that declares nothing', () => {
    const meter = buildUnmeasuredMeter(0);
    assert.equal(meter.cells.length, 0);
    assert.equal(meter.declared, 0);
  });
});
