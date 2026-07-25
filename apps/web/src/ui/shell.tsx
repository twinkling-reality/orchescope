/**
 * The page frame: skip link, header, section navigation, the polite live region, the keyboard help panel
 * and the request progress bar.
 */

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { formatTimestamp } from '../format.ts';
import { formatHash, SECTIONS } from '../routes.ts';
import { type ThemeChoice, useApp } from '../store.tsx';

const THEMES: readonly { readonly value: ThemeChoice; readonly label: string }[] = [
  { value: 'system', label: 'Match the system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const SHORTCUTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Alt and 1 to 8', action: 'Go to the numbered section in the navigation' },
  { keys: 'Question mark', action: 'Open and close this help panel' },
  { keys: 'Escape', action: 'Close this help panel' },
  { keys: 'Tab and Shift Tab', action: 'Move between controls' },
  { keys: 'Up and Down arrows', action: 'Move between rows in the components table' },
  { keys: 'Right arrow', action: 'Open a component kind, or move to its first component' },
  { keys: 'Left arrow', action: 'Close a component kind, or move to the kind above' },
  { keys: 'Enter or Space', action: 'Select the focused component, or open and close a kind' },
  { keys: 'Home and End', action: 'Move to the first or last row of the components table' },
  { keys: 'Asterisk', action: 'Open every component kind in the components table' },
];

const MIN_PROGRESS_SHARE = 0.08;

function ProgressBar() {
  const app = useApp();
  const { pending, completed } = app.state;
  if (pending === 0) {
    return null;
  }
  const total = pending + completed;
  const share = Math.max(MIN_PROGRESS_SHARE, total === 0 ? 0 : completed / total);
  const style: JSX.CSSProperties = { '--progress-share': `${(share * 100).toFixed(1)}%` };
  return (
    <div class="progress-block">
      <div
        class="progress"
        role="progressbar"
        aria-label="Requests to the local report server"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-valuetext={`${completed} of ${total} requests finished`}
      >
        <span class="progress-fill" style={style} />
      </div>
      <p class="progress-label">{`${pending} request${pending === 1 ? '' : 's'} in flight, ${completed} of ${total} finished.`}</p>
    </div>
  );
}

function HelpPanel() {
  const app = useApp();
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (app.state.helpOpen) {
      panelRef.current?.focus();
    }
  }, [app.state.helpOpen]);

  if (!app.state.helpOpen) {
    return null;
  }
  return (
    <div
      class="help-panel fade-in"
      role="dialog"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      ref={panelRef}
    >
      <div class="help-head">
        <h2>Keyboard shortcuts</h2>
        <button
          type="button"
          class="button"
          onClick={() => {
            app.dispatch({ type: 'help', open: false });
          }}
        >
          Close
        </button>
      </div>
      <dl class="definitions">
        {SHORTCUTS.map((shortcut) => (
          <div class="definition" key={shortcut.keys}>
            <dt>{shortcut.keys}</dt>
            <dd>{shortcut.action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Navigation() {
  const app = useApp();
  return (
    <nav class="nav" aria-label="Report sections">
      <ul class="nav-list">
        {SECTIONS.map((section, offset) => {
          const current = app.state.route.section === section.id;
          return (
            <li key={section.id}>
              <a
                class={current ? 'nav-link current' : 'nav-link'}
                href={formatHash(section.id)}
                aria-current={current ? 'page' : undefined}
              >
                <span class="nav-index" aria-hidden="true">
                  {offset + 1}
                </span>
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Shell(props: {
  readonly children: ComponentChildren;
  readonly repaired: readonly string[];
  readonly source: 'embedded' | 'server';
}) {
  const app = useApp();
  const { bundle } = app;
  return (
    <div class="shell">
      <a class="skip-link" href="#main">
        Skip to the report
      </a>
      <ProgressBar />
      <header class="header">
        <div class="header-title">
          <p class="product">Orchescope</p>
          <h1>{bundle.projectName}</h1>
          <p class="muted">{`Report ${bundle.reportId}, generated ${formatTimestamp(bundle.generatedAt)}`}</p>
        </div>
        <div class="header-controls">
          <label class="field-label" for="theme">
            Theme
          </label>
          <select
            id="theme"
            class="input"
            value={app.state.theme}
            onChange={(event: JSX.TargetedEvent<HTMLSelectElement>) => {
              const value = event.currentTarget.value as ThemeChoice;
              app.dispatch({ type: 'theme', theme: value });
              app.announce(`Theme set to ${value}.`);
            }}
          >
            {THEMES.map((theme) => (
              <option value={theme.value} key={theme.value}>
                {theme.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            class="button"
            aria-expanded={app.state.helpOpen}
            onClick={() => {
              app.dispatch({ type: 'help', open: !app.state.helpOpen });
            }}
          >
            Keyboard shortcuts
          </button>
        </div>
      </header>
      <Navigation />
      <HelpPanel />
      <div class="live-region" role="status" aria-live="polite" aria-atomic="true">
        {app.state.announcement}
      </div>
      {props.repaired.length === 0 ? null : (
        <p class="callout callout-warn" role="note">
          {`This report was missing ${props.repaired.join(', ')}, so those parts are shown as empty rather than as zero.`}
        </p>
      )}
      <main class="main" id="main" tabIndex={-1}>
        {props.children}
      </main>
      <footer class="footer">
        <p class="muted">
          {`Schema version ${bundle.schemaVersion}. Scan ${bundle.graph.provenance.scanId}. Orchescope ${bundle.graph.provenance.orchescopeVersion}. Report read ${props.source === 'embedded' ? 'from the document itself' : 'from the local report server'}. This page makes no network request other than to its own origin.`}
        </p>
      </footer>
    </div>
  );
}
