import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visibleWidth } from '../src/terminal/display-width.ts';
import {
  effectiveWidth,
  layoutFor,
  REST_COLUMN,
  renderDocument,
  renderRow,
  type Row,
  VALUE_COLUMN,
} from '../src/terminal/document-grid.ts';

/**
 * The grammar every line in the document obeys.
 *
 * The property worth more than any single row is that width changes what is cut and never where
 * anything sits. A frame cannot have it, because a frame's edge is a function of its contents, so one
 * row growing a character moves every row and a diff between two runs reports the whole block.
 */

const keyed = (over: Partial<Row> = {}): Row => ({
  kind: 'keyed',
  key: '1 audit',
  state: '+ done',
  text: '21 of 22 checks ran',
  ...over,
});

/** A row with no state at all, which starts its value at the value column instead. */
const stateless: Row = { kind: 'keyed', key: 'join', text: '15 of 22 parts a run could reach' };

const columnOf = (line: string, needle: string): number => line.indexOf(needle) + 1;

describe('the effective width', () => {
  it('is eighty when the stream is not a terminal, so two machines produce the same bytes', () => {
    assert.equal(effectiveWidth(undefined), 80);
  });

  it('is clamped, because prose past about ninety columns is read by returning to the wrong line', () => {
    assert.equal(effectiveWidth(200), 120);
    assert.equal(effectiveWidth(40), 60);
    assert.equal(effectiveWidth(100), 100);
  });
});

describe('the anchors', () => {
  it('are the same columns at eighty, at a hundred and at a hundred and twenty', () => {
    const rendered = [80, 100, 120].map((columns) => renderRow(keyed(), layoutFor(columns)));
    for (const line of rendered) {
      assert.equal(columnOf(line, '+ done'), VALUE_COLUMN);
      assert.equal(columnOf(line, '21 of 22'), REST_COLUMN);
    }
  });

  it('folds the state into the sentence below eighty, and never above it', () => {
    const narrow = renderRow(keyed(), layoutFor(70));
    assert.equal(columnOf(narrow, '+ done 21 of 22'), VALUE_COLUMN);
    const wide = renderRow(keyed(), layoutFor(80));
    assert.equal(wide.includes('+ done 21'), false);
  });

  it('lets a key longer than the column push its own value right rather than being cut', () => {
    const line = renderRow(
      { kind: 'keyed', key: 'orchescope-discovery', text: '0 components' },
      layoutFor(80),
    );
    assert.match(line, /^orchescope-discovery {2}0 components$/);
  });
});

describe('what fits', () => {
  it('holds every row to the effective width, tail included', () => {
    const line = renderRow(
      keyed({
        key: 'OSC-MAINT-0001',
        state: '! medium',
        text: '501 declared components were never exercised by any run that was ingested',
        tail: '20 inferred',
        tailWidth: 12,
      }),
      layoutFor(80),
    );
    assert.equal(visibleWidth(line), 80);
    assert.ok(line.endsWith('20 inferred'));
  });

  it('never cuts a command or an instruction, and lets the terminal wrap one instead', () => {
    const long = `orchescope trace -- ${"'".repeat(90)}`;
    const line = renderRow({ kind: 'exempt', key: 'run', text: long }, layoutFor(80));
    assert.ok(line.endsWith(long));
    assert.ok(visibleWidth(line) > 80);
  });

  it('gives a caveat the whole width from column one, with no key beside it', () => {
    const text = 'No agent system was detected.';
    assert.equal(renderRow({ kind: 'caveat', text }, layoutFor(80)), text);
  });

  it('starts a detail under the sentence it supports, not under the key', () => {
    const line = renderRow({ kind: 'detail', text: '8 faults injected' }, layoutFor(80));
    assert.equal(columnOf(line, '8 faults'), REST_COLUMN);
    const narrow = renderRow({ kind: 'detail', text: '8 faults injected' }, layoutFor(70));
    assert.equal(columnOf(narrow, '8 faults'), VALUE_COLUMN);
  });
});

describe('the document', () => {
  it('strips every trailing space, so a diff reports the rows that changed', () => {
    const document = renderDocument(
      [[stateless], [keyed({ tail: 'a', tailWidth: 8 })]],
      layoutFor(80),
    );
    for (const line of document.split('\n')) assert.equal(/\s$/.test(line), false);
  });

  it('puts exactly one blank line between regions, and none at either end', () => {
    const document = renderDocument(
      [[keyed()], [keyed({ key: 'join' })], [keyed({ key: 'run' })]],
      layoutFor(80),
    );
    const lines = document.split('\n');
    assert.deepEqual(
      lines.map((line) => line === ''),
      [false, true, false, true, false],
    );
  });

  /*
   * A region with nothing to say contributes no lines and no blank line. A region with a refusal to
   * report says the refusal: an empty block is indistinguishable from a failed render.
   */
  it('leaves out an empty region entirely, blank line and all', () => {
    const document = renderDocument([[keyed()], [], [keyed({ key: 'run' })]], layoutFor(80));
    assert.equal(document.split('\n').length, 3);
  });

  it('has nothing to render when every region is empty', () => {
    assert.equal(renderDocument([[], []], layoutFor(80)), '');
  });
});
