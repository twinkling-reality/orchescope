/**
 * The grid the audit document is written on.
 *
 * A line's first column says what kind of line it is, its second says what state that thing is in, and
 * its third says the one sentence about it. That is the whole grammar, and it is what lets a reader
 * predict where a new fact goes: under the key that owns the question it answers.
 *
 * There are three anchors and no region invents a fourth. Width changes what is cut, never where
 * anything sits, so an eighty column terminal and a hundred and twenty column terminal put every key
 * and every state word on the same column and differ only in how much of a sentence survives. That is
 * the property a frame cannot have: a frame's own edge moves with the content inside it, so one row
 * growing a character moves every row.
 *
 * Every line is stripped of trailing whitespace. That is what makes a diff between two runs report the
 * rows that changed rather than the rows whose padding changed.
 */

import { cut, padLeftTo, padTo, sanitiseCell, visibleWidth } from './display-width.ts';

/**
 * Fourteen columns for the key.
 *
 * The widest ordinary key is `5 did it help` at 13. Finding identifiers are not keys on the default
 * surface: they are arguments for agents and for `goal create`, and they appear on the `run` line or
 * under `--verbose`. A key longer than this pushes its own row right rather than being cut, which
 * happens on one thing only, a project name, and a project name is the identity of the document.
 */
export const KEY_WIDTH = 14;

/** Two columns between every field. One reads as a word break; three reads as a missing field. */
const GUTTER = 2;

/** Where a row with no state puts its value. */
export const VALUE_COLUMN = KEY_WIDTH + GUTTER + 1;

/**
 * Eleven columns for the state.
 *
 * The widest state phrase in the document is `. discarded`, and `! undecided` matches it. There is one
 * state width for the whole document rather than one per region: a second ceiling written in a
 * different number is a ceiling somebody will one day raise.
 */
export const STATE_WIDTH = 11;

/** Where a row with a state puts its sentence, and where every detail row starts. */
export const REST_COLUMN = VALUE_COLUMN + STATE_WIDTH + GUTTER;

/** The gap before a right aligned field, so the longest sentence never touches the field beside it. */
const TAIL_GAP = 2;

/**
 * The width the document is composed to.
 *
 * A pipe is always eighty, so two machines with different terminals produce byte identical documents
 * and a checked in golden file is possible. The cap at a hundred and twenty is deliberate: measured
 * prose past about ninety columns is read by returning to the wrong line, and the corpus's longest
 * finding title is a hundred and thirty nine characters, so a cut is still meaningful at the cap. The
 * floor at sixty is where a two field row stops fitting; below it the terminal wraps the document,
 * which is recoverable, because every key still starts a line and every word is still on screen.
 */
export const effectiveWidth = (columns: number | undefined): number =>
  columns === undefined ? 80 : Math.min(120, Math.max(60, columns));

/**
 * Two arrangements, most informative first, and the boundary is width tested rather than guessed.
 *
 * Below eighty a fixed width state column pushes every sentence right of the key the eye follows down
 * the page, so the state word folds into the sentence instead. The key anchor is unchanged either way,
 * which is what keeps `grep` and `awk` reading the same in both.
 */
export type Tier = 'three_field' | 'two_field';

export const tierFor = (effective: number): Tier => (effective >= 80 ? 'three_field' : 'two_field');

export interface Layout {
  readonly effective: number;
  readonly tier: Tier;
}

export const layoutFor = (columns: number | undefined): Layout => {
  const effective = effectiveWidth(columns);
  return { effective, tier: tierFor(effective) };
};

/**
 * The four kinds of line, and there are only four.
 *
 * `keyed` is the ordinary row. `detail` is a supporting line that sits under the sentence it supports
 * rather than under the key, and there is at most one per parent row. `caveat` is the one line type
 * that ignores the anchors: it qualifies a whole region rather than any row in it, so it starts at
 * column one and runs the width of the terminal. `exempt` is a keyed row whose value is never cut,
 * because half a command is worse than a wrapped one and half an instruction names no file.
 */
export type RowKind = 'keyed' | 'detail' | 'caveat' | 'exempt';

export interface Row {
  readonly kind: RowKind;
  readonly key?: string;
  /** Symbol and word, both mandatory, so the state survives a pipe and `NO_COLOR` intact. */
  readonly state?: string;
  readonly text: string;
  /** Right aligned against the effective width. The one further anchor a region may declare. */
  readonly tail?: string;
  /** The width that anchor was derived at, shared by every row in the region that declared it. */
  readonly tailWidth?: number;
  readonly paintKey?: (text: string) => string;
  readonly paintText?: (text: string) => string;
}

const identity = (text: string): string => text;

/*
 * The key is painted and then padded, never padded and then painted. Painting the padding puts a
 * ground or an underline under columns that belong to no field, and it is only invisible for the one
 * weight this document happens to use.
 */
const keyedPrefix = (row: Row, layout: Layout): string => {
  const key = (row.paintKey ?? identity)(sanitiseCell(row.key ?? ''));
  const painted = padTo(key, KEY_WIDTH);
  if (row.state === undefined) return `${painted}${' '.repeat(GUTTER)}`;
  if (layout.tier === 'two_field') return `${painted}${' '.repeat(GUTTER)}`;
  return `${painted}${' '.repeat(GUTTER)}${padTo(row.state, STATE_WIDTH)}${' '.repeat(GUTTER)}`;
};

/** In the folded arrangement the state leads the sentence instead of occupying a column of its own. */
const keyedText = (row: Row, layout: Layout): string => {
  const text = sanitiseCell(row.text);
  if (row.state === undefined || layout.tier === 'three_field') return text;
  return `${row.state} ${text}`;
};

const renderKeyed = (row: Row, layout: Layout): string => {
  const prefix = keyedPrefix(row, layout);
  const tailWidth = row.tail === undefined ? 0 : (row.tailWidth ?? visibleWidth(row.tail));
  const reserved = row.tail === undefined ? 0 : tailWidth + TAIL_GAP;
  const budget = layout.effective - visibleWidth(prefix) - reserved;
  const body = `${prefix}${(row.paintText ?? identity)(cut(keyedText(row, layout), budget))}`;
  if (row.tail === undefined) return body;
  return `${padTo(body, layout.effective - tailWidth)}${padLeftTo(row.tail, tailWidth)}`;
};

const renderExempt = (row: Row): string => {
  const key = (row.paintKey ?? identity)(sanitiseCell(row.key ?? ''));
  const prefix = `${padTo(key, KEY_WIDTH)}${' '.repeat(GUTTER)}`;
  return `${prefix}${(row.paintText ?? identity)(sanitiseCell(row.text))}`;
};

const renderDetail = (row: Row, layout: Layout): string => {
  const indent = layout.tier === 'three_field' ? REST_COLUMN - 1 : VALUE_COLUMN - 1;
  return `${' '.repeat(indent)}${cut(sanitiseCell(row.text), layout.effective - indent)}`;
};

/** No line ends in whitespace, ever. This is what makes a diff of two documents readable. */
const rstrip = (text: string): string => text.replace(/\s+$/, '');

export const renderRow = (row: Row, layout: Layout): string => {
  switch (row.kind) {
    case 'keyed':
      return rstrip(renderKeyed(row, layout));
    case 'detail':
      return rstrip(renderDetail(row, layout));
    case 'caveat':
      return rstrip(sanitiseCell(row.text));
    case 'exempt':
      return rstrip(renderExempt(row));
  }
};

/**
 * A region is a list of rows that renders as a block, or as nothing at all.
 *
 * A region with no rows contributes no lines and no blank line. It may only be empty when there is
 * genuinely nothing to say: a region that has a refusal to report says the refusal, because an empty
 * block is indistinguishable from a failed render.
 */
export type Region = readonly Row[];

export const renderDocument = (regions: readonly Region[], layout: Layout): string =>
  regions
    .filter((region) => region.length > 0)
    .map((region) => region.map((row) => renderRow(row, layout)).join('\n'))
    .join('\n\n');
