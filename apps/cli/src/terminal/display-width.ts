/**
 * How many columns a string occupies, and where to cut it so the result is exactly that many.
 *
 * `length` counts code units, which is the wrong measure three times over in this output. A component
 * name read out of a repository may be Japanese, and a terminal gives every one of those glyphs two
 * columns. It may carry a combining accent, which gets no column of its own. And a line may arrive
 * already styled, because one region paints a word inside a sentence, in which case `length` counts
 * the escape bytes and pads the row by however many the string happens to carry. Every width decision
 * in the document goes through here so that there is one width model rather than one per region.
 *
 * Measurement and sanitisation sit together because they are the same question asked twice: what does
 * this string do to a grid of cells. A control character does nothing to the grid and everything to
 * the cursor, so a string that came out of a repository is stripped of them before it is measured, and
 * the measurement is then true of what will actually be written.
 */

/** Colour and cursor sequences. They occupy no columns; they are instructions to the terminal. */
// Built from code points so the pattern is not itself a control character literal in source.
const ANSI = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z]`, 'g');

/**
 * Characters that steer the terminal rather than fill a cell.
 *
 * C0 and C1 controls, and the delete character. A tab is included on purpose: its width depends on
 * where the cursor already is, which is exactly the thing a column model cannot know, so it is removed
 * rather than measured. A newline inside a cell would end the row early and break every anchor below
 * it, which is the whole reason an untrusted string is sanitised at the cell boundary at all.
 */
const CONTROL = new RegExp(
  `[${String.fromCharCode(0x00)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}-${String.fromCharCode(0x9f)}]`,
  'g',
);

/** Combining marks and format characters. They attach to the glyph before them and add no column. */
const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Cf}]/u;

/**
 * Code point ranges a terminal renders two columns wide.
 *
 * These are the East Asian Wide and Fullwidth blocks plus the pictographic planes. The list is the
 * conventional one rather than a generated table: a generated table would be five hundred lines to
 * make the same decision about component names, and every range left out is rendered one column wide,
 * which costs a row one column of padding rather than corrupting the grid.
 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

const isWide = (codePoint: number): boolean =>
  WIDE.some(([low, high]) => codePoint >= low && codePoint <= high);

const charWidth = (character: string): number => {
  if (ZERO_WIDTH.test(character)) return 0;
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && isWide(codePoint) ? 2 : 1;
};

/**
 * Strip what a repository put in a string before it reaches a cell.
 *
 * Leading combining marks go too. A mark with nothing before it attaches to whatever the terminal last
 * drew, which after a truncation is the ellipsis and after padding is a space belonging to another
 * column, so a name beginning with one would decorate a neighbouring cell.
 */
export const sanitiseCell = (text: string): string =>
  text.replace(CONTROL, '').replace(/^[\p{Mn}\p{Me}]+/u, '');

/** Display columns, with escape sequences taken out and every glyph measured rather than counted. */
export const visibleWidth = (text: string): number => {
  let width = 0;
  for (const character of text.replace(ANSI, '')) width += charWidth(character);
  return width;
};

/** The character that says a string was cut. One column, so a cut always costs exactly one. */
const ELLIPSIS = '…';

/**
 * Cut to at most `width` columns, spending one of them on the mark that says it was cut.
 *
 * A width of zero or less yields nothing at all rather than a bare ellipsis: a lone ellipsis in a
 * column too narrow to hold anything says a value exists and refuses to say what it is, which is worse
 * than an empty cell beside a key that already names the subject.
 *
 * The result can come back one column short of the measure when the cut lands in the middle of a wide
 * glyph, because half of one is not a thing a terminal can draw. Every caller pads to the anchor, so a
 * short result moves nothing.
 */
export const cut = (text: string, width: number): string => {
  if (width <= 0) return '';
  if (visibleWidth(text) <= width) return text;
  const budget = width - 1;
  let taken = '';
  let used = 0;
  for (const character of text) {
    const next = used + charWidth(character);
    if (next > budget) break;
    taken += character;
    used = next;
  }
  return `${taken}${ELLIPSIS}`;
};

/** Pad on the right to `width` columns. A string already at or over the width is returned unchanged. */
export const padTo = (text: string, width: number): string => {
  const short = width - visibleWidth(text);
  return short > 0 ? text + ' '.repeat(short) : text;
};

/** Pad on the left to `width` columns, for a field that reads against the right edge. */
export const padLeftTo = (text: string, width: number): string => {
  const short = width - visibleWidth(text);
  return short > 0 ? ' '.repeat(short) + text : text;
};
