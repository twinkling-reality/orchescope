/**
 * Windowing for long lists.
 *
 * A report of a real system produces lists in the thousands, and a page that renders all of them is a
 * page nobody scrolls. Above the threshold only the visible slice is rendered, with the remaining
 * height held open by two spacers so the scrollbar still describes the whole list.
 */

export const VIRTUALISE_THRESHOLD = 200;
export const DEFAULT_ROW_HEIGHT = 28;
export const DEFAULT_OVERSCAN = 8;

export interface WindowRange {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  readonly padTop: number;
  readonly padBottom: number;
}

export function shouldVirtualise(count: number): boolean {
  return count > VIRTUALISE_THRESHOLD;
}

export function computeWindow(
  count: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
  overscan = DEFAULT_OVERSCAN,
): WindowRange {
  if (count <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }
  const visibleRows = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight));
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const start = Math.max(0, Math.min(count - 1, firstVisible - overscan));
  const end = Math.min(count, start + visibleRows + overscan * 2);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
  };
}

/** Scroll offset that brings a row fully into view with the least movement. */
export function scrollToRow(
  index: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) {
    return top;
  }
  if (bottom > scrollTop + viewportHeight) {
    return Math.max(0, bottom - viewportHeight);
  }
  return scrollTop;
}
