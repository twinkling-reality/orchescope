/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INITIAL_STATE, reduce } from '../src/app-state.ts';

describe('chrome panel state', () => {
  it('keeps at most one chrome panel open', () => {
    const report = reduce(INITIAL_STATE, { type: 'chrome', panel: 'report' });
    assert.equal(report.chromePanel, 'report');

    const help = reduce(report, { type: 'chrome', panel: 'help' });
    assert.equal(help.chromePanel, 'help');
  });

  it('closes the active panel without changing report state', () => {
    const open = reduce(INITIAL_STATE, { type: 'chrome', panel: 'help' });
    const closed = reduce(open, { type: 'chrome', panel: null });
    assert.deepEqual(closed, INITIAL_STATE);
  });
});
