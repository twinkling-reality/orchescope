/**
 * Windowed list. Lists at or below the threshold are rendered whole; above it only the visible slice is
 * rendered and the rest of the scroll height is held open by two spacers.
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { formatInteger } from '../presentation/format.ts';
import { computeWindow, DEFAULT_ROW_HEIGHT, shouldVirtualise } from '../window.ts';

export interface VirtualListProps<T> {
  readonly items: readonly T[];
  readonly renderRow: (item: T, index: number) => JSX.Element;
  readonly keyOf: (item: T, index: number) => string;
  readonly rowHeight?: number;
  readonly viewportHeight?: number;
  readonly label: string;
}

const DEFAULT_VIEWPORT = 480;

export function VirtualList<T>(props: VirtualListProps<T>) {
  const rowHeight = props.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const viewportHeight = props.viewportHeight ?? DEFAULT_VIEWPORT;
  const [scrollTop, setScrollTop] = useState(0);
  const count = props.items.length;

  if (!shouldVirtualise(count)) {
    return <div class="list">{props.items.map((item, index) => props.renderRow(item, index))}</div>;
  }

  const range = computeWindow(count, rowHeight, viewportHeight, scrollTop);
  const slice = props.items.slice(range.start, range.end);
  const viewportStyle: JSX.CSSProperties = { '--viewport-height': `${viewportHeight}px` };
  const topStyle: JSX.CSSProperties = { '--spacer-height': `${range.padTop}px` };
  const bottomStyle: JSX.CSSProperties = { '--spacer-height': `${range.padBottom}px` };

  return (
    <div class="virtual">
      <p class="muted virtual-note">
        {`Showing rows ${formatInteger(range.start + 1)} to ${formatInteger(range.end)} of ${formatInteger(count)}. Scroll for the rest.`}
      </p>
      <section
        class="virtual-viewport"
        style={viewportStyle}
        aria-label={props.label}
        onScroll={(event) => {
          setScrollTop((event.currentTarget as HTMLElement).scrollTop);
        }}
      >
        <div class="virtual-spacer" style={topStyle} aria-hidden="true" />
        {slice.map((item, offset) => (
          <div key={props.keyOf(item, range.start + offset)}>
            {props.renderRow(item, range.start + offset)}
          </div>
        ))}
        <div class="virtual-spacer" style={bottomStyle} aria-hidden="true" />
      </section>
    </div>
  );
}
