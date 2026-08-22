import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzePython } from '../src/python/analyze.ts';

const analyze = (text: string) =>
  analyzePython({ file: 'src/graph.py', text, contentHash: 'b'.repeat(64) });

describe('Python router facts', () => {
  it('retains Literal destinations and literal returns with exact locations', async () => {
    const facts = await analyze(`
from typing import Literal

def route(state) -> Literal["finish", "research"]:
    if state.done:
        return "finish"
    return "research"
`);
    const route = facts.definitions.find((definition) => definition.name === 'route');
    assert.deepEqual(
      route?.returnAnnotation?.destinations.map((destination) => [
        destination.value,
        destination.location.startLine,
      ]),
      [
        ['finish', 4],
        ['research', 4],
      ],
    );
    assert.equal(route?.returnAnnotation?.complete, true);
    assert.deepEqual(
      route?.returns?.map((returned) => [returned.value, returned.location.startLine]),
      [
        [{ kind: 'string', value: 'finish' }, 6],
        [{ kind: 'string', value: 'research' }, 7],
      ],
    );
  });

  it('retains dynamic returns as unresolved values and records their branch predicate', async () => {
    const facts = await analyze(`
def route(state):
    if state.count <= configurable.max_loops:
        return "research"
    return choose_destination(state)
`);
    const route = facts.definitions.find((definition) => definition.name === 'route');
    assert.equal(route?.returns?.[0]?.value.kind, 'string');
    assert.equal(route?.returns?.[0]?.predicate?.operator, '<=');
    assert.deepEqual(route?.returns?.[0]?.predicate?.references, [
      ['state', 'count'],
      ['configurable', 'max_loops'],
    ]);
    assert.equal(route?.returns?.[1]?.value.kind, 'call');
    assert.equal(route?.returns?.[1]?.location.startLine, 5);
  });

  it('resolves an aliased standard Literal annotation', async () => {
    const facts = await analyze(`
from typing_extensions import Literal as L

def route(state) -> L["finish", "research"]:
    return "finish"
`);
    const route = facts.definitions.find((definition) => definition.name === 'route');
    assert.equal(route?.returnAnnotation?.complete, true);
    assert.deepEqual(
      route?.returnAnnotation?.destinations.map((destination) => destination.value),
      ['finish', 'research'],
    );
  });

  it('does not treat a local Literal lookalike as a route contract', async () => {
    const facts = await analyze(`
class Literal:
    pass

def route(state) -> Literal["finish"]:
    return state.destination
`);
    const route = facts.definitions.find((definition) => definition.name === 'route');
    assert.equal(route?.returnAnnotation?.complete, false);
    assert.deepEqual(route?.returnAnnotation?.destinations, []);
  });

  it('does not attribute a nested function return to its outer router', async () => {
    const facts = await analyze(`
def route(state) -> Literal["finish"]:
    def nested():
        return "not_a_route"
    return "finish"
`);
    const route = facts.definitions.find((definition) => definition.name === 'route');
    assert.deepEqual(
      route?.returns?.map((returned) =>
        returned.value.kind === 'string' ? returned.value.value : returned.value.kind,
      ),
      ['finish'],
    );
  });
});
