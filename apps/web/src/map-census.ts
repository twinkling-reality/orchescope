/**
 * What the map draws and what it leaves out.
 *
 * The map draws components that a relation touches, because a component with no relation is not part of
 * any topology and cannot be drawn as part of one. That is a large omission and it has to be stated
 * rather than implied: in `openai-agents-python` 1091 of 1390 components have no relation at all,
 * including 368 of its 370 prompts and 479 of its 620 agents.
 *
 * A view that silently showed 22% of a repository would be a worse misrepresentation than one that drew
 * the other 78% badly, so this is the counterpart to leaving them out. The count is per kind, because
 * "370 prompts and two of them are wired to anything" is a fact a reader can act on, where "1091
 * components are not drawn" is only a number.
 */

import type { Component } from '@orchescope/schema';

export interface CensusRow {
  readonly kind: string;
  readonly declared: number;
  /** How many of that kind a relation touches, and therefore how many the map draws. */
  readonly drawn: number;
}

export interface MapCensus {
  /** Kinds with something left out, worst first. A kind that is fully drawn is not a row. */
  readonly omitted: readonly CensusRow[];
  readonly declared: number;
  readonly drawn: number;
}

export function buildMapCensus(
  components: readonly Component[],
  drawn: ReadonlySet<string>,
): MapCensus {
  const byKind = new Map<string, { declared: number; drawn: number }>();
  for (const component of components) {
    const row = byKind.get(component.kind) ?? { declared: 0, drawn: 0 };
    row.declared += 1;
    if (drawn.has(component.id)) {
      row.drawn += 1;
    }
    byKind.set(component.kind, row);
  }

  const omitted = [...byKind]
    .map(([kind, row]) => ({ kind, declared: row.declared, drawn: row.drawn }))
    .filter((row) => row.drawn < row.declared)
    .sort((left, right) => {
      const byMissing = right.declared - right.drawn - (left.declared - left.drawn);
      return byMissing !== 0 ? byMissing : left.kind < right.kind ? -1 : 1;
    });

  return {
    omitted,
    declared: components.length,
    drawn: components.filter((component) => drawn.has(component.id)).length,
  };
}
