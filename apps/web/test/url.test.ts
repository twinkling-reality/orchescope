/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowedProtocols, isSafeHref, safeHref } from '../src/url.ts';

describe('safeHref', () => {
  it('allows exactly three protocols', () => {
    assert.deepEqual([...allowedProtocols()].sort(), ['file:', 'http:', 'https:']);
  });

  it('accepts http, https and file addresses', () => {
    assert.equal(safeHref('http://localhost:7777/report'), 'http://localhost:7777/report');
    assert.equal(safeHref('https://example.test/a/b?c=d#e'), 'https://example.test/a/b?c=d#e');
    assert.ok(safeHref('file:///Users/someone/project/report.html')?.startsWith('file://'));
  });

  it('rejects script and data addresses', () => {
    for (const raw of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:http://example.test/abc',
      'mailto:someone@example.test',
      'about:blank',
    ]) {
      assert.equal(safeHref(raw), null, `expected ${raw} to be refused`);
    }
  });

  it('rejects relative and malformed input, since a bound href needs an absolute address', () => {
    for (const raw of ['', '   ', '/api/report', './report.html', 'example.test', 'http://']) {
      assert.equal(safeHref(raw), null, `expected ${raw} to be refused`);
    }
  });

  it('rejects a non string, because bundle values are untrusted', () => {
    assert.equal(safeHref(undefined as unknown as string), null);
    assert.equal(safeHref(null as unknown as string), null);
    assert.equal(safeHref(42 as unknown as string), null);
  });

  it('does not let a fragment or a tab smuggle a protocol past the check', () => {
    assert.equal(safeHref('java\tscript:alert(1)'), null);
    assert.equal(safeHref('\njavascript:alert(1)'), null);
  });

  it('agrees with isSafeHref', () => {
    assert.equal(isSafeHref('https://example.test'), true);
    assert.equal(isSafeHref('javascript:alert(1)'), false);
  });
});
