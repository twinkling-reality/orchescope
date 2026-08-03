/**
 * The page frame: the top chrome, the main column, the polite live region, the keyboard help panel and
 * the request progress bar.
 *
 * The chrome carries what is true of the whole document rather than of any one screen, in three zones:
 * the mark and the repository on the left, the eight screens centred on the page, and two icons on the
 * right. Nothing in it is numbered. The sections have no order to walk in, and a number beside each one
 * implies a sequence that does not exist and that a reader would then look for.
 *
 * The three zones share one row again. They were split across two because three tracks on one line
 * centred the navigation between two zones of unequal width, which put it 128px off the middle of the
 * page on the demonstration. Two things changed that: the provenance line folded into an icon, so the
 * right zone went from 331px to 84px, and the outer tracks are `minmax(0, 1fr)` each, which centres the
 * middle one on the page rather than between its neighbours whatever either of them holds.
 *
 * It sits across the top rather than down the side because the width is what the reports need. A rail
 * took 216 pixels from every screen, and the screens that suffered most were the ones with the widest
 * evidence in them: a seven column components table on a repository with 1727 components. The chrome is
 * 57 pixels of height on one row and gives all of that width back.
 *
 * The chrome is the first tile of the bento rather than a bar above it: it takes the same inset every
 * tile takes, so the mark sits over the first tile's own content.
 *
 * The project name is the `h1`, because the document is a report about that repository. A section's
 * label is a visually hidden `h2`, which is what a screen reader navigates by.
 */

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { formatInteger, formatTimestamp } from '../format.ts';
import { formatHash, SECTIONS, type SectionId } from '../routes.ts';
import { useApp } from '../store.tsx';
import { DefinitionList, Eyebrow } from './primitives.tsx';

export const SHORTCUTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Alt and 1 to 8', action: 'Go to the nth section in the navigation' },
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
      class="tile help-panel fade-in"
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

/**
 * What a section holds, shown beside its name.
 *
 * A count of zero is omitted rather than shown, because a navigation of zeros reads as chrome while the
 * screen itself refuses in a sentence that says considerably more than a nought would.
 */
function useSectionCount(): (section: SectionId) => number | undefined {
  const { bundle } = useApp();
  return (section) => {
    const counts: Readonly<Record<SectionId, number>> = {
      overview: 0,
      map: bundle.summary.componentCount,
      findings: bundle.findings.length,
      performance: bundle.runs.length,
      resilience: bundle.chaosReports.length,
      scenarios: bundle.scenarios.length,
      comparisons: bundle.comparisons.length,
      goals: bundle.goals.length,
    };
    const count = counts[section];
    return count > 0 ? count : undefined;
  };
}

/**
 * The eight screens, centred on the page.
 *
 * The current one is a filled pill rather than a rule under a word. The rule was the quietest possible
 * marker on the busiest line of the document, and on a bar carrying eight labels it read as an
 * underline on a link rather than as where you are. A pill also fixes the weight problem the rule was
 * chosen to avoid: it changes the ground and not the type, so no other label moves sideways when a
 * reader changes section.
 *
 * Where you are is therefore no longer the accent. The accent still marks focus, selection and a link,
 * which are the three facts about the interface that are not "which of eight screens is this".
 */
function Navigation() {
  const app = useApp();
  const countOf = useSectionCount();
  return (
    <nav class="chrome-nav" aria-label="Report sections">
      <ul class="nav-list">
        {SECTIONS.map((section) => {
          const current = app.state.route.section === section.id;
          const count = countOf(section.id);
          return (
            <li key={section.id}>
              <a
                class={current ? 'nav-link current' : 'nav-link'}
                href={formatHash(section.id)}
                aria-current={current ? 'page' : undefined}
              >
                {section.label}
                {count === undefined ? null : <span class="nav-count">{formatInteger(count)}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The temporary mark. Two rings and a centre, which is the concentric arrangement the map draws, and
 * the only place in this document where a shape is drawn for its own sake. It is decoration and says
 * so: the product name beside it is the text a screen reader gets.
 */
function Mark() {
  return (
    <span class="mark">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
        <rect class="mark-plate" width="24" height="24" rx="5" />
        <circle class="mark-ring" cx="12" cy="12" r="7.25" />
        <circle class="mark-core" cx="12" cy="12" r="3" />
      </svg>
      <span class="visually-hidden">Orchescope</span>
    </span>
  );
}

/**
 * Which report this is, and the revision the scan read.
 *
 * It used to be three mono facts set across the top right of every screen, which is the widest thing
 * in the chrome and the least often read. It is a menu now, behind one icon: a `details` element for
 * the same reasons every other disclosure here is one, so it works before the script runs, is in the
 * tab order without a `tabindex` and announces its own expanded state.
 *
 * The revision is the one piece of provenance that decides whether the rest of the page can be
 * trusted, because a working tree that was dirty means the graph matches no commit anyone else can
 * check out. It is the first row rather than a footnote.
 */
function ReportDetails() {
  const { bundle } = useApp();
  const git = bundle.graph.provenance.git;
  const revision =
    git === undefined
      ? 'no git revision recorded'
      : `${git.ref ?? 'unknown ref'} ${(git.commit ?? '').slice(0, 7)}, working tree ${git.dirty ? 'dirty' : 'clean'}`;
  return (
    <details class="chrome-menu">
      <summary class="icon-button" title="Report details">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <circle class="glyph-stroke" cx="8" cy="8" r="6.25" />
          <path class="glyph-stroke" d="M8 7.25v4" />
          <path class="glyph-stroke" d="M8 4.75v0.5" />
        </svg>
        <span class="visually-hidden">Report details</span>
      </summary>
      <div class="chrome-menu-body">
        <Eyebrow level={3}>Report details</Eyebrow>
        <DefinitionList
          rows={[
            { label: 'Revision', value: revision, code: git !== undefined },
            { label: 'Report', value: bundle.reportId, code: true },
            { label: 'Generated', value: formatTimestamp(bundle.generatedAt) },
            { label: 'Scan', value: bundle.graph.provenance.scanId, code: true },
            { label: 'Schema version', value: String(bundle.schemaVersion) },
            { label: 'Orchescope', value: bundle.graph.provenance.orchescopeVersion },
          ]}
        />
      </div>
    </details>
  );
}

function Chrome() {
  const app = useApp();
  const { bundle } = app;
  return (
    <header class="chrome">
      <div class="chrome-identity">
        <Mark />
        <span class="slash" aria-hidden="true">
          /
        </span>
        <h1 class="project">{bundle.projectName}</h1>
      </div>

      <Navigation />

      <div class="chrome-tools">
        <ReportDetails />
        <button
          type="button"
          class="icon-button"
          title="Keyboard shortcuts"
          aria-expanded={app.state.helpOpen}
          onClick={() => {
            app.dispatch({ type: 'help', open: !app.state.helpOpen });
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
            <rect class="glyph-stroke" x="1.25" y="3.75" width="13.5" height="8.5" rx="1.5" />
            <path class="glyph-stroke" d="M5 9.75h6" />
            <path class="glyph-stroke" d="M4 6.75h0.5M7 6.75h0.5M10 6.75h0.5" />
          </svg>
          <span class="visually-hidden">Keyboard shortcuts</span>
        </button>
      </div>
    </header>
  );
}

export function Shell(props: {
  readonly children: ComponentChildren;
  readonly repaired: readonly string[];
  readonly source: 'embedded' | 'server';
}) {
  const app = useApp();
  return (
    <div class="page">
      <a class="skip-link" href="#main">
        Skip to the report
      </a>
      <ProgressBar />
      <Chrome />
      <main class="main" id="main" tabIndex={-1}>
        <div class="live-region" role="status" aria-live="polite" aria-atomic="true">
          {app.state.announcement}
        </div>
        <HelpPanel />
        {props.repaired.length === 0 ? null : (
          <section class="tile is-band">
            <div class="refusal" role="note">
              <p class="t">This report was missing part of itself.</p>
              <p>
                {`${props.repaired.join(', ')} could not be read, so those parts are shown as empty rather than as zero. A value that was never recorded is not a value of nought.`}
              </p>
            </div>
          </section>
        )}
        {props.children}
        {/* What the details menu does not carry: where this page read its report from, and the one
            fact about the page itself rather than about the report. */}
        <footer class="tile footer">
          <Eyebrow>Provenance</Eyebrow>
          <p>
            {`Report read ${props.source === 'embedded' ? 'from the document itself' : 'from the local report server'}. This page makes no network request other than to its own origin. Which report, which scan and which revision are under report details in the bar above.`}
          </p>
        </footer>
      </main>
    </div>
  );
}
