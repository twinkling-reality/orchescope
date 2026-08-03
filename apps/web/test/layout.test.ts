/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_LAYOUT,
  LAYOUT_RANK_KEY,
  MAP_LAYOUT_KEYS,
  positionsFor,
  readLayoutPoint,
  resolveLayout,
} from '../src/layout.ts';

const RING = MAP_LAYOUT_KEYS[0];
const DOWN = MAP_LAYOUT_KEYS[1];
const RIGHT = MAP_LAYOUT_KEYS[2];
assert.ok(RING !== undefined && DOWN !== undefined && RIGHT !== undefined);

describe('readLayoutPoint', () => {
  it('reads a stored coordinate pair', () => {
    assert.deepEqual(readLayoutPoint({ [RING.x]: 3, [RING.y]: -4 }), { x: 3, y: -4 });
  });

  it('reads whichever arrangement it is asked for', () => {
    const metadata = { [RING.x]: 1, [RING.y]: 2, [DOWN.x]: 30, [DOWN.y]: -40 };
    assert.deepEqual(readLayoutPoint(metadata, RING), { x: 1, y: 2 });
    assert.deepEqual(readLayoutPoint(metadata, DOWN), { x: 30, y: -40 });
    assert.equal(readLayoutPoint(metadata, RIGHT), null);
  });

  it('refuses a partial, non numeric or non finite pair', () => {
    assert.equal(readLayoutPoint({}), null);
    assert.equal(readLayoutPoint({ [RING.x]: 1 }), null);
    assert.equal(readLayoutPoint({ [RING.x]: '1', [RING.y]: 2 }), null);
    assert.equal(readLayoutPoint({ [RING.x]: Number.NaN, [RING.y]: 2 }), null);
    assert.equal(readLayoutPoint({ [RING.x]: Number.POSITIVE_INFINITY, [RING.y]: 2 }), null);
  });
});

describe('resolveLayout', () => {
  const stored = (id: string, x: number, y: number) => ({
    id,
    metadata: { [RING.x]: x, [RING.y]: y },
  });

  it('uses stored coordinates unchanged', () => {
    const result = resolveLayout([stored('a', 5, 6), stored('b', -1, -2)]);
    const ring = positionsFor(result, 'concentric');
    assert.deepEqual(ring.get('a'), { x: 5, y: 6 });
    assert.deepEqual(ring.get('b'), { x: -1, y: -2 });
    assert.deepEqual(result.unplacedIds, []);
  });

  /**
   * An absent coordinate is a decision rather than a gap. The layout positions the components that
   * participate in a relation and leaves the rest alone, so inventing a position here would draw a
   * component the layout deliberately left out. In `openai-agents-python` that would be 1091 anonymous
   * circles no relation touches.
   */
  it('reports a component with no stored coordinate rather than inventing one for it', () => {
    const result = resolveLayout([
      stored('a', 0, 0),
      { id: 'z', metadata: {} },
      { id: 'm', metadata: {} },
    ]);
    assert.deepEqual(result.unplacedIds, ['m', 'z']);
    assert.equal(result.placedIds.has('m'), false);
    assert.equal(result.placedIds.has('z'), false);
    assert.equal(result.placedIds.size, 1);
  });

  it('reports the unplaced in a stable order whatever order they arrive in', () => {
    const items = [
      { id: 'c', metadata: {} },
      { id: 'a', metadata: {} },
      { id: 'b', metadata: {} },
    ];
    assert.deepEqual(resolveLayout(items).unplacedIds, ['a', 'b', 'c']);
    assert.deepEqual(resolveLayout([...items].reverse()).unplacedIds, ['a', 'b', 'c']);
  });

  it('gives the same answer when called twice with the same input', () => {
    const items = [stored('a', 2, 2), { id: 'b', metadata: {} }];
    assert.deepEqual(
      [...positionsFor(resolveLayout(items), 'concentric')],
      [...positionsFor(resolveLayout(items), 'concentric')],
    );
  });
});

/**
 * The set of components on the map is the same in every arrangement, and the census beside the canvas
 * depends on that. If switching arrangement could add or remove a node, "150 of 987 components are on
 * the map" would be a sentence about a control it does not mention.
 */
describe('resolveLayout across arrangements', () => {
  const everywhere = (id: string) => ({
    id,
    metadata: {
      [RING.x]: 1,
      [RING.y]: 2,
      [DOWN.x]: 3,
      [DOWN.y]: 4,
      [RIGHT.x]: 5,
      [RIGHT.y]: 6,
      [LAYOUT_RANK_KEY]: 2,
    },
  });

  it('lists every arrangement the bundle carries, in the order they are offered', () => {
    const result = resolveLayout([everywhere('a')]);
    assert.deepEqual(result.kinds, ['concentric', 'top_down', 'left_to_right']);
  });

  it('holds one placed set rather than one for each arrangement', () => {
    const result = resolveLayout([everywhere('a'), { id: 'b', metadata: {} }]);
    assert.deepEqual([...result.placedIds], ['a']);
    for (const kind of result.kinds) {
      assert.deepEqual([...positionsFor(result, kind).keys()], ['a'], kind);
    }
  });

  it('reads the depth a directional arrangement recorded', () => {
    assert.equal(resolveLayout([everywhere('a')]).ranks.get('a'), 2);
  });

  it('offers only the concentric arrangement for a bundle written before the others existed', () => {
    const result = resolveLayout([{ id: 'a', metadata: { [RING.x]: 0, [RING.y]: 0 } }]);
    assert.deepEqual(result.kinds, ['concentric']);
    assert.equal(result.ranks.size, 0);
  });

  /** A picker cannot offer what is not there, so an absent arrangement falls back rather than blanks. */
  it('falls back to the arrangement every bundle carries', () => {
    const result = resolveLayout([{ id: 'a', metadata: { [RING.x]: 7, [RING.y]: 8 } }]);
    assert.deepEqual(positionsFor(result, 'top_down').get('a'), { x: 7, y: 8 });
    assert.equal(DEFAULT_LAYOUT, 'concentric');
  });
});
