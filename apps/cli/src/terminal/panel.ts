import type { Style } from './style.ts';

/**
 * A bordered panel, for the one message in a command's output that the reader has to act on.
 *
 * Serving a report ends with a URL the reader must open, and a URL printed as one more dim line among several reads
 * as logging rather than as an invitation. A border separates the thing to do from the record of what happened.
 *
 * Two rules keep it from making the output worse than the plain lines it replaces. A line is never truncated to fit,
 * because the payload is a URL and half a URL is worse than an ugly one. And when the terminal is too narrow to hold
 * the widest line inside a border, no border is drawn at all: the same content is printed unadorned rather than
 * wrapped into a shape that no longer looks like a box.
 *
 * Colour and the border are decoration here and nothing else. Every line still reads correctly with the escape
 * sequences removed and the border gone, which is what `NO_COLOR`, a pipe and a narrow window each produce.
 */

export type PanelLine = {
  readonly text: string;
  /** Applied at render time, so that width is measured on the text and not on the escape sequences around it. */
  readonly paint?: (text: string) => string;
};

export type PanelInput = {
  readonly title: string;
  readonly lines: readonly PanelLine[];
  /** Terminal width. A panel that would not fit degrades to plain lines rather than wrapping. */
  readonly columns: number;
};

const TOP_LEFT = '╭';
const TOP_RIGHT = '╮';
const BOTTOM_LEFT = '╰';
const BOTTOM_RIGHT = '╯';
const HORIZONTAL = '─';
const VERTICAL = '│';

const paintedOf = (line: PanelLine): string =>
  line.paint === undefined ? line.text : line.paint(line.text);

const plainLines = (style: Style, input: PanelInput): readonly string[] => [
  style.bold(input.title),
  ...input.lines.map((line) => (line.text === '' ? '' : `  ${paintedOf(line)}`)),
];

export const panel = (style: Style, input: PanelInput): readonly string[] => {
  const longest = input.lines.reduce((width, line) => Math.max(width, line.text.length), 0);
  /*
   * The inner width holds the widest line with a space either side, and never less than the title row needs: one
   * rule, a space, the title, a space. A title longer than every line would otherwise overrun the corner.
   */
  const inner = Math.max(longest + 2, input.title.length + 3);
  if (inner + 2 > input.columns) return plainLines(style, input);

  const border = (text: string): string => style.dim(text);
  const titleRun = inner - input.title.length - 3;

  return [
    `${border(`${TOP_LEFT}${HORIZONTAL} `)}${style.bold(input.title)}${border(` ${HORIZONTAL.repeat(titleRun)}${TOP_RIGHT}`)}`,
    ...input.lines.map(
      (line) =>
        `${border(VERTICAL)} ${paintedOf(line)}${' '.repeat(inner - 1 - line.text.length)}${border(VERTICAL)}`,
    ),
    border(`${BOTTOM_LEFT}${HORIZONTAL.repeat(inner)}${BOTTOM_RIGHT}`),
  ];
};
