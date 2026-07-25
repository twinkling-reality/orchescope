/**
 * Everything in this page that touches the browser platform: reading the embedded report, talking to
 * the local server, copying to the clipboard and producing a download. Kept in one place so the rest
 * of the code stays testable without a DOM.
 */

import { ENDPOINTS, extractServerMessage } from './api.ts';
import { type BundleLoad, isPlaceholder, parseBundleJson, REPORT_ELEMENT_ID } from './bundle.ts';

export type PostOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/** The text of the embedded report block, or null when the block is absent or still a placeholder. */
export function readEmbeddedReport(): string | null {
  const element = document.getElementById(REPORT_ELEMENT_ID);
  if (element === null) {
    return null;
  }
  const text = element.textContent ?? '';
  if (text.trim().length === 0 || isPlaceholder(text)) {
    return null;
  }
  return text;
}

export type ReportSource = 'embedded' | 'server';

export interface ReportLoad {
  readonly load: BundleLoad;
  readonly source: ReportSource;
}

export async function loadReport(): Promise<ReportLoad> {
  const embedded = readEmbeddedReport();
  if (embedded !== null) {
    return { load: parseBundleJson(embedded), source: 'embedded' };
  }
  try {
    const response = await fetch(ENDPOINTS.report, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      return {
        load: {
          ok: false,
          problems: [
            `The report server answered ${response.status} ${response.statusText} for ${ENDPOINTS.report}.`,
          ],
        },
        source: 'server',
      };
    }
    return { load: parseBundleJson(await response.text()), source: 'server' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      load: {
        ok: false,
        problems: [
          `No report is embedded in this page and ${ENDPOINTS.report} is unreachable: ${detail}`,
        ],
      },
      source: 'server',
    };
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

export async function postJson<T>(
  path: string,
  body: unknown,
  parse: (value: unknown) => T | null,
): Promise<PostOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${path} is unreachable: ${detail}` };
  }
  const payload = await readBody(response);
  if (!response.ok) {
    const message = extractServerMessage(payload);
    return {
      ok: false,
      message: message ?? `${path} answered ${response.status} ${response.statusText}.`,
    };
  }
  const parsed = parse(payload);
  if (parsed === null) {
    const message = extractServerMessage(payload);
    return {
      ok: false,
      message: message ?? `${path} answered with a body this page does not understand.`,
    };
  }
  return { ok: true, value: parsed };
}

async function clipboardWrite(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Falls back to a selection copy, because a report opened from a file has no secure origin and the
 * asynchronous clipboard is unavailable there.
 */
function selectionCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'true');
  area.setAttribute('aria-hidden', 'true');
  area.classList.add('offscreen');
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

export async function copyText(text: string): Promise<boolean> {
  if (await clipboardWrite(text)) {
    return true;
  }
  return selectionCopy(text);
}

export function downloadText(filename: string, mediaType: string, text: string): void {
  const blob = new Blob([text], { type: mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.classList.add('offscreen');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
