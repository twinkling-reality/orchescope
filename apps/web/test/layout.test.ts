/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  circlePoint,
  LAYOUT_X_KEY,
  LAYOUT_Y_KEY,
  readLayoutPoint,
  resolveLayout,
} from '../src/layout.ts';

describe('readLayoutPoint', () => {
  it('reads a stored coordinate pair', () => {
    assert.deepEqual(readLayoutPoint({ [LAYOUT_X_KEY]: 3, [LAYOUT_Y_KEY]: -4 }), { x: 3, y: -4 });
  });

  it('refuses a partial, non numeric or non finite pair', () => {
    assert.equal(readLayoutPoint({}), null);
    assert.equal(readLayoutPoint({ [LAYOUT_X_KEY]: 1 }), null);
    assert.equal(readLayoutPoint({ [LAYOUT_X_KEY]: '1', [LAYOUT_Y_KEY]: 2 }), null);
    assert.equal(readLayoutPoint({ [LAYOUT_X_KEY]: Number.NaN, [LAYOUT_Y_KEY]: 2 }), null);
    assert.equal(
      readLayoutPoint({ [LAYOUT_X_KEY]: Number.POSITIVE_INFINITY, [LAYOUT_Y_KEY]: 2 }),
      null,
    );
  });
});

describe('circlePoint', () => {
  it('puts the first slot to the right of the centre', () => {
    const point = circlePoint(0, 4, 10, { x: 1, y: 2 });
    assert.equal(Math.round(point.x), 11);
    assert.equal(Math.round(point.y), 2);
  });

  it('treats a count of zero as a single slot rather than dividing by it', () => {
    const point = circlePoint(0, 0, 5, { x: 0, y: 0 });
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  });
});

describe('resolveLayout', () => {
  const stored = (id: string, x: number, y: number) => ({
    id,
    metadata: { [LAYOUT_X_KEY]: x, [LAYOUT_Y_KEY]: y },
  });

  it('uses stored coordinates unchanged', () => {
    const result = resolveLayout([stored('a', 5, 6), stored('b', -1, -2)]);
    assert.deepEqual(result.positions.get('a'), { x: 5, y: 6 });
    assert.deepEqual(result.positions.get('b'), { x: -1, y: -2 });
    assert.deepEqual(result.fallbackIds, []);
  });

  it('places components with no stored coordinate and reports which they were', () => {
    const result = resolveLayout([
      stored('a', 0, 0),
      { id: 'z', metadata: {} },
      { id: 'm', metadata: {} },
    ]);
    assert.deepEqual(result.fallbackIds, ['m', 'z']);
    assert.ok(result.positions.has('m'));
    assert.ok(result.positions.has('z'));
  });

  it('is deterministic and independent of input order', () => {
    const items = [
      { id: 'c', metadata: {} },
      { id: 'a', metadata: {} },
      { id: 'b', metadata: {} },
    ];
    const first = resolveLayout(items);
    const second = resolveLayout([...items].reverse());
    for (const id of ['a', 'b', 'c']) {
      assert.deepEqual(
        first.positions.get(id),
        second.positions.get(id),
        `position of ${id} moved`,
      );
    }
  });

  it('gives the same answer when called twice with the same input', () => {
    const items = [stored('a', 2, 2), { id: 'b', metadata: {} }];
    assert.deepEqual([...resolveLayout(items).positions], [...resolveLayout(items).positions]);
  });

  it('places the fallback ring outside the stored coordinates', () => {
    const result = resolveLayout([
      stored('a', 10, 0),
      stored('b', -10, 0),
      { id: 'c', metadata: {} },
    ]);
    const placed = result.positions.get('c');
    assert.ok(placed !== undefined);
    assert.ok(
      Math.hypot(placed.x, placed.y) > 10,
      'the fallback ring should sit outside the known extent',
    );
  });

  it('handles a graph where nothing has a stored coordinate', () => {
    const result = resolveLayout([
      { id: 'a', metadata: {} },
      { id: 'b', metadata: {} },
    ]);
    assert.equal(result.positions.size, 2);
    for (const point of result.positions.values()) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  });
});
