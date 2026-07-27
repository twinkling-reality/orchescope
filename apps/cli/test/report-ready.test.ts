import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { panel } from '../src/terminal/panel.ts';
import { reportReady } from '../src/terminal/report-ready.ts';
import { createStyle } from '../src/terminal/style.ts';

/**
 * The block that ends a served report.
 *
 * Its payload is a URL carrying a capability token, so the two failure modes worth testing are a URL that arrives
 * damaged and a claim about the browser that is not true. A border that looks wrong is cosmetic; a URL that has been
 * truncated to fit one is a report the reader cannot open.
 */

const plain = createStyle('plain');
const URL = 'http://127.0.0.1:51803/?token=CAGRQSp9wHIwFSEZx1I3_Evp7oYZopmRll7Ci89CoHg';

const ready = (columns: number, outcome: Parameters<typeof reportReady>[0]['outcome']): string =>
  reportReady({ style: plain, url: URL, outcome, columns, platform: 'darwin' });

describe('the report ready block', () => {
  it('carries the url whole, at every width', () => {
    for (const columns of [40, 80, 100, 200]) {
      const text = ready(columns, { kind: 'not_requested' });
      assert.ok(text.includes(URL), `the url was not intact at ${columns} columns`);
      assert.equal(text.includes('…'), false, `the url was truncated at ${columns} columns`);
    }
  });

  it('draws a border when there is room for one, and every line closes it', () => {
    const lines = ready(120, { kind: 'not_requested' })
      .split('\n')
      .filter((line) => line !== '');
    assert.ok(lines[0]?.startsWith('╭'), `no top border: ${lines[0]}`);
    assert.ok(lines.at(-1)?.startsWith('╰'), `no bottom border: ${lines.at(-1)}`);
    const widths = new Set(lines.map((line) => [...line].length));
    assert.equal(widths.size, 1, `the border is ragged: widths ${[...widths].join(', ')}`);
  });

  /** A box the terminal cannot hold wraps into something that no longer reads as a box, so none is drawn. */
  it('drops the border rather than wrapping it when the terminal is narrow', () => {
    const text = ready(40, { kind: 'not_requested' });
    assert.equal(text.includes('╭'), false, 'a border was drawn that could not fit');
    assert.ok(text.includes('Your report is ready'));
    assert.ok(text.includes(URL));
  });

  it('says a browser opened only when one did', () => {
    assert.match(ready(120, { kind: 'opened' }), /Opened in your browser/);
    assert.equal(/Opened in your browser/.test(ready(120, { kind: 'not_requested' })), false);

    const failed = ready(120, { kind: 'failed', detail: 'no handler' });
    assert.equal(/Opened in your browser/.test(failed), false);
    assert.match(failed, /No browser could be opened \(no handler\)/);
    assert.match(failed, /Cmd-click the link/);
  });

  it('names the modifier that the running platform actually uses', () => {
    const onLinux = reportReady({
      style: plain,
      url: URL,
      outcome: { kind: 'not_requested' },
      columns: 120,
      platform: 'linux',
    });
    assert.match(onLinux, /Ctrl-click the link/);
  });

  it('says how to stop, because the command does not return on its own', () => {
    assert.match(ready(120, { kind: 'opened' }), /Press Ctrl\+C here to stop serving/);
  });
});

describe('the panel', () => {
  it('widens to hold a title longer than any of its lines', () => {
    const lines = panel(plain, {
      title: 'A title considerably longer than the body',
      lines: [{ text: 'short' }],
      columns: 120,
    });
    const widths = new Set(lines.map((line) => [...line].length));
    assert.equal(widths.size, 1, `the border is ragged: widths ${[...widths].join(', ')}`);
  });
});
