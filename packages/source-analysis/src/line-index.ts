import type { SourceLocation } from '@orchescope/schema';

/**
 * Byte offset to line and column translation.
 *
 * Parsers report offsets; humans and editors need lines. The index is built once per file with a
 * binary search lookup, because an audit of a large repository performs this conversion tens of
 * thousands of times.
 *
 * Offsets are UTF-16 code unit offsets, matching what both parsers report for JavaScript and what the
 * tree-sitter WASM binding reports for Python once its byte offsets are divided by two. Columns are
 * zero based, lines are one based, matching the convention in `SourceLocation`.
 */
export type LineIndex = {
  readonly lineStarts: readonly number[];
  readonly locate: (offset: number) => { readonly line: number; readonly column: number };
  readonly location: (file: string, start: number, end?: number) => SourceLocation;
};

export const buildLineIndex = (text: string): LineIndex => {
  const lineStarts: number[] = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }

  const locate = (offset: number): { line: number; column: number } => {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      const start = lineStarts[middle];
      if (start !== undefined && start <= clamped) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: clamped - (lineStarts[low] ?? 0) };
  };

  const location = (file: string, start: number, end?: number): SourceLocation => {
    const from = locate(start);
    if (end === undefined) {
      return { file, startLine: from.line, startColumn: from.column };
    }
    const to = locate(end);
    return {
      file,
      startLine: from.line,
      startColumn: from.column,
      endLine: to.line,
      endColumn: to.column,
    };
  };

  return { lineStarts, locate, location };
};
