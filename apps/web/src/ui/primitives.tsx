/**
 * The primitive set. Every screen in this workspace is assembled from these and nothing else.
 *
 * Two rules hold everywhere in this directory: text reaches the page as a text node and never as
 * markup, and an inline style is only ever a CSS custom property, so a policy with no `unsafe-inline`
 * is satisfied.
 *
 * A third rule holds in this file in particular. Fill means evidence: a filled shape was measured in a
 * run, a hollow outline was only declared. That is the visual form of the rule this repository already
 * states, that an inference is never presented as an observation, and it is carried by form rather
 * than by hue so it survives greyscale, a colour vision deficiency and a printed page.
 */

import type { ComponentChildren, JSX } from 'preact';
import { describeBasis, describeSeverity } from '../presentation/basis.ts';
import type { Fraction as FractionValue } from '../presentation/fraction.ts';
import { RunnableCommand } from './runnable-command.tsx';

/* ── 1. Eyebrow ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Names a block. The only all caps in the system, and never a value.
 *
 * As a heading it is what a screen reader navigates the page by, which is why the display sentence
 * below it is a paragraph: the sentence is what the data says today, and the eyebrow is what the block
 * is regardless of the data.
 */
export function Eyebrow(props: {
  readonly children: ComponentChildren;
  readonly count?: number;
  readonly level?: 3 | 4;
  readonly id?: string;
}) {
  const inner = (
    <>
      {props.children}
      {props.count === undefined ? null : <span class="count">{String(props.count)}</span>}
    </>
  );
  if (props.level === 3) {
    return (
      <h3 class="eyebrow" id={props.id}>
        {inner}
      </h3>
    );
  }
  if (props.level === 4) {
    return (
      <h4 class="eyebrow" id={props.id}>
        {inner}
      </h4>
    );
  }
  return (
    <p class="eyebrow" id={props.id}>
      {inner}
    </p>
  );
}

/* ── 2. Figure ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The one number a screen leads with, and the mono qualifier that says what it counted.
 *
 * A value that could not be computed is a word and not a zero, because a rate with no runs behind it
 * is not zero percent, it is a rate that does not exist yet.
 */
export function Figure(props: {
  readonly value: string;
  readonly of: string;
  readonly nil?: boolean;
}) {
  return (
    <p class="readout">
      <span class={props.nil === true ? 'figure nil' : 'figure'}>{props.value}</span>
      <span class="of">{props.of}</span>
    </p>
  );
}

/* ── 3. Data ──────────────────────────────────────────────────────────────────────────────────── */

/** Every number on the page. Tabular, so a figure that changes between reports does not move the layout. */
export function Data(props: {
  readonly children: ComponentChildren;
  readonly title?: string;
  readonly nil?: boolean;
}) {
  return (
    <span class={props.nil === true ? 'data nil' : 'data'} title={props.title}>
      {props.children}
    </span>
  );
}

/* ── 4. Basis chip ────────────────────────────────────────────────────────────────────────────── */

/**
 * The class of evidence a value rests on. No hue and no marker: the word is the signal, and there is
 * nothing here distinguished by colour for a marker to compensate for.
 */
export function BasisChip(props: { readonly basis: string }) {
  const descriptor = describeBasis(props.basis);
  return (
    <span class="basis" title={`${descriptor.label}. ${descriptor.meaning}`}>
      {descriptor.label}
      <span class="visually-hidden">{` evidence class: ${descriptor.meaning}`}</span>
    </span>
  );
}

/* ── 5. Severity marker ───────────────────────────────────────────────────────────────────────── */

/**
 * A square and a word. The two alert hues in this system live here and nowhere else.
 *
 * The hue is doubled by form so it is never the only signal: critical draws two marks against high's
 * one, and low and info empty theirs out, which is the same rule the delta bar uses.
 */
export function SeverityMark(props: { readonly severity: string }) {
  const descriptor = describeSeverity(props.severity);
  const marks: null[] = Array.from({ length: descriptor.mark === 'double' ? 2 : 1 }, () => null);
  return (
    <span class={`sev is-${descriptor.value} mark-${descriptor.mark}`}>
      {marks.map((_, index) => (
        <span class="sev-mark" aria-hidden="true" key={index} />
      ))}
      {descriptor.label}
      <span class="visually-hidden"> severity</span>
    </span>
  );
}

/* ── 6. Meter cell ───────────────────────────────────────────────────────────────────────────── */

/*
 * The cell itself lives in `ui/meter.tsx` with the rail it belongs to, because a cell alone is not a
 * vocabulary item: what it means comes from the rail's caption and its accessible name, and a cell
 * used away from those would be a mark with no stated basis.
 */

/* ── 7. Share ──────────────────────────────────────────────────────────────────────────────── */

/**
 * A count of a known total, said the way a person asks it: how far along, out of how many, and what is
 * left. The tenth primitive, and it earns the place because the Overview alone carries five of these
 * and used to draw none of them.
 *
 * **The share is a bar and never a hue.** The filled length is the same `--ink` every measured shape in
 * this system uses and the track is the same `--outline`, so what it says in colour is what the rail
 * says: this much, out of that much. Nothing here is red for bad or green for good, because a share is
 * not a verdict and this report does not have one to give.
 *
 * **A total of zero draws no bar.** Nought of nought has no share, and an empty track there would say a
 * thing was measured and found wanting. It says so in a word instead, which is the same rule the rest
 * of the workspace follows for a measurement that was never taken.
 */
export function Share(props: {
  readonly fraction: FractionValue;
  readonly label: string;
  readonly doneLabel: string;
  readonly remainingLabel: string;
  readonly basis: string;
  readonly emptyLabel?: string;
}) {
  const { fraction } = props;
  const style: JSX.CSSProperties = {
    '--share': `${((fraction.share ?? 0) * 100).toFixed(1)}%`,
  };
  return (
    <div class="share">
      <p class="share-head">
        <span class="share-count">
          <Data nil={fraction.total === 0}>{`${fraction.done} of ${fraction.total}`}</Data>
        </span>
        {fraction.percent === null ? (
          <span class="share-percent is-nil">{props.emptyLabel ?? 'nothing to count'}</span>
        ) : (
          <span class="share-percent">{fraction.percent}</span>
        )}
      </p>
      {fraction.percent === null ? null : (
        <span class="share-track" aria-hidden="true">
          <span class="share-fill" style={style} />
        </span>
      )}
      <p class="share-legend">
        <span>{props.label}</span>
        <BasisChip basis={props.basis} />
      </p>
      <p class="visually-hidden">
        {fraction.percent === null
          ? `${props.label}: nothing to count.`
          : `${props.label}: ${fraction.done} ${props.doneLabel}, ${fraction.remaining} ${props.remainingLabel}, ${fraction.percent}.`}
      </p>
    </div>
  );
}

/* ── 8. Ruled stat ────────────────────────────────────────────────────────────────────────────── */

/**
 * One supporting number. Ruled rather than boxed, because five boxes give five numbers the same weight
 * as the one the screen is about.
 *
 * Every one carries its basis, because a number without the class of evidence under it is a claim.
 *
 * **A stat with no number carries no basis.** The basis names how a measurement was established, so
 * printing one under `not measured` asserts that something was observed which was not: Performance
 * rendered `not measured` for Cost with `OBSERVED` beneath it, on every report in the corpus, because
 * `costUsd` is never populated anywhere. The rule that every displayed number carries its basis is
 * about numbers, and a false basis is worse than none.
 */
export function RuledStat(props: {
  readonly value: string;
  readonly label: string;
  readonly basis: string;
  readonly nil?: boolean;
}) {
  const descriptor = describeBasis(props.basis);
  const measured = props.nil !== true;
  return (
    <div class="stat">
      <p class={measured ? 'v' : 'v nil'}>{props.value}</p>
      <p class="k">{props.label}</p>
      {measured ? (
        <span class="basis" title={`${descriptor.label}. ${descriptor.meaning}`}>
          {descriptor.label}
        </span>
      ) : null}
    </div>
  );
}

export function StatRow(props: { readonly children: ComponentChildren }) {
  return <div class="stat-row">{props.children}</div>;
}

/* ── 9. Disclosure row ────────────────────────────────────────────────────────────────────────── */

/**
 * One line that expands to what is behind it.
 *
 * Built on `details` rather than on a button and a state hook, so it works before the script runs, is
 * in the tab order without a `tabindex`, announces its own expanded state, and is found by the
 * browser's own in page search while closed. Nothing a reader needs in order to act belongs inside it.
 */
export function DisclosureRow(props: {
  readonly lead?: ComponentChildren;
  readonly title: string;
  readonly count?: number;
  readonly meta?: ComponentChildren;
  readonly open?: boolean;
  readonly children: ComponentChildren;
}) {
  // A row with neither a lead nor a right hand column is a look-it-up row rather than a finding, so it
  // drops the three column grid and the weight that goes with it.
  const plain = props.lead === undefined && props.meta === undefined;
  return (
    <details class={plain ? 'row is-plain' : 'row'} open={props.open ?? false}>
      <summary>
        {plain ? null : <span>{props.lead}</span>}
        <span class="row-title">
          {props.title}
          {props.count === undefined ? null : <span class="row-count">{String(props.count)}</span>}
          <span class="chev" aria-hidden="true">
            ›
          </span>
        </span>
        {plain ? null : <span class="row-meta">{props.meta}</span>}
      </summary>
      <div class="row-body">{props.children}</div>
    </details>
  );
}

/* ── 10. Refusal panel ────────────────────────────────────────────────────────────────────────── */

/**
 * The empty and the refusal state of every screen: what is missing, why that matters, and the command
 * that produces it. Never an empty chart, and never a zero standing in for a measurement that was
 * never taken.
 */
export function RefusalPanel(props: {
  readonly title: string;
  readonly children?: ComponentChildren;
  readonly commands?: readonly (readonly string[])[];
}) {
  const commands = props.commands ?? [];
  return (
    <div class={commands.length === 0 ? 'refusal' : 'refusal has-commands'} role="note">
      {/* What is missing and why, and beside it the commands that produce it. Two boxes rather than
          one run of paragraphs, because a command is forty characters and a paragraph is sixty eight
          and stacking them made the shorter thing the wider one. */}
      <div class="refusal-body">
        <p class="t">{props.title}</p>
        {props.children}
      </div>
      {commands.length === 0 ? null : (
        <div class="refusal-commands">
          {/* Every command this report prints is something a reader has to get into a terminal, and on
              a report that refuses, these are the whole of what there is to do. So they are controls
              rather than text to drag a selection across. */}
          {commands.map((argv) => (
            <RunnableCommand argv={argv} key={argv.join(' ')} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── the supporting cast: layout and controls, no new vocabulary ──────────────────────────────── */

/** A quiet line of identifiers and classifications, the middle dots supplied by the stylesheet. */
export function Meta(props: { readonly children: ComponentChildren }) {
  return <p class="meta">{props.children}</p>;
}

export interface DefinitionRow {
  readonly label: string;
  readonly value: ComponentChildren;
  readonly code?: boolean;
}

export function DefinitionList(props: { readonly rows: readonly DefinitionRow[] }) {
  if (props.rows.length === 0) {
    return <p class="muted small">Nothing recorded.</p>;
  }
  return (
    <dl class="definitions">
      {props.rows.map((row) => (
        <div class="definition" key={row.label}>
          <dt>{row.label}</dt>
          <dd class={row.code === true ? 'mono' : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A measurement drawn as a proportion of the largest in its set. The width is a custom property rather
 * than a style string, and the value beside it is what a reader actually compares, so the bar is a
 * ranking aid and never the only place the number appears.
 */
export function MeasureBar(props: { readonly share: number }) {
  const clamped = Math.min(1, Math.max(0, props.share));
  const style: JSX.CSSProperties = { '--bar-share': `${(clamped * 100).toFixed(2)}%` };
  return (
    <span class="measure-bar" aria-hidden="true">
      <span class="measure-fill" style={style} />
    </span>
  );
}

/**
 * A value that may not exist. Absence is a word, never a zero and never an empty cell, because an
 * empty cell is indistinguishable from a rendering fault and a zero is a measurement.
 */
export function OptionalNumber(props: {
  readonly value: number | null | undefined;
  readonly render: (value: number) => string;
}) {
  if (props.value === null || props.value === undefined || !Number.isFinite(props.value)) {
    return (
      <span class="muted" title="Not measured. This is not a value of zero.">
        not measured
      </span>
    );
  }
  return <Data>{props.render(props.value)}</Data>;
}

/** A state, said as a word. Nothing here is distinguished by hue, so nothing here needs a marker. */
export function State(props: {
  readonly value: boolean;
  readonly trueLabel?: string;
  readonly falseLabel?: string;
}) {
  return <span>{props.value ? (props.trueLabel ?? 'yes') : (props.falseLabel ?? 'no')}</span>;
}
