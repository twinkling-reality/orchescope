import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Loopback server security.
 *
 * A server on localhost is reachable by every page in the browser, so binding to loopback is not by itself a
 * control. Four controls are applied together, and each one covers a case the others do not:
 *
 *  1. Host header allow list. Blocks DNS rebinding, where an attacker resolves their own name to 127.0.0.1 and
 *     the browser sends their host with the request.
 *  2. Origin and `Sec-Fetch-Site` checks. Blocks a cross site page from reading responses or posting commands.
 *  3. A capability token. The port is guessable by scanning, the token is not. It arrives once in the URL and is
 *     exchanged for a same site, http only cookie so it stops appearing in the address bar and in referrers.
 *  4. Method and path allow lists. The server answers a fixed set of routes and serves a fixed set of files, so
 *     there is no path to traverse.
 */

export const createToken = (): string => randomBytes(32).toString('base64url');

export const constantTimeEquals = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
};

export const COOKIE_NAME = 'orchescope_report';

export type SecurityContext = {
  readonly token: string;
  readonly host: string;
  readonly port: number;
  readonly origin: string;
};

export type RequestVerdict =
  | { readonly ok: true; readonly setCookie: boolean }
  | { readonly ok: false; readonly status: number; readonly reason: string };

const allowedHosts = (context: SecurityContext): readonly string[] => {
  const bracketed = context.host === '::1' ? '[::1]' : context.host;
  return [
    `${bracketed}:${context.port}`,
    ...(context.host === '127.0.0.1' ? [`localhost:${context.port}`] : []),
  ];
};

const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
};

export const cookieHeader = (token: string): string =>
  `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`;

/**
 * The Fetch metadata rule, which is about who caused the request rather than who sent it.
 *
 * `same-origin` is the page calling its own API. `none` is the user themselves: a typed address, a bookmark, or the
 * terminal handing the URL to the browser, which is the normal way this report is opened. Anything else was caused by
 * another site, and is accepted only when it is the browser navigating a whole tab to a document, because refusing that
 * would break an ordinary link without protecting anything: a navigation response lands in the user's own tab and the
 * requesting site cannot read it. A cross site *read* of an API route is exactly the attack this blocks, so the
 * exception is limited to document destinations.
 */
const fetchMetadataAllows = (request: IncomingMessage): boolean => {
  const site = request.headers['sec-fetch-site'];
  if (typeof site !== 'string' || site === 'same-origin' || site === 'none') return true;
  return (
    request.method === 'GET' &&
    request.headers['sec-fetch-mode'] === 'navigate' &&
    request.headers['sec-fetch-dest'] === 'document'
  );
};

export const verifyRequest = (
  request: IncomingMessage,
  context: SecurityContext,
): RequestVerdict => {
  const host = request.headers.host;
  if (host === undefined || !allowedHosts(context).includes(host)) {
    return {
      ok: false,
      status: 421,
      reason: 'the Host header is not the address this server is bound to',
    };
  }

  const origin = request.headers.origin;
  if (origin !== undefined && origin !== context.origin && origin !== 'null') {
    return { ok: false, status: 403, reason: 'the Origin header is not this server' };
  }

  if (!fetchMetadataAllows(request)) {
    const site = request.headers['sec-fetch-site'];
    return {
      ok: false,
      status: 403,
      reason: `a ${String(site)} request for this resource is not accepted`,
    };
  }

  const url = new URL(request.url ?? '/', context.origin);
  const queryToken = url.searchParams.get('token');
  const cookieToken = readCookie(request.headers.cookie, COOKIE_NAME);

  if (queryToken !== null && constantTimeEquals(queryToken, context.token)) {
    return { ok: true, setCookie: true };
  }
  if (cookieToken !== undefined && constantTimeEquals(cookieToken, context.token)) {
    return { ok: true, setCookie: false };
  }
  return { ok: false, status: 401, reason: 'the capability token is missing or does not match' };
};

/**
 * Response headers applied to every response. The policy has no `unsafe-inline`, which is why the served page
 * carries no inline script and no inline style, and `connect-src 'self'` is what lets the page call its own API
 * while blocking it from reaching anything else.
 */
export const securityHeaders = (contentType: string): Readonly<Record<string, string>> => ({
  'content-type': contentType,
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'cache-control': 'no-store',
});
