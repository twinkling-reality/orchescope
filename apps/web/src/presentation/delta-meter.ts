/**
 * The rail: one cell per part of the system a run could have reached, filled where one was seen.
 *
 * At the scale the demonstration runs at, 21 parts, one cell is one part and the rail is a literal
 * picture of the answer. At the scale a real repository runs at, `pydantic-ai` writes down 952, one
 * cell per part is a few pixels each, which is neither readable nor something to put in a document.
 *
 * So the rail has a ceiling and the caption says which of the two readings a reader is looking at,
 * rather than leaving them the flattering one. Every cell on a screen is the same size as every other:
 * the rail spans the width it is given and divides it evenly, so no unit of meaning ever draws with
 * more ink than another unit of the same meaning.
 *
 * Three rounding rules, and each exists because breaking it reports something that is not true:
 *
 * - A non zero seen count never rounds away to nothing. Two parts of 952 is 0.25 of a cell, and the bar
 *   this replaced drew none of it while its own accessible name said two were reached.
 * - A non zero never seen count never rounds away either. The mirror of the same rule.
 * - A non zero undeclared count never rounds away. A single part that ran and is written down nowhere
 *   is the whole reason the boundary is drawn.
 */

import type { Presence } from './component-presence.ts';
import { PRESENCE_LABELS } from './component-presence.ts';

/** The most cells the rail will draw inside the declared set. */
export const CELL_LIMIT = 120;

/** Above this many cells the gap between them closes, because 3px of air between 5px of cell is noise. */
export const DENSE_ABOVE = 48;

/**
 * What one cell stands for. `unmeasured` is the fourth presence state: the component is declared and
 * this report carries no run, so whether it executes is unknown rather than false.
 */
export type MeterCell = 'exercised' | 'declared_only' | 'unmeasured';

export interface MeterCount {
  /** The set this count names, and the selection that opens it on the system map. */
  readonly presence: Presence;
  readonly label: string;
  readonly count: number;
  readonly basis: 'observed' | 'inferred';
}

export interface DeltaMeter {
  /** False when no run has been ingested, so nothing on the rail has been compared against anything. */
  readonly measured: boolean;
  readonly declared: number;
  readonly cells: readonly MeterCell[];
  /** Cells past the dashed boundary: what ran and was never declared. */
  readonly outside: number;
  readonly dense: boolean;
  /** How many declared components one cell stands for. One when the rail is literal. */
  readonly componentsPerCell: number;
  /** What the rail is, said under it, and only when one cell is not one component. */
  readonly caption: string | null;
  /** The counts as they actually are, for the accessible name. Never the rounded ones. */
  readonly label: string;
  /** Empty when nothing has been measured, because there is no set to count into. */
  readonly counts: readonly MeterCount[];
}

const clampCount = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const plural = (count: number, singular: string, many: string): string =>
  count === 1 ? singular : many;

/** How many cells the declared set gets. Fixed at the ceiling above it, so the rail never halves. */
const declaredCellCount = (declared: number): number => Math.min(declared, CELL_LIMIT);

/** Scales a count onto the rail without ever letting a non zero count round away to nothing. */
const scaleCells = (count: number, componentsPerCell: number): number =>
  count === 0 ? 0 : Math.max(1, Math.round(count / componentsPerCell));

export function buildDeltaMeter(input: {
  readonly declared: number;
  readonly exercised: number;
  readonly exercisedNotDeclared: number;
}): DeltaMeter {
  const declared = clampCount(input.declared);
  const exercised = Math.min(declared, clampCount(input.exercised));
  const undeclared = clampCount(input.exercisedNotDeclared);
  const neverExercised = declared - exercised;

  const cellCount = declaredCellCount(declared);
  const componentsPerCell = declared > CELL_LIMIT ? Math.ceil(declared / CELL_LIMIT) : 1;

  // Both ends are protected. `filled` is floored at one whenever anything was exercised and capped one
  // short of the rail whenever anything was not, so neither side of the delta can disappear into a
  // rounding step while the accessible name below still reports it.
  const scaled = declared === 0 ? 0 : Math.round((exercised / declared) * cellCount);
  const filled =
    exercised === 0
      ? 0
      : Math.min(Math.max(1, scaled), neverExercised === 0 ? cellCount : cellCount - 1);

  const cells: MeterCell[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    cells.push(index < filled ? 'exercised' : 'declared_only');
  }
  const outside = scaleCells(undeclared, componentsPerCell);

  const undeclaredSentence =
    undeclared === 0
      ? ' Nothing ran that this repository does not write down.'
      : ` ${undeclared} more ${plural(undeclared, 'part', 'parts')} ran that nothing here writes down, shown past the dashed boundary.`;

  return {
    measured: true,
    declared,
    cells,
    outside,
    dense: cells.length + outside > DENSE_ABOVE,
    componentsPerCell,
    caption:
      componentsPerCell === 1
        ? null
        : `One cell stands for ${componentsPerCell} parts, so the rail carries the proportion rather than which ones.`,
    label: `${exercised} of ${declared} ${plural(declared, 'part', 'parts')} a run could reach ${plural(exercised, 'was', 'were')} seen running.${undeclaredSentence}`,
    counts: [
      {
        presence: 'exercised',
        label: PRESENCE_LABELS.exercised,
        count: exercised,
        basis: 'observed',
      },
      {
        presence: 'declared_only',
        label: PRESENCE_LABELS.declared_only,
        count: neverExercised,
        basis: 'inferred',
      },
      {
        presence: 'undeclared',
        label: PRESENCE_LABELS.undeclared,
        count: undeclared,
        basis: 'observed',
      },
    ],
  };
}

/**
 * The rail for a report with no run in it, which is thirteen of the sixteen cached reports.
 *
 * It draws the parts a run could reach when the bundle carries `observableComponentCount`, and every
 * part otherwise. Every cell is the `no run to compare` state. There are no set counts, because the
 * sets a count would name do not exist until a run does.
 *
 * The observable count is baked into the bundle by `packages/report` from the same kind rule the
 * reconciliation uses. This workspace may import schema types and nothing else, so it must never
 * reclassify kinds; when the field is absent the caption still says the rail will narrow once a run
 * arrives.
 */
export function buildUnmeasuredMeter(
  declared: number,
  options: { readonly observable?: number; readonly totalWritten?: number } = {},
): DeltaMeter {
  const count = clampCount(declared);
  const cellCount = declaredCellCount(count);
  const componentsPerCell = count > CELL_LIMIT ? Math.ceil(count / CELL_LIMIT) : 1;
  const totalWritten = options.totalWritten;
  const narrowed =
    options.observable !== undefined &&
    totalWritten !== undefined &&
    options.observable < totalWritten;
  const baseCaption =
    componentsPerCell === 1
      ? narrowed
        ? `${count} of ${totalWritten} parts a run can reach. The rest are kinds no trace records.`
        : 'Parts a run can reach. Once a run arrives this rail fills from what was seen.'
      : narrowed
        ? `One cell stands for ${componentsPerCell} parts. ${count} of ${totalWritten} parts a run can reach.`
        : `One cell stands for ${componentsPerCell} parts a run can reach.`;
  return {
    measured: false,
    declared: count,
    cells: Array.from({ length: cellCount }, (): MeterCell => 'unmeasured'),
    outside: 0,
    dense: cellCount > DENSE_ABOVE,
    componentsPerCell,
    caption: baseCaption,
    label: `${count} ${plural(count, 'part', 'parts')} a run could reach. No run has been recorded, so none of them has been compared against one.`,
    counts: [],
  };
}
