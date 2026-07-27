import { panel } from './panel.ts';
import type { Style } from './style.ts';

/**
 * The block a served report ends with.
 *
 * This is the only moment in the product where the terminal asks the reader to leave it, so it says what was made,
 * how to reach it, what the link is worth, and how to stop. Both commands that serve a report print this, because a
 * reader who learned the shape from `audit --open` should meet the same shape from `open`.
 *
 * What it does not do is claim a browser opened when nothing was asked to open one, or when the attempt failed. The
 * outcome is passed in rather than assumed, and the first line changes with it.
 */

export type BrowserOutcome =
  | { readonly kind: 'not_requested' }
  | { readonly kind: 'opened' }
  | { readonly kind: 'failed'; readonly detail: string };

const clickHint = (platform: string): string =>
  platform === 'darwin'
    ? 'Cmd-click the link, or copy it into your browser.'
    : 'Ctrl-click the link, or copy it into your browser.';

const opening = (outcome: BrowserOutcome, platform: string): readonly string[] => {
  switch (outcome.kind) {
    case 'opened':
      return ['Opened in your browser. The link above works again if you close the tab.'];
    case 'failed':
      return [`No browser could be opened (${outcome.detail}).`, clickHint(platform)];
    default:
      return [clickHint(platform)];
  }
};

export const reportReady = (input: {
  readonly style: Style;
  readonly url: string;
  readonly outcome: BrowserOutcome;
  readonly columns: number;
  readonly platform: string;
}): string => {
  const lines = panel(input.style, {
    title: 'Your report is ready',
    columns: input.columns,
    lines: [
      { text: '' },
      { text: input.url, paint: (text) => input.style.link(input.style.accent(text)) },
      { text: '' },
      ...opening(input.outcome, input.platform).map((text) => ({ text })),
      {
        text: 'Served from this machine only. The token in that URL is what opens it.',
        paint: input.style.dim,
      },
      { text: '' },
      { text: 'Press Ctrl+C here to stop serving.', paint: input.style.dim },
    ],
  });
  return `\n${lines.join('\n')}\n`;
};
