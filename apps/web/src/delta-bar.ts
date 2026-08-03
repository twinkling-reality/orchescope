/**
 * The declaration bar: one cell per declared component, filled where a run reached it.
 *
 * At the scale the demonstration runs at, 22 declared components, one cell is one component and the
 * bar is a literal picture of the delta. At the scale a real repository runs at, `openai-agents-python`
 * declares 917, one cell per component is 917 elements a few pixels wide, which is neither readable nor
 * something to put in a document.
 *
 * So the bar has a ceiling. Below it a cell is a component. Above it the cell count is fixed and the
 * filled share is the measured rate rounded onto that many cells, and the caption says so in the same
 * breath as the picture. Rounding a measured ratio onto a fixed number of cells is a rendering of a
 * measurement rather than an inference about one, and the reader is told which they are looking at
 * rather than left to assume the flattering reading.
 */

/** The most cells the bar will draw on each side of the boundary. */
export const CELL_LIMIT = 120;

/** Above this many cells the gap between them closes, because 3px of air between 5px of cell is noise. */
export const DENSE_ABOVE = 48;

export interface DeltaBar {
  /** One entry per cell inside the declared set. True means a run reached it. */
  readonly cells: readonly boolean[];
  /** Cells past the dashed boundary: what ran and was never declared. */
  readonly outside: number;
  readonly dense: boolean;
  /** How many declared components one cell stands for. One when the bar is literal. */
  readonly componentsPerCell: number;
  /** What the bar is, said in the caption under it. */
  readonly caption: string;
  /** The counts as they actually are, for the accessible name. Never the rounded ones. */
  readonly label: string;
}

const clampCount = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const plural = (count: number, singular: string, many: string): string =>
  count === 1 ? singular : many;

/**
 * Scales a count onto the bar. A non zero count never rounds away to nothing: a single component
 * that ran and was never declared is the whole reason the boundary is drawn, and a bar that hid it
 * because 1 of 917 rounds to zero would be reporting the absence of the thing it was built to find.
 */
const scaleCells = (count: number, componentsPerCell: number): number => {
  if (count === 0) {
    return 0;
  }
  return Math.max(1, Math.round(count / componentsPerCell));
};

export function buildDeltaBar(input: {
  readonly declared: number;
  readonly exercised: number;
  readonly exercisedNotDeclared: number;
}): DeltaBar {
  const declared = clampCount(input.declared);
  const exercised = Math.min(declared, clampCount(input.exercised));
  const undeclared = clampCount(input.exercisedNotDeclared);

  const componentsPerCell = declared > CELL_LIMIT ? Math.ceil(declared / CELL_LIMIT) : 1;
  const declaredCells =
    componentsPerCell === 1 ? declared : scaleCells(declared, componentsPerCell);
  const filled =
    componentsPerCell === 1 ? exercised : Math.round((exercised / declared) * declaredCells);
  const outside = scaleCells(undeclared, componentsPerCell);

  const cells: boolean[] = [];
  for (let index = 0; index < declaredCells; index += 1) {
    cells.push(index < filled);
  }

  const caption =
    componentsPerCell === 1
      ? 'Each cell is one declared component. Filled means a run reached it.'
      : `Each cell stands for ${componentsPerCell} declared components, so the bar carries the proportion rather than which ones. Filled means a run reached that share.`;

  const undeclaredSentence =
    undeclared === 0
      ? ' Nothing ran that this repository does not declare.'
      : ` ${undeclared} ${plural(undeclared, 'component', 'components')} ran that ${plural(undeclared, 'was', 'were')} never declared, shown past the dashed boundary.`;

  return {
    cells,
    outside,
    dense: cells.length + outside > DENSE_ABOVE,
    componentsPerCell,
    caption,
    label: `${exercised} of ${declared} declared ${plural(declared, 'component was', 'components were')} exercised.${undeclaredSentence}`,
  };
}
