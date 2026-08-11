/** A tile-local three-dot menu whose panel overlays the workspace instead of changing its geometry. */

import type { ComponentChildren } from 'preact';

export function TileMenu(props: {
  readonly label: string;
  readonly children: ComponentChildren;
  readonly wide?: boolean;
}) {
  return (
    <details class={props.wide === true ? 'tile-menu is-wide' : 'tile-menu'}>
      <summary title={props.label}>
        <span class="visually-hidden">{props.label}</span>
        <span aria-hidden="true">...</span>
      </summary>
      <div class="tile-menu-panel">{props.children}</div>
    </details>
  );
}
