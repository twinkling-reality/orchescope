/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPABILITY_NAMES,
  capabilityState,
  indexCapabilities,
  orderedCapabilities,
} from '../src/capabilities.ts';

describe('capabilityState', () => {
  it('reports a declared available capability with its reason', () => {
    const index = indexCapabilities([
      { name: 'create_goal', available: true, reason: 'A writable workspace is attached.' },
    ]);
    const state = capabilityState(index, 'create_goal');
    assert.equal(state.declared, true);
    assert.equal(state.available, true);
    assert.equal(state.reason, 'A writable workspace is attached.');
  });

  it('keeps the reason for a declared but unavailable capability, so the page can explain itself', () => {
    const index = indexCapabilities([
      {
        name: 'rerun_scenario',
        available: false,
        reason: 'This report was exported as a single file.',
      },
    ]);
    const state = capabilityState(index, 'rerun_scenario');
    assert.equal(state.declared, true);
    assert.equal(state.available, false);
    assert.equal(state.reason, 'This report was exported as a single file.');
  });

  it('marks an undeclared capability as undeclared and unavailable', () => {
    const state = capabilityState(indexCapabilities([]), 'compare_runs');
    assert.equal(state.declared, false);
    assert.equal(state.available, false);
    assert.ok(state.reason.length > 0);
  });
});

describe('orderedCapabilities', () => {
  it('returns declared capabilities in the schema order', () => {
    const index = indexCapabilities([
      { name: 'export_standalone', available: true, reason: 'ok' },
      { name: 'create_goal', available: true, reason: 'ok' },
    ]);
    assert.deepEqual(
      orderedCapabilities(index).map((state) => state.name),
      ['create_goal', 'export_standalone'],
    );
  });

  it('omits capabilities the report did not declare', () => {
    assert.deepEqual(orderedCapabilities(indexCapabilities([])), []);
  });

  it('covers every name the schema allows', () => {
    assert.equal(new Set(CAPABILITY_NAMES).size, CAPABILITY_NAMES.length);
    assert.equal(CAPABILITY_NAMES.length, 8);
  });
});
