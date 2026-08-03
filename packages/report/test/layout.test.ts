import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGraph, componentDraft, edgeDraft } from '@orchescope/testkit';
import { layoutGraph } from '../src/layout.ts';

/**
 * Layout tests.
 *
 * Two properties matter and neither is about where any particular node lands. The drawing has to be
 * roughly square, because it is rendered into a canvas that is wider than it is tall and a ribbon fits
 * into that at a scale that hides everything. And it has to be the same on every machine and on every
 * run, because a map that rearranges itself between two readings of the same report is not evidence.
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

const extent = (result: ReturnType<typeof layoutGraph>) => {
  const points = [...result.positions.values()];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
};

describe('layoutGraph', () => {
  /**
   * This is the property the previous layered layout failed. Every agent system in the corpus is hub and
   * spoke, and a layered layout puts every leaf of a hub in one rank, which made
   * `openai-agents-python` 848 by 19050. The canvas is wider than it is tall, so a ribbon of that shape
   * fits at a scale where nothing can be read.
   */
  it('keeps a star roughly square however many leaves it has', () => {
    for (const leaves of [8, 40, 200, 600]) {
      const { width, height } = extent(layoutGraph(star(leaves).graph));
      const aspect = width / height;
      assert.ok(
        aspect > 0.7 && aspect < 1.4,
        `a star of ${leaves} leaves laid out at aspect ${aspect.toFixed(2)}, ${width} by ${height}`,
      );
    }
  });

  it('grows the drawing with the square root of the node count rather than with the count', () => {
    const small = extent(layoutGraph(star(40).graph));
    const large = extent(layoutGraph(star(400).graph));
    // Ten times the nodes over an area, so a bit over three times across, not ten times.
    const growth = large.width / small.width;
    assert.ok(
      growth > 2 && growth < 5,
      `width grew ${growth.toFixed(2)} times for ten times the nodes`,
    );
  });

  it('puts the busiest component at the centre, because that is what a reader looks for first', () => {
    const { graph, idOf } = star(12);
    const result = layoutGraph(graph);
    assert.deepEqual(result.positions.get(idOf('hub')), { x: 0, y: 0 });
  });

  /**
   * A component with no relation is not part of any topology. In `openai-agents-python` that is 1091 of
   * 1390, and positioning them drew a thousand anonymous circles that nothing connected to.
   */
  it('positions nothing for a component that takes part in no relation', () => {
    const { graph, idOf } = graphOf(['hub', 'leaf', 'orphan'], [['hub', 'leaf'] as const]);
    const result = layoutGraph(graph);
    assert.equal(result.positions.has(idOf('hub')), true);
    assert.equal(result.positions.has(idOf('leaf')), true);
    assert.equal(result.positions.has(idOf('orphan')), false);
  });

  it('positions nothing at all when no component takes part in a relation', () => {
    const result = layoutGraph(graphOf(['a', 'b', 'c'], []).graph);
    assert.equal(result.positions.size, 0);
    assert.equal(result.fallback, false);
  });

  it('answers an empty graph without inventing a drawing for it', () => {
    const result = layoutGraph(buildGraph([]));
    assert.equal(result.positions.size, 0);
    assert.equal(result.width, 0);
    assert.equal(result.height, 0);
  });

  it('gives the same coordinates every time, so a report does not rearrange itself', () => {
    const { graph } = star(60);
    const first = layoutGraph(graph);
    const second = layoutGraph(graph);
    assert.deepEqual([...first.positions].sort(), [...second.positions].sort());
  });

  /**
   * Iteration order over the components must not reach the coordinates, or two machines that walked a
   * directory in different orders would produce two different maps of the same repository.
   */
  it('does not depend on the order the components arrive in', () => {
    const { graph } = star(30);
    const reversed = {
      ...graph,
      components: [...graph.components].reverse(),
      edges: [...graph.edges].reverse(),
    };
    const forward = layoutGraph(graph);
    const backward = layoutGraph(reversed);
    for (const [id, point] of forward.positions) {
      assert.deepEqual(backward.positions.get(id), point, `component ${id} moved`);
    }
  });

  it('keeps every node it positioned inside the extent it reports', () => {
    const result = layoutGraph(star(120).graph);
    for (const point of result.positions.values()) {
      assert.ok(
        Math.abs(point.x) <= result.width / 2 + 1,
        `x ${point.x} is outside the reported width`,
      );
      assert.ok(
        Math.abs(point.y) <= result.height / 2 + 1,
        `y ${point.y} is outside the reported height`,
      );
    }
  });
});
