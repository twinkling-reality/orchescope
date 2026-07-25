import { execFile } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Opening a browser.
 *
 * This happens only when the user asked for it, never as a side effect of generating a report. The URL is passed
 * as an argument to a known opener with no shell, and a failure is returned rather than thrown: a report that
 * exists is still useful when the browser could not be launched, and the caller prints the clickable URL instead.
 */

export type OpenOutcome = { readonly opened: boolean; readonly detail: string };

const opener = (): { readonly command: string; readonly args: readonly string[] } | undefined => {
  switch (platform()) {
    case 'darwin':
      return { command: 'open', args: [] };
    case 'win32':
      return { command: 'cmd', args: ['/c', 'start', ''] };
    case 'linux':
      return { command: 'xdg-open', args: [] };
    default:
      return undefined;
  }
};

const SAFE_URL = /^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d{1,5})?\/[^\s"']*$/;

export const openInBrowser = (url: string): Promise<OpenOutcome> => {
  if (!SAFE_URL.test(url)) {
    return Promise.resolve({ opened: false, detail: 'only a loopback report URL is opened' });
  }
  const chosen = opener();
  if (chosen === undefined) {
    return Promise.resolve({ opened: false, detail: `no known browser opener for ${platform()}` });
  }
  return new Promise<OpenOutcome>((resolve) => {
    execFile(
      chosen.command,
      [...chosen.args, url],
      { timeout: 5_000, windowsHide: true },
      (error) => {
        resolve(
          error === null
            ? { opened: true, detail: `${chosen.command} launched` }
            : { opened: false, detail: error.message },
        );
      },
    );
  });
};
