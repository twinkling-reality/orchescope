import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visibleWidth } from '../src/terminal/display-width.ts';
import { durableLine, transientLine, transientWidth } from '../src/terminal/progress-line.ts';

/**
 * The one row the transient region occupies.
 *
 * The glyph is pinned to the right edge, which is the "at the side" the region was asked for, achieved
 * by an anchor rather than by a box. It costs no cursor arithmetic: one row is one row whatever the
 * terminal does next, so a resize and an exception thrown mid phase both leave nothing to repair.
 */

/** The byte a terminal reads as the start of a control sequence. */
const ESCAPE = '\u001b';

const line = (over: Partial<Parameters<typeof transientLine>[0]> = {}): string =>
  transientLine({
    label: 'discovering components',
    completed: 0,
    total: undefined,
    elapsedMs: 0,
    glyph: '*',
    columns: 80,
    ...over,
  });

describe('the row', () => {
  it('stops one column short of the terminal, so the erase clears all of it', () => {
    assert.equal(transientWidth(80), 79);
    assert.equal(visibleWidth(line()), 79);
    assert.equal(visibleWidth(line({ columns: 120 })), 119);
  });

  it('puts the phase at column one and the glyph on the last column it uses', () => {
    const rendered = line();
    assert.ok(rendered.startsWith('discovering components'));
    assert.ok(rendered.endsWith('*'));
  });

  it('assumes eighty columns when the stream will not say how wide it is', () => {
    assert.equal(visibleWidth(line({ columns: undefined })), 79);
  });
});

describe('the counter', () => {
  it('shows a fraction only when the phase reported a total', () => {
    assert.match(line({ completed: 8, total: 20 }), /^discovering components 8\/20 /);
    assert.match(line({ completed: 8 }), /^discovering components 8 /);
  });

  /*
   * A phase that does not know its own size reports what it has done and nothing more. Turning that
   * into a share of an unknown whole is an invented percentage, and here it would be invented while
   * the reader watched.
   */
  it('never derives a percentage from a total it was not given', () => {
    assert.equal(line({ completed: 8 }).includes('%'), false);
    assert.equal(line({ completed: 8, total: 20 }).includes('%'), false);
  });

  it('says nothing at all before the first unit of work is done', () => {
    assert.match(line({ completed: 0 }), /^discovering components {2}/);
  });

  it('states elapsed time only once it has been running long enough to be news', () => {
    assert.match(line({ elapsedMs: 900 }), /^discovering components {2}/);
    assert.match(line({ elapsedMs: 8400 }), /^discovering components 8\.4s/);
  });
});

describe('a label longer than the terminal', () => {
  it('is cut, and the glyph keeps its column', () => {
    const rendered = line({ label: 'x'.repeat(200), columns: 60 });
    assert.equal(visibleWidth(rendered), 59);
    assert.ok(rendered.endsWith('*'));
    assert.match(rendered, /…/);
  });
});

describe('the durable line', () => {
  it('uses the document key anchor rather than inventing a second one', () => {
    assert.equal(
      durableLine('discovering: 987 components', 'phase', 80),
      'phase           discovering: 987 components',
    );
  });

  it('is bounded, because a summary built from repository data is not bounded by itself', () => {
    const bounded = durableLine('y'.repeat(400), 'phase', 80);
    assert.equal(visibleWidth(bounded), 79);
  });

  it('strips what a repository put in a string before it reaches the terminal', () => {
    const clean = durableLine(`warning: a${ESCAPE}[2Kb`, '', 80);
    assert.equal(clean.includes(ESCAPE), false);
  });
});
