/**
 * The system map: a WebGL canvas and, always beside it, the accessible treegrid holding the same data.
 * The mirror is not a fallback and is never hidden, because the canvas cannot be read by a screen
 * reader at all.
 */

import { useMemo, useState } from 'preact/hooks';
import { EMPTY_COMPONENT_FILTER, filterComponents, filterEdges } from '../filters.ts';
import { formatInteger, humanise } from '../format.ts';
import { buildOverlayScale } from '../overlay.ts';
import { useApp } from '../store.tsx';
import { Callout, SectionHeading } from '../ui/atoms.tsx';
import { ComponentDetails } from '../ui/component-details.tsx';
import { SearchField, TokenFilter } from '../ui/filters.tsx';
import { GraphCanvas } from '../ui/graph-canvas.tsx';
import { TreeGridView } from '../ui/treegrid-view.tsx';

export function MapSection() {
  const app = useApp();
  const { bundle, index } = app;
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<readonly string[]>(EMPTY_COMPONENT_FILTER.kinds);
  const [edgeKinds, setEdgeKinds] = useState<readonly string[]>([]);
  const [overlayKind, setOverlayKind] = useState<string>('');

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
      <div class="section">
        <Callout
          tone="warn"
          title="This report contains no components, so there is no map to draw."
        >
          <p>
            The scan produced an empty graph. The coverage block on the overview lists what it could
            not read.
          </p>
        </Callout>
      </div>
    );
  }

  return (
    <div class="section">
      <section class="panel">
        <SectionHeading title="Filters" />
        <div class="filter-bar">
          <SearchField
            label="Search components by name, identifier, path or tag"
            value={query}
            placeholder="name, path, tag"
            onChange={setQuery}
            resultCount={visibleComponents.length}
            resultNoun="component"
          />
          <TokenFilter
            legend="Component kind"
            selected={kinds}
            onChange={setKinds}
            options={index.componentKinds.map((kind) => ({
              value: kind,
              label: humanise(kind),
              count: bundle.graph.components.filter((component) => component.kind === kind).length,
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
          <div class="overlay-select">
            <label class="field-label" for="overlay">
              Overlay
            </label>
            {bundle.overlays.length === 0 ? (
              <p class="muted">This report carries no overlays, so nodes are drawn uniformly.</p>
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
        </div>
        <p class="muted" aria-live="polite">
          {`${formatInteger(visibleComponents.length)} of ${formatInteger(bundle.graph.components.length)} components and ${formatInteger(visibleEdges.length)} of ${formatInteger(bundle.graph.edges.length)} relations match.`}
        </p>
      </section>

      <div class="map-layout">
        <section class="panel">
          <SectionHeading title="Map" />
          <GraphCanvas
            index={index}
            visibleComponents={visibleComponents}
            visibleEdges={visibleEdges}
            overlay={overlay}
            selected={app.state.selected}
            onSelect={(componentId) => {
              app.selectComponent(componentId);
            }}
          />
        </section>

        <section class="panel">
          <SectionHeading
            title="Components table"
            note="The same components as the map above, as a keyboard navigable structure."
          />
          <TreeGridView components={visibleComponents} index={index} />
        </section>
      </div>

      <section class="panel">
        <SectionHeading title="Details" />
        {app.state.selected === null ? (
          <p class="muted">
            Select a node on the map or a row in the table to see what a component is, where it was
            found, what it is connected to and what it cost.
          </p>
        ) : (
          <ComponentDetails componentId={app.state.selected} index={index} />
        )}
      </section>
    </div>
  );
}
