/**
 * A link whose address came from the analysed repository.
 *
 * Only http, https and file addresses are ever bound to an `href`. Anything else is rendered as text
 * with the reason stated, because every string in the bundle was read out of a repository this report
 * does not control, and a `javascript:` or `data:` address that reached an anchor would be a scanner
 * handing a repository a way to act inside the page that reviews it.
 */

import type { ComponentChildren } from 'preact';
import { safeHref } from '../url.ts';

export function SafeLink(props: {
  readonly href: string;
  readonly children: ComponentChildren;
  readonly title?: string;
}) {
  const resolved = safeHref(props.href);
  if (resolved === null) {
    return (
      <span
        class="unsafe-link"
        title="This link was not a http, https or file address, so it is shown as text."
      >
        {props.children}
      </span>
    );
  }
  return (
    <a class="link" href={resolved} rel="noreferrer noopener" title={props.title ?? resolved}>
      {props.children}
    </a>
  );
}
