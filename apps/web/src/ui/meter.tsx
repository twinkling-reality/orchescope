/**
 * The rail, drawn.
 *
 * The whole rail is one image with one accessible name carrying the real counts, rather than up to two
 * hundred and forty elements a screen reader would have to walk. What ran and is written down nowhere
 * sits past a dashed boundary rather than being tinted a third colour, because it is not a third kind
 * of evidence, it is outside the set the repository declares.
 *
 * Every cell is the same size as every other cell, and that is the invariant. The rail this replaced
 * broke it in the vertical direction: on a report with two parts seen running it drew them 312px tall,
 * eight times the ink per part that the same report gave to the nine hundred and fifty it never
 * reached. The rail before this one fixed that by fixing a cell at 34px, which broke the composition in
 * the other direction instead: 891px of an 1728px band, and the picture emptied as the window grew.
 *
 * So the rail takes the width it is given and divides it evenly. A cell is as wide as the rail divided
 * by the number of cells, always, and no cell is ever cut by an edge, because the cells are countable
 * units and a sliced one would be a count a reader cannot take.
 */

import type { DeltaMeter, MeterCell } from '../presentation/delta-meter.ts';

function Cell(props: { readonly kind: MeterCell }) {
  return <i class={`meter-cell is-${props.kind}`} />;
}

/**
 * The rail alone, and nothing under it.
 *
 * Its boundary labels are rendered by the screen rather than here, because the rail straddles the seam
 * between two grounds and anything inside its own box would decide where that seam falls. A label is a
 * caption and belongs below the seam, set to the page's own inset, where `Written down here` lines up
 * with the heading rather than with an edge the rail bleeds off.
 */
export function Meter(props: { readonly meter: DeltaMeter }) {
  const { meter } = props;
  const outside: null[] = Array.from({ length: meter.outside }, () => null);
  return (
    <div class={meter.dense ? 'meter is-dense' : 'meter'} role="img" aria-label={meter.label}>
      {meter.cells.map((kind, index) => (
        <Cell kind={kind} key={index} />
      ))}
      {meter.outside === 0 ? null : <span class="meter-edge" />}
      {outside.map((_, index) => (
        <Cell kind="exercised" key={`outside-${index}`} />
      ))}
    </div>
  );
}
