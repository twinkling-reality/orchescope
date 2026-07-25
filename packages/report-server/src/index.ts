/**
 * The local report server: loopback only, capability token, strict content security policy, and no state changing
 * route unless the caller supplied a handler for it.
 */

export { type OpenOutcome, openInBrowser } from './browser.ts';
export {
  COOKIE_NAME,
  constantTimeEquals,
  cookieHeader,
  createToken,
  type RequestVerdict,
  type SecurityContext,
  securityHeaders,
  verifyRequest,
} from './security.ts';
export {
  type ActionResult,
  type ReportServerHandle,
  type ReportServerOptions,
  type ServerActions,
  startReportServer,
} from './server.ts';
