import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cut,
  padLeftTo,
  padTo,
  sanitiseCell,
  visibleWidth,
} from '../src/terminal/display-width.ts';

/**
 * The one width model.
 *
 * Every anchor in the document is a number of columns, and a column model that counts code units puts
 * a Japanese component name at half its real width and a combining accent at twice. Both come out of
 * repository source, which is untrusted input, so both are inputs this has to be right about.
 */

const ESCAPE = '\u001b';

describe('visibleWidth', () => {
  it('counts an East Asian glyph as the two columns a terminal gives it', () => {
    assert.equal(visibleWidth('注文'), 4);
    assert.equal(visibleWidth('a注文b'), 6);
  });

  it('gives a combining mark no column of its own', () => {
    assert.equal(visibleWidth('é'), 1);
    assert.equal(visibleWidth('e'), visibleWidth('é'));
  });

  it('measures the text of a styled string and not the escape bytes around it', () => {
    assert.equal(visibleWidth(`${ESCAPE}[1mdone${ESCAPE}[0m`), 4);
  });

  it('has nothing to measure in an empty string', () => {
    assert.equal(visibleWidth(''), 0);
  });
});

describe('cut', () => {
  it('returns a string that already fits, unchanged and unmarked', () => {
    assert.equal(cut('issue_refund', 20), 'issue_refund');
    assert.equal(cut('issue_refund', 12), 'issue_refund');
  });

  it('spends exactly one column on the mark that says it was cut', () => {
    const cropped = cut('metering_record_usage runs without being declared', 12);
    assert.equal(visibleWidth(cropped), 12);
    assert.ok(cropped.endsWith('…'));
  });

  it('never returns half of a wide glyph, so it may come back a column short', () => {
    const cropped = cut('注文注文注文', 5);
    assert.ok(visibleWidth(cropped) <= 5);
    assert.ok(visibleWidth(cropped) >= 4);
  });

  /*
   * A lone ellipsis in a column too narrow to hold anything says a value exists and refuses to say what
   * it is, beside a key that already names the subject.
   */
  it('returns nothing at all rather than a bare mark when there is no room', () => {
    assert.equal(cut('issue_refund', 0), '');
    assert.equal(cut('issue_refund', -4), '');
  });
});

describe('sanitiseCell', () => {
  it('takes out what a repository put in a name that steers the cursor', () => {
    assert.equal(sanitiseCell(`refund${ESCAPE}[2Ktool`), 'refund[2Ktool');
    assert.equal(sanitiseCell('two\nlines'), 'twolines');
    assert.equal(sanitiseCell('a\tb'), 'ab');
  });

  it('drops a leading combining mark, which would decorate the cell before it', () => {
    assert.equal(sanitiseCell('́refund'), 'refund');
    assert.equal(sanitiseCell('érefund'), 'érefund');
  });

  it('leaves an ordinary name alone', () => {
    assert.equal(sanitiseCell('metering_record_usage'), 'metering_record_usage');
  });
});

describe('padding', () => {
  it('pads to the measure, not to the code unit count', () => {
    assert.equal(visibleWidth(padTo('注文', 6)), 6);
    assert.equal(visibleWidth(padLeftTo('注文', 6)), 6);
    assert.ok(padLeftTo('注文', 6).startsWith('  '));
  });

  it('returns a string already at or over the width unchanged', () => {
    assert.equal(padTo('orchescope-discovery', 14), 'orchescope-discovery');
    assert.equal(padLeftTo('orchescope-discovery', 14), 'orchescope-discovery');
  });
});
