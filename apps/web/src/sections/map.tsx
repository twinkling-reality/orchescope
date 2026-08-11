/**
 * The system map: a WebGL canvas and, always under it, the accessible treegrid holding the same data.
 * The mirror is not a fallback and is never hidden, because the canvas cannot be read by a screen
 * reader at all, and it gets the full column width for the same reason.
 */

import { useMemo, useState } from 'preact/hooks';
import {
  countPresences,
  filterByPresence,
  PRESENCE_LABELS,
  type Presence,
  SELECTABLE_PRESENCES,
} from '../presentation/component-presence.ts';
import { EMPTY_COMPONENT_FILTER, filterComponents, filterEdges } from '../presentation/filters.ts';
import { formatInteger, humanise } from '../presentation/format.ts';
import { DEFAULT_LAYOUT, type MapLayoutKind } from '../presentation/layout.ts';
import { buildMapCensus } from '../presentation/map-census.ts';
import { buildOverlayScale } from '../presentation/overlay.ts';
import { buildSectionPresentations } from '../presentation/section-presentation.ts';
import { useApp } from '../store.tsx';
import { ComponentDetails } from '../ui/component-details.tsx';
import { SearchField, TokenFilter } from '../ui/filters.tsx';
import { GraphCanvas } from '../ui/graph-canvas.tsx';
import { Meta, RefusalPanel } from '../ui/primitives.tsx';
import { SectionSkeleton } from '../ui/section-skeleton.tsx';
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
      <p class="note">
        {`Every one of the ${formatInteger(census.declared)} parts this repository writes down is on the map.`}
      </p>
    );
  }
  return (
    <>
      <p class="note">
        The rest connect to nothing, so there is no shape to draw them into. They are in the table
        below and in the panel beside it.
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
  // Arriving from a delta count means arriving with that set already selected, which is what makes the
  // count on Overview an answer a reader can open rather than a number they have to trust.
  const routePresence = app.state.route.params['presence'] ?? null;
  const [presences, setPresences] = useState<readonly string[]>(
    routePresence === null || !SELECTABLE_PRESENCES.includes(routePresence as Presence)
      ? []
      : [routePresence],
  );

  const presenceCounts = useMemo(
    () => countPresences(bundle.graph.components, index),
    [bundle.graph.components, index],
  );

  const visibleComponents = useMemo(
    () =>
      filterByPresence(
        filterComponents(bundle.graph.components, { query, kinds }),
        index,
        presences as readonly Presence[],
      ),
    [bundle.graph.components, index, kinds, presences, query],
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
  const presentation = buildSectionPresentations(bundle).map;
  const hasComponents = presentation.summaryRefusal === null;

  return (
    <SectionSkeleton
      section="map"
      summary={
        <section class="tile is-band section-lead">
          <h3 class="section-lead-question">
            What is connected to what, and what could not be drawn
          </h3>
          {hasComponents ? (
            <div class="section-lead-body">
              {/* The lead is what the drawing actually contains. A component no relation touches is
                  not part of any topology, and on a real repository that is most of them, so the
                  number the screen leads with is the drawn one and the gap is stated beside it. */}
              <p class="section-lead-answer">
                <span class="section-lead-figure">
                  {formatInteger(index.layout.placedIds.size)}
                </span>
                <span>
                  {` of the ${formatInteger(bundle.graph.components.length)} parts found here ${index.layout.placedIds.size === 1 ? 'is' : 'are'} on the map, joined by ${formatInteger(bundle.graph.edges.length)} ${bundle.graph.edges.length === 1 ? 'connection' : 'connections'}.`}
                </span>
              </p>
              <div class="section-lead-aside">
                <MapCensus />
              </div>
            </div>
          ) : (
            <RefusalPanel
              title={presentation.summaryRefusal.title}
              commands={presentation.summaryRefusal.commands}
            >
              <p>{presentation.summaryRefusal.reason}</p>
            </RefusalPanel>
          )}
        </section>
      }
      primary={
        <div class="workbench">
          <div class="workbench-controls">
            <section class="tile">
              <h3 class="rail-title">Filters</h3>
              <div class="filter-bar">
                <SearchField
                  label="Search parts by name, identifier, path or tag"
                  value={query}
                  placeholder="name, path, tag"
                  onChange={setQuery}
                  resultCount={visibleComponents.length}
                  resultNoun="part"
                  resultPlural="parts"
                />
                <TokenFilter
                  legend="Kind of part"
                  selected={kinds}
                  onChange={setKinds}
                  options={index.componentKinds.map((kind) => ({
                    value: kind,
                    label: humanise(kind),
                    count: bundle.graph.components.filter((component) => component.kind === kind)
                      .length,
                  }))}
                />
                {/* Absent rather than empty when no run has been ingested: every component is then in
                    the same fourth state, so a control offering to narrow by it would narrow nothing. */}
                {!index.hasRuntimeEvidence ? null : (
                  <TokenFilter
                    legend="Has a run ever touched it"
                    selected={presences}
                    onChange={setPresences}
                    options={SELECTABLE_PRESENCES.map((presence) => ({
                      value: presence,
                      label: PRESENCE_LABELS[presence],
                      count: presenceCounts.get(presence) ?? 0,
                    }))}
                  />
                )}
                <TokenFilter
                  legend="Kind of connection"
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
                    Shade the map by
                  </label>
                  {bundle.overlays.length === 0 ? (
                    <p class="note">
                      Nothing measured here can shade the map, so every part is drawn the same.
                    </p>
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
                      <option value="">Nothing</option>
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
                        const value = (event.currentTarget as HTMLSelectElement)
                          .value as MapLayoutKind;
                        setLayout(value);
                        app.announce(
                          `${humanise(value)} arrangement. The map keeps the same parts.`,
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
                {`${formatInteger(visibleComponents.length)} of ${formatInteger(bundle.graph.components.length)} parts and ${formatInteger(visibleEdges.length)} of ${formatInteger(bundle.graph.edges.length)} connections match.`}
              </p>
            </section>
          </div>

          <div class="workbench-main">
            {/* The feature panel holds the drawing and nothing else. A table of 1727 rows inside it would
            make the panel the whole screen, and a surface that is the whole screen is not a feature of
            anything. The table is the representation this report treats as primary, so it is a block
            of its own beside the picture rather than a passenger inside it. */}
            {/* The drawing and the table carry the same parts, so with no parts they are one absence
                and not two. They used to render the same `PresentationRefusal` object one after the
                other, which said the same sentence twice inside one slot and read as two faults
                rather than one empty scan. */}
            {hasComponents ? (
              <>
                <section class="tile is-dark">
                  <h3 class="section-title">The system, drawn</h3>
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
                  <h3 class="section-title">Every part, as a table</h3>
                  <p class="note">
                    The same parts as the drawing above, reachable by keyboard. This is the version
                    this report treats as primary. Steps from a start is how many connections away
                    from an entry point a part sits, which is what the two directional arrangements
                    draw as position and the ring cannot show at all.
                  </p>
                  <TreeGridView components={visibleComponents} index={index} />
                </section>
              </>
            ) : (
              <section class="tile">
                <h3 class="section-title">The system, drawn</h3>
                {presentation.primaryRefusal === null ? null : (
                  <RefusalPanel
                    title={presentation.primaryRefusal.title}
                    commands={presentation.primaryRefusal.commands}
                  >
                    <p>{presentation.primaryRefusal.reason}</p>
                  </RefusalPanel>
                )}
              </section>
            )}
          </div>
        </div>
      }
      detail={
        <section class="tile">
          <h3 class="section-title">Details</h3>
          {!hasComponents && presentation.detailRefusal !== null ? (
            <RefusalPanel
              title={presentation.detailRefusal.title}
              commands={presentation.detailRefusal.commands}
            >
              <p>{presentation.detailRefusal.reason}</p>
            </RefusalPanel>
          ) : app.state.selected === null ? (
            <p class="lede">
              Pick something on the drawing or a row in the table to see what it is, where it was
              found, what it is connected to and what it cost.
            </p>
          ) : (
            <ComponentDetails componentId={app.state.selected} index={index} />
          )}
        </section>
      }
    />
  );
}
