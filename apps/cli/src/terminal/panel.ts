import { visibleWidth } from './display-width.ts';
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

/*
 * Every measurement in this file goes through the document's own width model.
 *
 * A line may arrive already styled, because part of it is painted and the rest is not, and `length` on
 * that string counts the escape bytes and pads the row by however many it happens to carry. It also
 * counted a Japanese component name at one column per glyph, which drew a border two columns short of
 * where the eye puts it. There is one width model for this surface and this file is a user of it.
 */

const paintedOf = (line: PanelLine): string =>
  line.paint === undefined ? line.text : line.paint(line.text);

const plainLines = (style: Style, input: PanelInput): readonly string[] => [
  style.bold(input.title),
  ...input.lines.map((line) => (line.text === '' ? '' : `  ${paintedOf(line)}`)),
];

export const panel = (style: Style, input: PanelInput): readonly string[] => {
  const longest = input.lines.reduce((width, line) => Math.max(width, visibleWidth(line.text)), 0);
  const edge = visibleWidth(input.title) + 3;
  /*
   * The inner width holds the widest line with a space either side, and never less than the top rule
   * needs: one rule, a space, the title and a space. A title longer than every line would otherwise
   * overrun the corner.
   */
  const inner = Math.max(longest + 2, edge);
  if (inner + 2 > input.columns) return plainLines(style, input);

  const border = (text: string): string => style.dim(text);
  /*
   * The top rule is `corner rule space title space run corner`, which is five columns of chrome plus
   * the title, and `edge` is exactly those five minus the two corners. So the run is what the inner
   * width has left after the edge. Getting this wrong by two put the top rule two columns past the rows
   * under it, which reads as a broken box.
   *
   * A run of zero is legitimate and must stay legitimate: a title longer than every line sets the inner
   * width itself, and there is then nothing left for the rule to fill.
   */
  const titleRun = inner - edge;
  const top = `${border(`${TOP_LEFT}${HORIZONTAL} `)}${style.bold(input.title)}${border(` ${HORIZONTAL.repeat(titleRun)}${TOP_RIGHT}`)}`;

  return [
    top,
    ...input.lines.map(
      (line) =>
        `${border(VERTICAL)} ${paintedOf(line)}${' '.repeat(Math.max(0, inner - 1 - visibleWidth(line.text)))}${border(VERTICAL)}`,
    ),
    border(`${BOTTOM_LEFT}${HORIZONTAL.repeat(inner)}${BOTTOM_RIGHT}`),
  ];
};
