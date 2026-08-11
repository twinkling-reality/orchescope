/**
 * Moving between the reports `pnpm states` rendered, without going back to an index.
 *
 * Present only when this page was written into a gallery. A report served by the real command carries
 * no sibling list, so the control is absent rather than disabled: there is no setting that would grant
 * it, because one report is one repository and that is the boundary the analysis is built on.
 */

import type { GalleryEntry } from '../presentation/gallery.ts';
import { formatInteger } from '../presentation/format.ts';
import { ChromeMenu } from './chrome-menu.tsx';

export function GalleryPicker(props: {
  readonly entries: readonly GalleryEntry[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  if (props.entries.length < 2) {
    return null;
  }
  const current = props.entries.find((entry) => entry.current);
  return (
    <ChromeMenu
      title="Other reports in this gallery"
      open={props.open}
      onOpenChange={props.onOpenChange}
      wide
      icon={
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <rect class="glyph-stroke" x="2.25" y="2.25" width="5" height="5" rx="1" />
          <rect class="glyph-stroke" x="8.75" y="2.25" width="5" height="5" rx="1" />
          <rect class="glyph-stroke" x="2.25" y="8.75" width="5" height="5" rx="1" />
          <rect class="glyph-stroke" x="8.75" y="8.75" width="5" height="5" rx="1" />
        </svg>
      }
    >
      <p class="gallery-note">
        {`${formatInteger(props.entries.length)} cached reports, rendered by pnpm states. This picker exists in the gallery only: a report of one repository cannot switch to another, because identity and revision are pinned to one working tree.`}
      </p>
      <ul class="gallery-list">
        {props.entries.map((entry) => (
          <li key={entry.page}>
            {/* The current page is a plain row rather than a link to itself. A link that reloads the
                page you are on reads as a control that did nothing. */}
            {entry.current ? (
              <span class="gallery-item is-current" aria-current="page">
                <span class="gallery-project">{entry.project}</span>
                <span class="gallery-measures">
                  <span>{`${formatInteger(entry.components)} components`}</span>
                  <span>
                    {entry.runs === 0
                      ? 'no runs'
                      : `${formatInteger(entry.runs)} ${entry.runs === 1 ? 'run' : 'runs'}`}
                  </span>
                </span>
              </span>
            ) : (
              <a
                class="gallery-item"
                href={entry.page}
                title={`Open the report for ${entry.project}`}
              >
                <span class="gallery-project">{entry.project}</span>
                <span class="gallery-measures">
                  <span>{`${formatInteger(entry.components)} components`}</span>
                  <span>
                    {entry.runs === 0
                      ? 'no runs'
                      : `${formatInteger(entry.runs)} ${entry.runs === 1 ? 'run' : 'runs'}`}
                  </span>
                </span>
              </a>
            )}
          </li>
        ))}
      </ul>
      {current === undefined ? null : <p class="gallery-note">{`Showing ${current.project}.`}</p>}
    </ChromeMenu>
  );
}
