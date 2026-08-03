import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGraph, componentDraft, edgeDraft } from '@orchescope/testkit';
import { type FlowDirection, layoutLayered } from '../src/layered-layout.ts';
import { layoutGraph } from '../src/layout.ts';

/**
 * Directional layout tests, and the properties are not the ring's properties.
 *
 * The ring is judged on being square and stable, and nothing else, because a ring has no meaning in
 * where any particular node lands. A directional layout does: the whole reason to offer it is that
 * position carries the order of the flow, so most of what is checked here is that the order is real.
 * Everything downstream of a component is further along than it, the drawing is still roughly square
 * however wide a rank gets, two neighbours in a line never share a horizontal line of type, and both
 * arrangements position exactly the components the ring positions.
 *
 * The last one is load bearing beyond the drawing. The census beside the canvas says how many components
 * are on the map, and it says it once. If switching arrangement changed the answer, the sentence would be
 * about a control it does not mention.
 */

const graphOf = (names: readonly string[], relations: readonly (readonly [string, string])[]) => {
  const drafts = new Map(names.map((name) => [name, componentDraft({ kind: 'agent', name })]));
  const draftOf = (name: string) => {
    const found = drafts.get(name);
    assert.ok(found !== undefined, `no component named ${name}`);
    return found;
  };
  const graph = buildGraph(
    [...drafts.values()],
    relations.map(([from, to]) => edgeDraft('calls_tool', draftOf(from), draftOf(to))),
  );
  const idOf = (name: string): string => {
    const found = graph.components.find((component) => component.displayName === name);
    assert.ok(found !== undefined, `no component named ${name}`);
    return found.id;
  };
  return { graph, idOf };
};

const star = (leaves: number) => {
  const names = ['hub', ...Array.from({ length: leaves }, (_, i) => `leaf-${i}`)];
  return graphOf(
    names,
    names.slice(1).map((name) => ['hub', name] as const),
  );
};

/** A chain of hops, which is the shape a directional layout exists to draw. */
const chain = (length: number) => {
  const names = Array.from({ length }, (_, i) => `step-${i}`);
  return graphOf(
    names,
    names.slice(1).map((name, index) => [`step-${index}`, name] as const),
  );
};

const extent = (result: ReturnType<typeof layoutLayered>) => {
  const points = [...result.positions.values()];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

/** How far along the flow a point sits, whichever way the flow points. */
const along = (direction: FlowDirection, point: { x: number; y: number }): number =>
  direction === 'right' ? point.x : -point.y;

const DIRECTIONS: readonly FlowDirection[] = ['down', 'right'];

describe('the flow is real', () => {
  it('puts everything a component calls further along than the component', () => {
    for (const direction of DIRECTIONS) {
      const { graph, idOf } = chain(6);
      const result = layoutLayered(graph, direction);
      for (let step = 0; step < 5; step += 1) {
        const here = result.positions.get(idOf(`step-${step}`));
        const next = result.positions.get(idOf(`step-${step + 1}`));
        assert.ok(here !== undefined && next !== undefined);
        assert.ok(
          along(direction, next) > along(direction, here),
          `${direction}: step ${step + 1} is not past step ${step}`,
        );
      }
    }
  });

  it('puts a hub ahead of every leaf it calls, however many there are', () => {
    for (const direction of DIRECTIONS) {
      const { graph, idOf } = star(40);
      const result = layoutLayered(graph, direction);
      const hub = result.positions.get(idOf('hub'));
      assert.ok(hub !== undefined);
      for (let leaf = 0; leaf < 40; leaf += 1) {
        const point = result.positions.get(idOf(`leaf-${leaf}`));
        assert.ok(point !== undefined);
        assert.ok(along(direction, point) > along(direction, hub), `${direction}: leaf ${leaf}`);
      }
    }
  });

  it('reports the depth it drew, counting hops from something nothing calls', () => {
    const { graph, idOf } = chain(4);
    const result = layoutLayered(graph, 'down');
    assert.equal(result.ranks.get(idOf('step-0')), 0);
    assert.equal(result.ranks.get(idOf('step-3')), 3);
  });

  /** A cycle has no first member. Something has to be chosen, and every machine has to choose it. */
  it('opens a cycle rather than refusing to rank it', () => {
    const { graph, idOf } = graphOf(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ],
    );
    const result = layoutLayered(graph, 'down');
    assert.equal(result.positions.size, 3);
    const depths = ['a', 'b', 'c'].map((name) => result.ranks.get(idOf(name)));
    assert.equal(new Set(depths).size, 3, `every member of the cycle got its own depth: ${depths}`);
  });
});

/**
 * The property the layout this replaces failed. One rank per line put a hub's 98 leaves on one line and
 * made `pydantic-ai` 67600 by 400, which is a ribbon of aspect 169 rendered into a canvas of aspect 1.4.
 * Wrapping the rank is what removes it, so this is the test that stops it coming back.
 */
describe('the drawing stays roughly square however wide a rank gets', () => {
  it('holds for a star of 8, 40, 200 or 600 leaves', () => {
    for (const direction of DIRECTIONS) {
      for (const leaves of [8, 40, 200, 600]) {
        const { width, height } = extent(layoutLayered(star(leaves).graph, direction));
        const aspect = width / height;
        assert.ok(
          aspect > 0.5 && aspect < 2,
          `${direction}: a star of ${leaves} laid out at aspect ${aspect.toFixed(2)}, ${width} by ${height}`,
        );
      }
    }
  });

  it('grows with the square root of the leaf count rather than with the count', () => {
    const small = extent(layoutLayered(star(40).graph, 'down'));
    const large = extent(layoutLayered(star(400).graph, 'down'));
    const growth = large.width / small.width;
    assert.ok(
      growth > 2 && growth < 5,
      `width grew ${growth.toFixed(2)} times for ten times the nodes`,
    );
  });

  /**
   * A chain is the one shape that cannot be squared, because every hop is a rank and a rank cannot wrap
   * into itself. The layout says so by growing in one direction, which is the honest drawing of a
   * pipeline, rather than by pretending.
   */
  it('does not pretend a chain is square, because a chain is not', () => {
    const { width, height } = extent(layoutLayered(chain(12).graph, 'down'));
    assert.equal(width, 0);
    assert.ok(height > 0);
  });
});

describe('two names in a line never share a line of type', () => {
  it('offsets neighbours so a horizontal name has somewhere to go', () => {
    for (const direction of DIRECTIONS) {
      const result = layoutLayered(star(40).graph, direction);
      const points = [...result.positions.values()];
      let sharing = 0;
      for (const [index, point] of points.entries()) {
        for (const other of points.slice(index + 1)) {
          if (point.y === other.y && Math.abs(point.x - other.x) < 260) sharing += 1;
        }
      }
      assert.equal(
        sharing,
        0,
        `${direction}: ${sharing} pairs share a line within one name's width`,
      );
    }
  });
});

describe('the same components as the ring, and the same every time', () => {
  it('positions exactly what the concentric layout positions', () => {
    for (const direction of DIRECTIONS) {
      for (const graph of [star(40).graph, chain(9).graph]) {
        const ring = new Set(layoutGraph(graph).positions.keys());
        const layered = new Set(layoutLayered(graph, direction).positions.keys());
        assert.deepEqual([...layered].sort(), [...ring].sort(), direction);
      }
    }
  });

  it('positions nothing for a component that takes part in no relation', () => {
    const { graph, idOf } = graphOf(['hub', 'leaf', 'orphan'], [['hub', 'leaf'] as const]);
    const result = layoutLayered(graph, 'down');
    assert.equal(result.positions.has(idOf('hub')), true);
    assert.equal(result.positions.has(idOf('orphan')), false);
  });

  it('answers an empty graph without inventing a drawing for it', () => {
    const result = layoutLayered(buildGraph([]), 'down');
    assert.equal(result.positions.size, 0);
    assert.equal(result.width, 0);
    assert.equal(result.height, 0);
  });

  it('gives the same coordinates every time, so a report does not rearrange itself', () => {
    const { graph } = star(60);
    assert.deepEqual(
      [...layoutLayered(graph, 'down').positions].sort(),
      [...layoutLayered(graph, 'down').positions].sort(),
    );
  });

  /**
   * Iteration order over the components must not reach the coordinates, or two machines that walked a
   * directory in different orders would produce two different maps of the same repository.
   */
  it('does not depend on the order the components arrive in', () => {
    for (const direction of DIRECTIONS) {
      const { graph } = star(30);
      const reversed = {
        ...graph,
        components: [...graph.components].reverse(),
        edges: [...graph.edges].reverse(),
      };
      const forward = layoutLayered(graph, direction);
      const backward = layoutLayered(reversed, direction);
      for (const [id, point] of forward.positions) {
        assert.deepEqual(backward.positions.get(id), point, `${direction}: component ${id} moved`);
      }
    }
  });

  /**
   * The ring is centred on the origin, so its extent test can be written about the distance from it.
   * This one is not: rank zero sits at the origin and the drawing grows away from it, so the property
   * is that every node is inside the reported box rather than inside a radius.
   */
  it('keeps every node it positioned inside the extent it reports', () => {
    for (const direction of DIRECTIONS) {
      const result = layoutLayered(star(120).graph, direction);
      const points = [...result.positions.values()];
      const left = Math.min(...points.map((point) => point.x));
      const top = Math.min(...points.map((point) => point.y));
      for (const point of points) {
        assert.ok(
          point.x - left <= result.width,
          `${direction}: x ${point.x} is outside the width`,
        );
        assert.ok(
          point.y - top <= result.height,
          `${direction}: y ${point.y} is outside the height`,
        );
      }
    }
  });
});

/**
 * Sigma's y axis points up, so a rank further along renders higher unless the layout negates it. The
 * drawing read bottom up until it did, which no arithmetic about extents would have caught.
 */
describe('down means down on the screen', () => {
  it('gives a later rank a smaller y, which is lower once the renderer flips the axis', () => {
    const { graph, idOf } = chain(3);
    const result = layoutLayered(graph, 'down');
    const first = result.positions.get(idOf('step-0'));
    const last = result.positions.get(idOf('step-2'));
    assert.ok(first !== undefined && last !== undefined);
    assert.ok(last.y < first.y, `step-2 at y ${last.y} is not below step-0 at y ${first.y}`);
  });

  it('gives a later rank a larger x when the flow points right', () => {
    const { graph, idOf } = chain(3);
    const result = layoutLayered(graph, 'right');
    const first = result.positions.get(idOf('step-0'));
    const last = result.positions.get(idOf('step-2'));
    assert.ok(first !== undefined && last !== undefined);
    assert.ok(last.x > first.x);
  });
});
