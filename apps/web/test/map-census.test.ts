/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMapCensus } from '../src/map-census.ts';
import { component } from './fixture.ts';

const of = (id: string, kind: string) => component({ id, kind } as Parameters<typeof component>[0]);

describe('buildMapCensus', () => {
  it('counts what the map draws against what the repository declares', () => {
    const components = [of('a:1', 'agent'), of('t:1', 'tool'), of('p:1', 'prompt')];
    const census = buildMapCensus(components, new Set(['a:1', 't:1']));
    assert.equal(census.declared, 3);
    assert.equal(census.drawn, 2);
  });

  // "370 prompts and two of them are wired to anything" is a fact a reader can act on. "1091 components
  // are not drawn" is only a number.
  it('names the kinds that are left out, worst first', () => {
    const components = [
      ...Array.from({ length: 10 }, (_, i) => of(`p:${i}`, 'prompt')),
      ...Array.from({ length: 4 }, (_, i) => of(`a:${i}`, 'agent')),
      of('t:0', 'tool'),
    ];
    const census = buildMapCensus(components, new Set(['p:0', 'a:0', 'a:1', 'a:2', 't:0']));
    assert.deepEqual(
      census.omitted.map((row) => [row.kind, row.declared, row.drawn]),
      [
        ['prompt', 10, 1],
        ['agent', 4, 3],
      ],
    );
  });

  it('does not list a kind the map draws entirely', () => {
    const components = [of('a:1', 'agent'), of('p:1', 'prompt')];
    const census = buildMapCensus(components, new Set(['a:1']));
    assert.deepEqual(
      census.omitted.map((row) => row.kind),
      ['prompt'],
    );
  });

  it('reports nothing omitted when every component is drawn', () => {
    const components = [of('a:1', 'agent'), of('t:1', 'tool')];
    const census = buildMapCensus(components, new Set(['a:1', 't:1']));
    assert.deepEqual(census.omitted, []);
    assert.equal(census.drawn, census.declared);
  });

  it('breaks a tie on the kind so the order cannot depend on insertion', () => {
    const components = [of('z:1', 'zebra'), of('a:1', 'antelope')];
    const census = buildMapCensus(components, new Set());
    assert.deepEqual(
      census.omitted.map((row) => row.kind),
      ['antelope', 'zebra'],
    );
  });

  it('handles a repository with nothing in it rather than dividing by it', () => {
    const census = buildMapCensus([], new Set());
    assert.equal(census.declared, 0);
    assert.equal(census.drawn, 0);
    assert.deepEqual(census.omitted, []);
  });
});
