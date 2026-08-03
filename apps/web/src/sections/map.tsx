/**
 * The system map: a WebGL canvas and, always under it, the accessible treegrid holding the same data.
 * The mirror is not a fallback and is never hidden, because the canvas cannot be read by a screen
 * reader at all, and it gets the full column width for the same reason.
 */

import { useMemo, useState } from 'preact/hooks';
import { manifestCommand } from '../commands.ts';
import { EMPTY_COMPONENT_FILTER, filterComponents, filterEdges } from '../filters.ts';
import { formatInteger, humanise } from '../format.ts';
import { DEFAULT_LAYOUT, type MapLayoutKind } from '../layout.ts';
import { buildMapCensus } from '../map-census.ts';
import { buildOverlayScale } from '../overlay.ts';
import { useApp } from '../store.tsx';
import { ComponentDetails } from '../ui/component-details.tsx';
import { SearchField, TokenFilter } from '../ui/filters.tsx';
import { GraphCanvas } from '../ui/graph-canvas.tsx';
import { Data, Eyebrow, Meta, RefusalPanel } from '../ui/primitives.tsx';
import { TreeGridView } from '../ui/treegrid-view.tsx';

/**
 * What the map draws and what it does not.
 *
 * The map draws components a relation touches, because a component with no relation is not part of any
 * topology. That is a large omission on a real repository and it is stated here rather than implied: a
 * view that quietly showed 22% of a repository would mislead more than one that drew the other 78%
 * badly.
 */
function MapCensus() {
  const { bundle, index } = useApp();
  const census = buildMapCensus(bundle.graph.components, index.layout.placedIds);
  if (census.omitted.length === 0) {
    return (
      <p class="lede">
        {`Every one of the ${formatInteger(census.declared)} components this repository declares is on the map.`}
      </p>
    );
  }
  return (
    <>
      <p class="lede">
        <Data>{formatInteger(census.drawn)}</Data>
        {' of '}
        <Data>{formatInteger(census.declared)}</Data>
        {
          ' components are on the map. The rest take part in no relation, so there is no topology to draw them into. They are in the table below and in the details panel.'
        }
      </p>
      <Meta>
        {census.omitted.map((row) => (
          <span key={row.kind}>
            {`${humanise(row.kind)} ${formatInteger(row.drawn)} of ${formatInteger(row.declared)}`}
          </span>
        ))}
      </Meta>
    </>
  );
}

export function MapSection() {
  const app = useApp();
  const { bundle, index } = app;
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<readonly string[]>(EMPTY_COMPONENT_FILTER.kinds);
  const [edgeKinds, setEdgeKinds] = useState<readonly string[]>([]);
  const [overlayKind, setOverlayKind] = useState<string>('');
  const [layout, setLayout] = useState<MapLayoutKind>(DEFAULT_LAYOUT);

  const visibleComponents = useMemo(
    () => filterComponents(bundle.graph.components, { query, kinds }),
    [bundle.graph.components, kinds, query],
  );
  const visibleIds = useMemo(
    () => new Set(visibleComponents.map((component) => component.id)),
    [visibleComponents],
  );
  const visibleEdges = useMemo(
    () => filterEdges(bundle.graph.edges, edgeKinds, visibleIds),
    [bundle.graph.edges, edgeKinds, visibleIds],
  );

  const overlay = useMemo(() => {
    const found = bundle.overlays.find((candidate) => candidate.kind === overlayKind);
    return found === undefined ? null : buildOverlayScale(found);
  }, [bundle.overlays, overlayKind]);

  if (bundle.graph.components.length === 0) {
    return (
      <section class="tile is-band">
        <Eyebrow level={3}>System map</Eyebrow>
        <RefusalPanel
          title="This report contains no components, so there is no map to draw."
          commands={[manifestCommand()]}
        >
          <p>
            The scan produced an empty graph. What it looked for and could not read is listed under
            what was read on the overview. A manifest is how a system this build cannot parse from
            source gets into the graph.
          </p>
        </RefusalPanel>
      </section>
    );
  }

  return (
    // Filters beside the graph rather than above it. Eleven component kinds, eleven relation kinds, a
    // search field and two selects took the whole first screenful on every corpus repository and put
    // the thing they filter below the fold.
    <div class="workbench">
      <div class="workbench-controls">
        <section class="tile">
          <Eyebrow level={3}>Filters</Eyebrow>
          <div class="filter-bar">
            <SearchField
              label="Search components by name, identifier, path or tag"
              value={query}
              placeholder="name, path, tag"
              onChange={setQuery}
              resultCount={visibleComponents.length}
              resultNoun="component"
              resultPlural="components"
            />
            <TokenFilter
              legend="Component kind"
              selected={kinds}
              onChange={setKinds}
              options={index.componentKinds.map((kind) => ({
                value: kind,
                label: humanise(kind),
                count: bundle.graph.components.filter((component) => component.kind === kind)
                  .length,
              }))}
            />
            <TokenFilter
              legend="Relation kind"
              selected={edgeKinds}
              onChange={setEdgeKinds}
              options={index.edgeKinds.map((kind) => ({
                value: kind,
                label: humanise(kind),
                count: bundle.graph.edges.filter((edge) => edge.kind === kind).length,
              }))}
            />
            <div class="field-select">
              <label class="field-label" for="overlay">
                Overlay
              </label>
              {bundle.overlays.length === 0 ? (
                <p class="note">This report carries no overlays, so nodes are drawn uniformly.</p>
              ) : (
                <select
                  id="overlay"
                  class="input"
                  value={overlayKind}
                  onChange={(event) => {
                    const value = (event.currentTarget as HTMLSelectElement).value;
                    setOverlayKind(value);
                    app.announce(
                      value === ''
                        ? 'Overlay cleared.'
                        : `Overlay set to ${bundle.overlays.find((candidate) => candidate.kind === value)?.label ?? value}.`,
                    );
                  }}
                >
                  <option value="">No overlay</option>
                  {bundle.overlays.map((candidate) => (
                    <option value={candidate.kind} key={candidate.kind}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {index.layout.kinds.length < 2 ? null : (
              <div class="field-select">
                <label class="field-label" for="layout">
                  Arrangement
                </label>
                <select
                  id="layout"
                  class="input"
                  value={layout}
                  onChange={(event) => {
                    const value = (event.currentTarget as HTMLSelectElement).value as MapLayoutKind;
                    setLayout(value);
                    app.announce(
                      `${humanise(value)} arrangement. The map keeps the same components.`,
                    );
                  }}
                >
                  {index.layout.kinds.map((kind) => (
                    <option value={kind} key={kind}>
                      {humanise(kind)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p class="match-count" aria-live="polite">
            {`${formatInteger(visibleComponents.length)} of ${formatInteger(bundle.graph.components.length)} components and ${formatInteger(visibleEdges.length)} of ${formatInteger(bundle.graph.edges.length)} relations match.`}
          </p>
        </section>
      </div>

      <div class="workbench-main">
        {/* The feature panel holds the drawing and nothing else. A table of 1727 rows inside it would
            make the panel the whole screen, and a surface that is the whole screen is not a feature of
            anything. The table is the representation this report treats as primary, so it is a block
            of its own beside the picture rather than a passenger inside it. */}
        <section class="tile is-dark">
          <Eyebrow level={3}>The system</Eyebrow>
          <MapCensus />
          <GraphCanvas
            index={index}
            visibleComponents={visibleComponents}
            visibleEdges={visibleEdges}
            overlay={overlay}
            layout={layout}
            selected={app.state.selected}
            onSelect={(componentId) => {
              app.selectComponent(componentId);
            }}
          />
        </section>

        <section class="tile">
          <Eyebrow level={3}>Components</Eyebrow>
          <p class="note">
            The same components as the canvas above, as a keyboard navigable structure. This is the
            representation this report treats as primary. Depth is how many relations from an entry
            point a component sits, which is what the two directional arrangements draw as position
            and the concentric one cannot show at all.
          </p>
          <TreeGridView components={visibleComponents} index={index} />
        </section>

        <section class="tile">
          <Eyebrow level={3}>Details</Eyebrow>
          {app.state.selected === null ? (
            <p class="lede">
              Select a node on the canvas or a row in the table to see what a component is, where it
              was found, what it is connected to and what it cost.
            </p>
          ) : (
            <ComponentDetails componentId={app.state.selected} index={index} />
          )}
        </section>
      </div>
    </div>
  );
}
