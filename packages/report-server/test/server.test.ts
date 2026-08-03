import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { ReportBundle } from '@orchescope/schema';
import { COOKIE_NAME } from '../src/security.ts';
import { type ReportServerHandle, startReportServer } from '../src/server.ts';

/**
 * Report server tests.
 *
 * A server on loopback is reachable by every page in the browser, so these tests exercise the controls from the outside
 * with real requests: the token, the Host allow list, the Fetch metadata rules, the route and asset allow lists, and the
 * body size limit. Each case is one way a page the user did not open could otherwise read a repository's analysis.
 */

const SECRET_IN_ASSET = 'const marker = "asset served";';

/** `wOF2` and its version, then a byte that is not valid UTF-8 on its own. */
const WOFF2_BYTES = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00, 0xff, 0xfe, 0x00]);

let root: string;
let server: ReportServerHandle;
let base: string;
let token: string;

const bundle = (): ReportBundle =>
  ({
    schemaVersion: 1,
    report: { id: 'rpt_0000000000000000' },
    projectName: 'fixture',
    findings: [],
  }) as unknown as ReportBundle;

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'orchescope-server-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Report</title>');
  writeFileSync(join(root, 'app.js'), SECRET_IN_ASSET);
  writeFileSync(join(root, 'app.css'), ':root { color: black }');
  mkdirSync(join(root, 'fonts'), { recursive: true });
  // A real woff2 signature followed by a byte no UTF-8 decoder can round trip. Reading a font as text
  // and re-encoding it corrupts it silently: the request succeeds, the length is plausible, and the
  // browser rejects the face without saying why.
  writeFileSync(join(root, 'fonts', 'manrope-latin.woff2'), WOFF2_BYTES);
  writeFileSync(join(root, 'fonts', 'jetbrains-mono-latin.woff2'), WOFF2_BYTES);
  writeFileSync(join(root, 'private.txt'), 'not an asset of the report');
  server = await startReportServer({
    host: '127.0.0.1',
    port: 0,
    assetDirectory: root,
    bundle,
  });
  base = `http://127.0.0.1:${server.port}`;
  token = server.token;
});

after(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

const get = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}${path}`, { headers });

/** Headers a page that already exchanged its token would send. Read at call time: the token exists only after `before`. */
const authorised = (): Record<string, string> => ({ cookie: `${COOKIE_NAME}=${token}` });

/**
 * A request made with `node:http` rather than `fetch`, because `fetch` sets the Host header from the url and drops any
 * value supplied by the caller. The Host allow list can only be exercised from a client that lets it be wrong.
 */
const rawGet = (path: string, headers: Record<string, string>): Promise<number> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port: server.port, path, method: 'GET', headers },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.on('error', reject);
    request.end();
  });

describe('the capability token', () => {
  it('is long enough that the port being guessable does not matter', () => {
    assert.ok(token.length >= 40, `the token is only ${token.length} characters`);
  });

  it('is required', async () => {
    const response = await get('/api/report');
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /token/);
  });

  it('is refused when it is close but not equal', async () => {
    const response = await get(`/api/report?token=${token.slice(0, -1)}x`);
    assert.equal(response.status, 401);
  });

  it('is exchanged for a cookie on the first request, so it stops travelling in the url', async () => {
    const response = await get(`/?token=${token}`);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=\d+/);
  });

  it('is accepted from the cookie on later requests', async () => {
    const response = await get('/api/report', { cookie: `${COOKIE_NAME}=${token}` });
    assert.equal(response.status, 200);
  });
});

describe('the host allow list', () => {
  it('accepts the address the server is bound to, and localhost for the same port', async () => {
    for (const host of [`127.0.0.1:${server.port}`, `localhost:${server.port}`]) {
      assert.equal(
        await rawGet('/api/report', { ...authorised(), host }),
        200,
        `${host} was refused`,
      );
    }
  });

  it('refuses a name that resolves to loopback but is not this server', async () => {
    assert.equal(await rawGet('/api/report', { ...authorised(), host: 'attacker.example' }), 421);
  });

  it('refuses the right name on the wrong port', async () => {
    assert.equal(
      await rawGet('/api/report', { ...authorised(), host: `127.0.0.1:${server.port + 1}` }),
      421,
    );
  });
});

describe('fetch metadata', () => {
  const fetchHeaders = (site: string, mode: string, dest: string): Record<string, string> => ({
    'sec-fetch-site': site,
    'sec-fetch-mode': mode,
    'sec-fetch-dest': dest,
  });

  it('accepts the page calling its own api', async () => {
    const status = await rawGet('/api/report', {
      ...authorised(),
      ...fetchHeaders('same-origin', 'cors', 'empty'),
      origin: base,
    });
    assert.equal(status, 200);
  });

  it('accepts a request the user caused, which is how the report is opened', async () => {
    const status = await rawGet(`/?token=${token}`, fetchHeaders('none', 'navigate', 'document'));
    assert.equal(status, 200);
  });

  it('refuses a cross site read of the analysis', async () => {
    const status = await rawGet('/api/report', {
      ...authorised(),
      ...fetchHeaders('cross-site', 'cors', 'empty'),
    });
    assert.equal(status, 403);
  });

  it('refuses another port on loopback, which the browser calls same site', async () => {
    const status = await rawGet('/api/report', {
      ...authorised(),
      ...fetchHeaders('same-site', 'cors', 'empty'),
    });
    assert.equal(status, 403);
  });

  it('refuses a cross site page trying to load the analysis as a script or an image', async () => {
    for (const dest of ['script', 'image', 'iframe']) {
      const status = await rawGet('/api/report', {
        ...authorised(),
        ...fetchHeaders('cross-site', 'no-cors', dest),
      });
      assert.equal(status, 403, `a cross site ${dest} request was accepted`);
    }
  });

  it('refuses a foreign origin outright', async () => {
    const status = await rawGet('/api/report', {
      ...authorised(),
      origin: 'https://attacker.example',
    });
    assert.equal(status, 403);
  });

  it('allows a cross site navigation to a document, which a link is', async () => {
    const status = await rawGet(
      `/?token=${token}`,
      fetchHeaders('cross-site', 'navigate', 'document'),
    );
    assert.equal(status, 200);
  });
});

describe('response headers', () => {
  it('carry a policy with no inline script and no remote origin', async () => {
    const response = await get(`/?token=${token}`);
    const policy = response.headers.get('content-security-policy') ?? '';
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /script-src 'self'/);
    assert.equal(policy.includes('unsafe-inline'), false);
    assert.equal(policy.includes('unsafe-eval'), false);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(policy, /connect-src 'self'/);
  });

  it('tell the browser not to sniff, not to refer and not to cache', async () => {
    const response = await get(`/?token=${token}`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  });
});

describe('the route and asset allow lists', () => {
  it('serve the assets the page needs', async () => {
    for (const path of ['/', '/index.html', '/app.js', '/app.css']) {
      const response = await get(path, authorised());
      assert.equal(response.status, 200, `${path} was not served`);
    }
  });

  /**
   * The two faces are served from this origin rather than inlined, which is what lets the served
   * policy keep `font-src 'self'`. The bytes have to arrive unchanged: a font read as UTF-8 and
   * re-encoded is a request that succeeds and a face the browser silently refuses.
   */
  it('serve both faces as bytes, with the font media type', async () => {
    for (const path of ['/fonts/manrope-latin.woff2', '/fonts/jetbrains-mono-latin.woff2']) {
      const response = await get(path, authorised());
      assert.equal(response.status, 200, `${path} was not served`);
      assert.equal(response.headers.get('content-type'), 'font/woff2');
      const body = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(body, WOFF2_BYTES, `${path} did not arrive byte for byte`);
    }
  });

  it('keep the policy that makes serving the faces from this origin the point', async () => {
    const response = await get('/app.css', authorised());
    assert.match(response.headers.get('content-security-policy') ?? '', /font-src 'self'/);
  });

  it('refuse a file in the asset directory that is not one of them', async () => {
    const response = await get('/private.txt', authorised());
    assert.equal(response.status, 404);
    assert.equal((await response.text()).includes('not an asset'), false);
  });

  it('refuse a traversal, however it is spelled', async () => {
    for (const path of [
      '/../package.json',
      '/..%2Fpackage.json',
      '/app.js/../../package.json',
      '/%2e%2e/%2e%2e/etc/passwd',
    ]) {
      const response = await get(path, authorised());
      assert.ok(
        response.status === 404 || response.status === 400,
        `${path} returned ${response.status}`,
      );
      const body = await response.text();
      assert.equal(body.includes('"name"'), false, `${path} leaked a file`);
    }
  });

  it('refuse an unknown api route rather than guessing', async () => {
    const response = await get('/api/nothing-here', authorised());
    assert.equal(response.status, 404);
  });

  it('refuse a method the route does not implement', async () => {
    const response = await fetch(`${base}/api/report`, {
      method: 'DELETE',
      headers: { cookie: `${COOKIE_NAME}=${token}` },
    });
    assert.equal(response.status, 405);
  });

  it('refuse a state changing request when no action is wired up', async () => {
    const response = await fetch(`${base}/api/goals`, {
      method: 'POST',
      headers: { cookie: `${COOKIE_NAME}=${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ findingId: 'fnd_1' }),
    });
    assert.equal(response.status, 404);
  });
});

describe('request size', () => {
  it('refuses a body larger than the limit instead of buffering it', async () => {
    const small = await startReportServer({
      host: '127.0.0.1',
      port: 0,
      assetDirectory: root,
      bundle,
      maxRequestBytes: 128,
      actions: { createGoal: () => ({ accepted: true }) as never },
    });
    try {
      const response = await fetch(`http://127.0.0.1:${small.port}/api/goals`, {
        method: 'POST',
        headers: { cookie: `${COOKIE_NAME}=${small.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ findingId: 'x'.repeat(1000) }),
      });
      assert.equal(response.status, 413);
    } finally {
      await small.close();
    }
  });
});

describe('shutdown', () => {
  it('stops accepting connections once closed', async () => {
    const temporary = await startReportServer({
      host: '127.0.0.1',
      port: 0,
      assetDirectory: root,
      bundle,
    });
    const url = `http://127.0.0.1:${temporary.port}/api/report?token=${temporary.token}`;
    assert.equal((await fetch(url)).status, 200);
    await temporary.close();
    await assert.rejects(fetch(url));
  });
});
