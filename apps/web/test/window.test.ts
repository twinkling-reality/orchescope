/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeWindow,
  scrollToRow,
  shouldVirtualise,
  VIRTUALISE_THRESHOLD,
} from '../src/window.ts';

describe('shouldVirtualise', () => {
  it('leaves lists at or below the threshold rendered whole', () => {
    assert.equal(shouldVirtualise(VIRTUALISE_THRESHOLD), false);
    assert.equal(shouldVirtualise(VIRTUALISE_THRESHOLD + 1), true);
    assert.equal(shouldVirtualise(0), false);
  });
});

describe('computeWindow', () => {
  it('renders a slice around the scroll position with padding that adds up', () => {
    const range = computeWindow(1000, 20, 200, 2000, 5);
    assert.equal(range.start, 95);
    assert.ok(range.end > range.start);
    assert.equal(range.padTop, 95 * 20);
    assert.equal(range.padBottom, (1000 - range.end) * 20);
    assert.equal(range.padTop + (range.end - range.start) * 20 + range.padBottom, 1000 * 20);
  });

  it('never starts before the first row', () => {
    const range = computeWindow(100, 20, 200, 0, 8);
    assert.equal(range.start, 0);
    assert.equal(range.padTop, 0);
  });

  it('never ends past the last row', () => {
    const range = computeWindow(10, 20, 400, 10_000, 8);
    assert.equal(range.end, 10);
    assert.equal(range.padBottom, 0);
  });

  it('returns an empty window for an empty list or an invalid row height', () => {
    assert.deepEqual(computeWindow(0, 20, 200, 0), { start: 0, end: 0, padTop: 0, padBottom: 0 });
    assert.deepEqual(computeWindow(10, 0, 200, 0), { start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it('renders at least one row even in a zero height viewport', () => {
    const range = computeWindow(50, 20, 0, 0, 0);
    assert.equal(range.end - range.start, 1);
  });

  it('treats a negative scroll offset as the top', () => {
    assert.equal(computeWindow(50, 20, 200, -50, 4).start, 0);
  });
});

describe('scrollToRow', () => {
  it('leaves the offset alone when the row is already visible', () => {
    assert.equal(scrollToRow(5, 20, 200, 40), 40);
  });

  it('scrolls up to reveal a row above the viewport', () => {
    assert.equal(scrollToRow(1, 20, 200, 200), 20);
  });

  it('scrolls down by the least amount that reveals a row below the viewport', () => {
    assert.equal(scrollToRow(20, 20, 200, 0), 20 * 20 + 20 - 200);
  });

  it('never returns a negative offset', () => {
    assert.equal(scrollToRow(0, 20, 500, 0), 0);
  });
});
