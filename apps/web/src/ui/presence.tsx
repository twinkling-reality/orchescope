/**
 * The presence of one component, drawn with the same marks the declaration rail uses.
 *
 * What each presence means, and how it is decided, is in `component-presence.ts`. This file is the
 * mark alone, so the decision stays testable without a renderer.
 */

import type { Presence } from '../presentation/component-presence.ts';
import {
  PRESENCE_FILL,
  PRESENCE_LABELS,
  PRESENCE_TITLES,
} from '../presentation/component-presence.ts';

export function PresenceMark(props: { readonly presence: Presence }) {
  const { presence } = props;
  return (
    <span class={`presence is-${PRESENCE_FILL[presence]}`} title={PRESENCE_TITLES[presence]}>
      <i aria-hidden="true" />
      {PRESENCE_LABELS[presence]}
    </span>
  );
}
