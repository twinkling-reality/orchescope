import type { Component } from '@orchescope/schema';

/**
 * The difference between an entry point a repository declared and a scope Orchescope invented.
 *
 * An external effect has to be attributed to something. When the function performing it produced no
 * component of its own, discovery mints an entry point from the enclosing scope, because an effect with
 * no caller cannot be reasoned about and inventing an agent would overstate the architecture. That is a
 * useful frame and it is not a component of the system: nobody wrote it down, nobody classified it, and
 * it exists to hold the operation one line further in.
 *
 * Treating the frame as the operation is how three separate defects were reported as three. A retry
 * around a helper terminated at the frame, which no classifier had ever looked at, so the rule that
 * refuses to judge an unclassified component refused every time while the write one hop further was
 * classified `non_idempotent_write` all along. A tool handler calling that same helper reached nothing,
 * so the rule asking whether a model can reach a consequential operation answered no on every input
 * ever given to it.
 *
 * The vocabulary is here rather than beside either consumer for the same reason `partOfAuditedSystem`
 * is: two consumers asking the same question and answering it differently is what produced the
 * contradiction in the first place. A frame stays in the graph, because which function performs an
 * effect is a true fact about a repository and the report names it.
 */

/** Tag carried by every entry point discovery minted rather than read. */
export const INFERRED_ENTRY_POINT_TAG = 'inferred-entry-point';

export const isInferredEntryPoint = (component: Component): boolean =>
  component.kind === 'entrypoint' && component.tags.includes(INFERRED_ENTRY_POINT_TAG);
