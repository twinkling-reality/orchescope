import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import type { ReportBundle } from '@orchescope/schema';
import { renderStandaloneHtml } from '../src/exports.ts';

/**
 * The single file export.
 *
 * This is the artifact most likely to be read by someone who never ran the tool, and it is also the
 * one with the least around it: no server, no origin worth the name, and a policy it carries itself.
 * These tests hold the two things that make it safe to send to a colleague, that it executes exactly
 * what was built and reaches no network at all, and the one thing that makes it worth sending, that
 * it looks like the report rather than like whatever fonts the reader happens to have.
 */

const bundle = (): ReportBundle =>
  ({
    schemaVersion: 1,
    reportId: 'rpt_0000000000000000',
    projectName: 'fixture',
    findings: [],
  }) as unknown as ReportBundle;

const policyOf = (html: string): string => {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(match !== null, 'the export carries no content security policy');
  return match[1] ?? '';
};

const CSS_WITH_FONT =
  '@font-face{font-family:Manrope;src:url(data:font/woff2;base64,d09GMgABAAAA) format("woff2")}';

describe('renderStandaloneHtml', () => {
  it('pins the script and the style it actually inlined, by their own hashes', () => {
    const javascript = 'console.log(1)';
    const html = renderStandaloneHtml(bundle(), {
      javascript,
      css: CSS_WITH_FONT,
      title: 'Report',
    });
    const hash = (content: string): string => createHash('sha256').update(content).digest('base64');
    const policy = policyOf(html);
    assert.match(
      policy,
      new RegExp(`script-src 'sha256-${hash(javascript)}'`.replace(/[+/]/g, '\\$&')),
    );
    assert.match(
      policy,
      new RegExp(`style-src 'sha256-${hash(CSS_WITH_FONT)}'`.replace(/[+/]/g, '\\$&')),
    );
  });

  /**
   * `font-src data:` rather than `'self'`, and the difference matters only here. Opened from a disk
   * this is a `file:` page, where `'self'` resolves to nothing it can fetch, so a self hosted face is
   * unreachable and the export would fall back to whatever the reader's machine has. The widening
   * cannot be abused: `default-src 'none'` still blocks every network destination and a font is not
   * executable.
   */
  it('allows the inlined faces and nothing else that a data URI could carry', () => {
    const policy = policyOf(
      renderStandaloneHtml(bundle(), { javascript: '', css: CSS_WITH_FONT, title: 'Report' }),
    );
    assert.match(policy, /font-src data:/);
    assert.equal(policy.includes("font-src 'self'"), false);
    assert.equal(policy.includes('script-src data:'), false);
    assert.equal(policy.includes('style-src data:'), false);
    assert.equal(policy.includes("default-src 'none'"), true);
  });

  /**
   * A remote address is one the document would fetch. An address inside a comment is text, and the
   * font licence notice the stylesheet carries is exactly that, so the check is on the forms that
   * actually resolve rather than on the scheme appearing anywhere.
   */
  it('reaches no network destination at all', () => {
    const html = renderStandaloneHtml(bundle(), {
      javascript: 'const remote = "https://example.com";',
      css: `${CSS_WITH_FONT}/*! see https://openfontlicense.org */`,
      title: 'Report',
    });
    assert.match(policyOf(html), /default-src 'none'/);
    assert.match(policyOf(html), /base-uri 'none'/);
    assert.match(policyOf(html), /form-action 'none'/);
    for (const reference of [
      /\bsrc\s*=\s*["']https?:/i,
      /\bhref\s*=\s*["']https?:/i,
      /\burl\(\s*["']?https?:/i,
      /@import\s+["']?https?:/i,
    ]) {
      assert.equal(reference.test(html), false, `the export resolves ${String(reference)}`);
    }
  });

  /**
   * A string inside the report came from a repository this report does not control, so it must not be
   * able to close the element it is sitting in. Only `</` can do that: an opening tag inside a JSON
   * island is inert text, so escaping it would be theatre, and escaping `</` is the whole control.
   */
  it('escapes the only sequence in the bundle that could close the data island', () => {
    const hostile = {
      ...bundle(),
      projectName: '</script><script>alert(1)</script><!--',
    } as ReportBundle;
    const html = renderStandaloneHtml(hostile, { javascript: '', css: '', title: 'Report' });
    const start = html.indexOf('id="orchescope-report">') + 'id="orchescope-report">'.length;
    const island = html.slice(start);
    const body = island.slice(0, island.indexOf('</script>'));

    assert.ok(body.includes('alert(1)'), 'the island did not carry the project name at all');
    assert.equal(body.includes('</script'), false, 'the island can close its own element');
    assert.equal(body.includes('<!--'), false, 'the island can open an HTML comment');
    assert.match(body, /<\\\/script>/);
  });

  it('strips markup out of the title rather than trusting the project name', () => {
    const html = renderStandaloneHtml(bundle(), {
      javascript: '',
      css: '',
      title: '<img src=x onerror=alert(1)>',
    });
    assert.match(html, /<title>img src=x onerror=alert\(1\)<\/title>/);
  });
});
