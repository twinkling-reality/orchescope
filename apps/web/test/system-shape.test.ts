/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countKinds, describeShape, nameKind } from '../src/presentation/system-shape.ts';

describe('nameKind', () => {
  it('gives a schema identifier a noun a person owns', () => {
    assert.equal(nameKind('mcp_server', 2), 'MCP servers');
    assert.equal(nameKind('side_effect', 1), 'action on the outside world');
    assert.equal(nameKind('evaluator', 3), 'checks');
  });

  it('degrades a kind it has no name for to a readable guess', () => {
    // A schema that grows a kind should read badly rather than blankly.
    assert.equal(nameKind('vector_index', 1), 'vector index');
    assert.equal(nameKind('vector_index', 4), 'vector indexs');
  });
});

describe('describeShape', () => {
  it('names the three commonest kinds and counts the rest', () => {
    const shape = describeShape(
      countKinds([
        ...Array.from({ length: 5 }, () => ({ kind: 'agent' })),
        ...Array.from({ length: 7 }, () => ({ kind: 'tool' })),
        ...Array.from({ length: 2 }, () => ({ kind: 'model' })),
        ...Array.from({ length: 4 }, () => ({ kind: 'entrypoint' })),
        { kind: 'database' },
      ]),
    );
    assert.equal(shape, '7 tools, 5 agents and 4 entry points, and 3 more');
  });

  it('says nothing at all when there is nothing to describe', () => {
    // `orchescope-discovery` finds no system. The sentence this goes into reads without it.
    assert.equal(describeShape(countKinds([])), '');
    assert.equal(describeShape(new Map([['agent', 0]])), '');
  });

  it('reads as a list rather than as a list of one', () => {
    assert.equal(describeShape(countKinds([{ kind: 'agent' }])), '1 agent');
    assert.equal(
      describeShape(countKinds([{ kind: 'agent' }, { kind: 'tool' }])),
      '1 agent and 1 tool',
    );
  });

  it('describes the same repository the same way every time', () => {
    // Ties break on the kind name, so two kinds of equal size never swap between builds.
    const counts = new Map([
      ['tool', 3],
      ['agent', 3],
      ['model', 3],
    ]);
    assert.equal(describeShape(counts), '3 agents, 3 models and 3 tools');
  });
});
