import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGraph, componentDraft } from '@orchescope/testkit';
import { toMermaid } from '../src/exports.ts';

describe('Mermaid component evidence labels', () => {
  it('does not claim a static component was unexercised when no run supplied evidence', () => {
    const graph = buildGraph([componentDraft({ kind: 'workflow_step', name: 'triage' })]);
    const mermaid = toMermaid(graph);
    assert.match(mermaid, /triage \(no runtime evidence\)/);
    assert.doesNotMatch(mermaid, /not exercised/);
  });
});
