/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDeltaBar, CELL_LIMIT, DENSE_ABOVE } from '../src/delta-bar.ts';

describe('buildDeltaBar below the ceiling', () => {
  it('draws one cell per declared component, filled where a run reached it', () => {
    const bar = buildDeltaBar({ declared: 22, exercised: 15, exercisedNotDeclared: 1 });
    assert.equal(bar.cells.length, 22);
    assert.equal(bar.cells.filter(Boolean).length, 15);
    assert.equal(bar.componentsPerCell, 1);
    assert.equal(bar.outside, 1);
    assert.match(bar.caption, /Each cell is one declared component/);
  });

  it('fills from the left, so the boundary between met and unmet is one edge', () => {
    const bar = buildDeltaBar({ declared: 5, exercised: 2, exercisedNotDeclared: 0 });
    assert.deepEqual([...bar.cells], [true, true, false, false, false]);
  });

  it('states the real counts in the accessible name rather than the drawn ones', () => {
    const bar = buildDeltaBar({ declared: 22, exercised: 15, exercisedNotDeclared: 1 });
    assert.match(bar.label, /15 of 22 declared components were exercised/);
    assert.match(bar.label, /1 component ran that was never declared/);
  });

  it('says so when nothing ran outside the declared set, rather than leaving it unsaid', () => {
    const bar = buildDeltaBar({ declared: 4, exercised: 4, exercisedNotDeclared: 0 });
    assert.equal(bar.outside, 0);
    assert.match(bar.label, /Nothing ran that this repository does not declare/);
  });

  it('closes the gap between cells once they are too narrow to keep it', () => {
    assert.equal(
      buildDeltaBar({ declared: 22, exercised: 1, exercisedNotDeclared: 0 }).dense,
      false,
    );
    assert.equal(
      buildDeltaBar({ declared: DENSE_ABOVE + 1, exercised: 1, exercisedNotDeclared: 0 }).dense,
      true,
    );
  });
});

describe('buildDeltaBar above the ceiling', () => {
  it('caps the cell count and says what one cell now stands for', () => {
    const bar = buildDeltaBar({ declared: 917, exercised: 3, exercisedNotDeclared: 1 });
    assert.ok(bar.cells.length <= CELL_LIMIT);
    assert.equal(bar.componentsPerCell, Math.ceil(917 / CELL_LIMIT));
    assert.match(bar.caption, /Each cell stands for 8 declared components/);
    assert.match(bar.caption, /proportion rather than which ones/);
  });

  it('keeps the drawn proportion within a cell of the measured rate', () => {
    const bar = buildDeltaBar({ declared: 917, exercised: 400, exercisedNotDeclared: 0 });
    const drawn = bar.cells.filter(Boolean).length / bar.cells.length;
    assert.ok(Math.abs(drawn - 400 / 917) < 1 / bar.cells.length);
  });

  it('reports the real counts in the accessible name even when the drawing is rounded', () => {
    const bar = buildDeltaBar({ declared: 917, exercised: 3, exercisedNotDeclared: 1 });
    assert.match(bar.label, /3 of 917 declared components were exercised/);
  });

  // One undeclared component in nine hundred is the entire reason the boundary is drawn. A bar that
  // rounded it away would be reporting the absence of the thing the delta exists to find.
  it('never rounds a component that ran outside the declared set down to nothing', () => {
    const bar = buildDeltaBar({ declared: 917, exercised: 3, exercisedNotDeclared: 1 });
    assert.equal(bar.outside, 1);
  });
});

describe('buildDeltaBar on degenerate input', () => {
  it('draws no cells when nothing is declared', () => {
    const bar = buildDeltaBar({ declared: 0, exercised: 0, exercisedNotDeclared: 0 });
    assert.equal(bar.cells.length, 0);
    assert.equal(bar.outside, 0);
  });

  it('never fills more cells than there are components', () => {
    const bar = buildDeltaBar({ declared: 3, exercised: 99, exercisedNotDeclared: 0 });
    assert.equal(bar.cells.length, 3);
    assert.equal(bar.cells.filter(Boolean).length, 3);
  });

  it('treats a negative or non finite count as nothing rather than throwing', () => {
    const bar = buildDeltaBar({
      declared: Number.NaN,
      exercised: -4,
      exercisedNotDeclared: Number.POSITIVE_INFINITY,
    });
    assert.equal(bar.cells.length, 0);
    assert.equal(bar.outside, 0);
  });

  it('uses the singular where the count is one', () => {
    const bar = buildDeltaBar({ declared: 1, exercised: 1, exercisedNotDeclared: 0 });
    assert.match(bar.label, /1 of 1 declared component was exercised/);
  });
});
