/**
 * Small building blocks. Two rules hold everywhere in this directory: text reaches the page as a text
 * node and never as markup, and an inline style is only ever set as a CSS custom property so that a
 * strict content security policy without `unsafe-inline` is satisfied.
 */

import type { ComponentChildren, JSX } from 'preact';
import { describeBasis, describeSeverity } from '../basis.ts';
import { formatArgv, formatConfidence } from '../format.ts';
import { safeHref } from '../url.ts';

export function BasisBadge(props: { readonly basis: string; readonly compact?: boolean }) {
  const descriptor = describeBasis(props.basis);
  return (
    <span
      class={`badge basis basis-${descriptor.value}`}
      title={`${descriptor.label}. ${descriptor.meaning}`}
    >
      <span class="badge-marker" aria-hidden="true">
        {descriptor.marker}
      </span>
      <span class="badge-label">
        {props.compact === true ? descriptor.label : descriptor.label}
      </span>
      <span class="visually-hidden">{` evidence class: ${descriptor.meaning}`}</span>
    </span>
  );
}

export function SeverityBadge(props: { readonly severity: string }) {
  const descriptor = describeSeverity(props.severity);
  return (
    <span
      class={`badge severity severity-${descriptor.value}`}
      title={`Severity ${descriptor.label}`}
    >
      <span class="badge-marker" aria-hidden="true">
        {descriptor.marker}
      </span>
      <span class="badge-label">{descriptor.label}</span>
      <span class="visually-hidden"> severity</span>
    </span>
  );
}

export function Chip(props: {
  readonly label: string;
  readonly title?: string;
  readonly tone?: 'neutral' | 'warn' | 'good' | 'bad';
}) {
  return (
    <span class={`chip chip-${props.tone ?? 'neutral'}`} title={props.title ?? props.label}>
      {props.label}
    </span>
  );
}

export function Confidence(props: { readonly value: number }) {
  return (
    <span class="confidence" title="Confidence in this claim, from 0 to 1.">
      <span class="muted">confidence</span> {formatConfidence(props.value)}
    </span>
  );
}

export interface DefinitionRow {
  readonly label: string;
  readonly value: ComponentChildren;
  readonly code?: boolean;
}

export function DefinitionList(props: { readonly rows: readonly DefinitionRow[] }) {
  if (props.rows.length === 0) {
    return <p class="muted">Nothing recorded.</p>;
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

export function SectionHeading(props: {
  readonly title: string;
  readonly count?: number;
  readonly note?: string;
  readonly children?: ComponentChildren;
}) {
  return (
    <div class="section-heading">
      <h3>
        {props.title}
        {props.count === undefined ? null : <span class="heading-count">{props.count}</span>}
      </h3>
      {props.note === undefined ? null : <p class="muted heading-note">{props.note}</p>}
      {props.children}
    </div>
  );
}

export type Tone = 'info' | 'warn' | 'bad' | 'good';

export function Callout(props: {
  readonly tone: Tone;
  readonly title: string;
  readonly children?: ComponentChildren;
}) {
  const markers: Readonly<Record<Tone, string>> = { info: 'i', warn: '!', bad: '×', good: '✓' };
  return (
    <div class={`callout callout-${props.tone}`} role="note">
      <p class="callout-title">
        <span class="callout-marker" aria-hidden="true">
          {markers[props.tone]}
        </span>
        {props.title}
      </p>
      {props.children === undefined ? null : <div class="callout-body">{props.children}</div>}
    </div>
  );
}

/**
 * Only http, https and file links are ever bound to an `href`. Anything else is shown as text, because
 * every string in the bundle came from a repository or from a model.
 */
export function SafeLink(props: {
  readonly href: string;
  readonly children: ComponentChildren;
  readonly title?: string;
}) {
  const resolved = safeHref(props.href);
  if (resolved === null) {
    return (
      <span
        class="unsafe-link"
        title="This link was not a http, https or file address, so it is shown as text."
      >
        {props.children}
      </span>
    );
  }
  return (
    <a class="link" href={resolved} rel="noreferrer noopener" title={props.title ?? resolved}>
      {props.children}
    </a>
  );
}

export function CommandBlock(props: { readonly argv: readonly string[]; readonly label?: string }) {
  return (
    <div class="command-block">
      {props.label === undefined ? null : <p class="command-label">{props.label}</p>}
      <pre class="command">{formatArgv(props.argv)}</pre>
    </div>
  );
}

export function EmptyState(props: {
  readonly title: string;
  readonly body: string;
  readonly commands?: readonly (readonly string[])[];
  readonly children?: ComponentChildren;
}) {
  return (
    <div class="empty-state">
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      {(props.commands ?? []).map((argv) => (
        <CommandBlock key={argv.join(' ')} argv={argv} />
      ))}
      {props.children}
    </div>
  );
}

/** Width is passed as a custom property, never as a style attribute string. */
export function Bar(props: { readonly share: number; readonly tone?: 'accent' | 'warn' }) {
  const clamped = Math.min(1, Math.max(0, props.share));
  const style: JSX.CSSProperties = { '--bar-share': `${(clamped * 100).toFixed(2)}%` };
  return (
    <span class={`bar bar-${props.tone ?? 'accent'}`} aria-hidden="true">
      <span class="bar-fill" style={style} />
    </span>
  );
}

export function BooleanValue(props: {
  readonly value: boolean;
  readonly trueLabel?: string;
  readonly falseLabel?: string;
}) {
  return (
    <span class={props.value ? 'bool bool-true' : 'bool bool-false'}>
      <span aria-hidden="true">{props.value ? '✓' : '×'}</span>{' '}
      {props.value ? (props.trueLabel ?? 'yes') : (props.falseLabel ?? 'no')}
    </span>
  );
}

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
  return <span>{props.render(props.value)}</span>;
}
