/** Fixed, named slots for the Overview and depth screens. */

import type { ComponentChildren } from 'preact';
import type { DepthSectionId } from '../presentation/section-presentation.ts';

function Slot(props: { readonly name: string; readonly children: ComponentChildren }) {
  return (
    <div class={`report-slot is-${props.name}`} data-slot={props.name}>
      {props.children}
    </div>
  );
}

/**
 * Four slots: the answer, and three tiles that do not repeat it.
 *
 * The version before this had four tiles too and three of them answered `what do I do` differently, and
 * two printed the same finding twice. The version after that deleted them all, which removed the
 * duplication and the composition with it: one flat coloured rectangle with nothing on it below the
 * fold. Both were wrong for the same reason, which is that the tiles were never the fault. What they
 * held was.
 *
 * So the answer leads and each tile below it asks a different question: what else did you find, how
 * much of this has actually run, and how much of it could we read.
 */
export function OverviewSkeleton(props: {
  readonly headline: ComponentChildren;
  readonly problems: ComponentChildren;
  readonly ran: ComponentChildren;
  readonly scan: ComponentChildren;
}) {
  return (
    <div class="overview-skeleton" data-section-skeleton="overview">
      <Slot name="headline">{props.headline}</Slot>
      <Slot name="problems">{props.problems}</Slot>
      <Slot name="ran">{props.ran}</Slot>
      <Slot name="scan">{props.scan}</Slot>
    </div>
  );
}

export function SectionSkeleton(props: {
  readonly section: DepthSectionId;
  readonly summary: ComponentChildren;
  readonly primary: ComponentChildren;
  readonly detail: ComponentChildren;
}) {
  return (
    <div class="section-skeleton" data-section-skeleton={props.section}>
      <Slot name="summary">{props.summary}</Slot>
      <Slot name="primary">{props.primary}</Slot>
      <Slot name="detail">{props.detail}</Slot>
    </div>
  );
}
