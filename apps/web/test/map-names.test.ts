import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearNames,
  type DrawnName,
  namesAllFit,
  namesFit,
  nameRoom,
  zoomForNames,
} from '../src/map-names.ts';

/**
 * The map's naming rule.
 *
 * Two things are guarded. A limit has to behave like a limit: a canvas that will not name a drawing at
 * the fitted view is stating a fact about the room available, and the same canvas refusing at five times
 * magnification, where each node has half the canvas to itself, is stating nothing and reads as a fault.
 * And the promise has to be true: below the scale at which every name is clear the canvas forces every
 * label past the renderer's collision grid, so if that scale is wrong the map prints one name over
 * another and says nothing about it.
 */

/** A name at a point. The identifier only has to be distinct, so it is the point it sits at. */
const at = (x: number, y: number, chars = 10, weight = 0): DrawnName => ({
  id: `${x},${y}`,
  x,
  y,
  chars,
  weight,
});

describe('a drawing with nothing to collide', () => {
  it('needs no room at all for one name, or for none', () => {
    assert.deepEqual(nameRoom([]), { nameEvery: 0, nameSome: 0 });
    assert.deepEqual(nameRoom([at(0, 0)]), { nameEvery: 0, nameSome: 0 });
  });

  it('names at any scale that is a view of something', () => {
    const room = nameRoom([at(0, 0)]);
    assert.equal(namesFit(0.1, room), true);
    assert.equal(namesAllFit(0.1, room), true);
  });
});

describe('two names on the same line', () => {
  /**
   * Ten characters is 9 + 66 pixels of label. Seventy five units apart, the second node has to clear the
   * first name and its own six pixel radius, so the two come apart at 81 / 75.
   */
  const room = nameRoom([at(0, 0), at(75, 0)]);

  it('needs the name and the node beyond it to fit in the gap', () => {
    assert.equal(room.nameEvery, 81 / 75);
    assert.equal(namesAllFit(81 / 75, room), true);
    assert.equal(namesAllFit(1.07, room), false);
  });

  it('needs only the first characters of one for a name to be worth drawing', () => {
    assert.ok(room.nameSome < room.nameEvery);
    assert.equal(namesFit(room.nameSome, room), true);
  });

  it('separates them by widening the gap rather than by zooming', () => {
    assert.ok(nameRoom([at(0, 0), at(150, 0)]).nameEvery < room.nameEvery);
  });

  /**
   * A name with a node drawn through it has a hole where two characters were, and in the dark theme the
   * hole is the same near white the name is set in. It is the hover plate's defect at the scale of two
   * characters, so a name a node sits inside is not counted as drawn.
   */
  it('will not draw a name that a node is in the middle of', () => {
    const behind = { ...at(0, 0, 20), id: 'behind', weight: 9 };
    const inTheWay = { ...at(60, 0, 4), id: 'in-the-way', weight: 1 };
    assert.equal(clearNames([behind, inTheWay], 1).has('behind'), false);
  });
});

describe('two names on different lines', () => {
  it('clears them once a line of type fits between, however close they are across', () => {
    // Fourteen pixels of line at a scale of one is fourteen units apart.
    const room = nameRoom([at(0, 0), at(1, 14)]);
    assert.equal(room.nameEvery, 1);
    assert.equal(namesAllFit(1, room), true);
  });

  it('is why a staggered arrangement names more than a lattice of the same pitch', () => {
    const lattice = nameRoom([at(0, 0), at(130, 0), at(260, 0)]);
    const staggered = nameRoom([at(0, 0), at(130, 33), at(260, 0)]);
    assert.ok(staggered.nameEvery < lattice.nameEvery);
  });
});

describe('a drawing that can never name everything', () => {
  it('reports an unreachable scale rather than a false promise when two nodes share a point', () => {
    const room = nameRoom([at(0, 0), at(0, 0)]);
    assert.equal(room.nameEvery, Number.POSITIVE_INFINITY);
    assert.equal(namesAllFit(1e6, room), false);
    assert.equal(zoomForNames(1, room), null);
  });
});

describe('the scale the canvas is at', () => {
  const room = nameRoom([at(0, 0), at(75, 0)]);

  it('never names at a scale that is not a view of anything', () => {
    assert.equal(namesFit(0, room), false);
    assert.equal(namesFit(-1, room), false);
    assert.equal(namesFit(Number.NaN, room), false);
    assert.equal(namesAllFit(Number.POSITIVE_INFINITY, room), false);
  });

  it('names more as the camera closes in and less as it pulls back', () => {
    assert.equal(namesAllFit(2, room), true);
    assert.equal(namesAllFit(0.5, room), false);
  });
});

describe('zoomForNames', () => {
  const room = nameRoom([at(0, 0), at(75, 0)]);

  it('asks for no magnification when every name is already there', () => {
    assert.equal(zoomForNames(room.nameEvery, room), 1);
    assert.equal(zoomForNames(4, room), 1);
  });

  it('reports the magnification that makes the names arrive, and it is the one that does', () => {
    for (const scale of [0.5, 0.25, 0.1]) {
      const factor = zoomForNames(scale, room);
      assert.ok(factor !== null && factor > 1, `${scale} should need magnifying`);
      assert.equal(namesAllFit(scale * factor, room), true, `${scale} at ${String(factor)} times`);
    }
  });
});

/**
 * The corpus drawings the old ceiling of 120 got wrong. It promised that every one of 120 components
 * would be named, and a ring of 26 already printed two names on top of each other.
 */
describe('a ring of the size the old ceiling passed', () => {
  const ring = (count: number, radius: number, chars: number): readonly DrawnName[] =>
    Array.from({ length: count }, (_, index) => {
      const angle = (2 * Math.PI * index) / count;
      return {
        id: `ring-${index}`,
        x: Math.round(radius * Math.cos(angle)),
        y: Math.round(radius * Math.sin(angle)),
        chars,
        weight: 0,
      };
    });

  it('needs more than the fitted view to name every one of twenty six names', () => {
    const room = nameRoom(ring(26, 400, 20));
    // The drawing is 800 units across and the canvas is 640 tall, so the fitted view is under a
    // pixel per unit. Every name clear needs several times that.
    assert.ok(room.nameEvery > 0.8, `needed ${room.nameEvery}`);
    assert.equal(namesAllFit(0.72, room), false);
  });

  it('has room for the first characters of a name at that same view', () => {
    const room = nameRoom(ring(26, 400, 20));
    assert.equal(namesFit(0.72, room), true);
    assert.ok(room.nameSome < room.nameEvery);
  });
});

/**
 * Which names survive when they cannot all be drawn.
 *
 * This is the state the old ceiling never admitted to and the renderer's own collision grid handled
 * badly. The grid reserves a cell the width of a name and drops everything else in it, which leaves out
 * six names on the demonstration where two had to go. What is kept here is worked out from the labels
 * themselves, busiest first, so a reader loses the fewest names and never the busiest.
 */
describe('choosing which names to keep', () => {
  it('keeps every name when they are all clear', () => {
    const names = [at(0, 0), at(0, 100), at(0, 200)];
    assert.equal(clearNames(names, 1).size, 3);
  });

  it('drops only what has to go, rather than everything sharing a grid cell', () => {
    // Four names 40 units apart on one line, each 75 pixels of label: at one pixel per unit only the
    // last has nothing in front of it, and by four they all fit.
    const names = [at(0, 0), at(40, 0), at(80, 0), at(120, 0)];
    assert.equal(clearNames(names, 1).size, 1);
    assert.equal(clearNames(names, 4).size, 4);
  });

  it('keeps the busiest component when two cannot both have a name', () => {
    const quiet = { ...at(0, 0), id: 'quiet', weight: 1 };
    const busy = { ...at(40, 0), id: 'busy', weight: 9 };
    const kept = clearNames([quiet, busy], 1);
    assert.equal(kept.has('busy'), true);
    assert.equal(kept.has('quiet'), false);
  });

  it('breaks a tie on the identifier, so which name survives cannot depend on arrival order', () => {
    const first = { ...at(0, 0), id: 'a', weight: 3 };
    const second = { ...at(40, 0), id: 'b', weight: 3 };
    assert.deepEqual([...clearNames([first, second], 1)], [...clearNames([second, first], 1)]);
  });

  it('keeps more as the camera closes in', () => {
    const names = [at(0, 0), at(40, 0), at(80, 0), at(120, 0)];
    assert.ok(clearNames(names, 4).size > clearNames(names, 1).size);
  });

  it('keeps nothing at a scale that is not a view of anything', () => {
    assert.equal(clearNames([at(0, 0), at(40, 0)], 0).size, 0);
    assert.equal(clearNames([at(0, 0), at(40, 0)], Number.NaN).size, 0);
  });

  it('agrees with the scale at which every name is clear', () => {
    const names = [at(0, 0), at(75, 0), at(150, 0)];
    const room = nameRoom(names);
    assert.equal(clearNames(names, room.nameEvery).size, names.length);
    assert.ok(clearNames(names, room.nameEvery / 2).size < names.length);
  });
});
