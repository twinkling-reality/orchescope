/**
 * The WebGL system map.
 *
 * The canvas is a second rendering of data that is already present in the treegrid below it, so it is
 * hidden from assistive technology rather than described badly. The zoom controls are real buttons
 * outside the canvas and stay in the tab order. When WebGL is unavailable the canvas says so and the
 * report keeps working, because the accessible mirror is the primary representation, not the fallback.
 */

import type { Component, Edge } from '@orchescope/schema';
import { MultiDirectedGraph } from 'graphology';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Sigma from 'sigma';
import { formatInteger, formatNumber, humanise } from '../format.ts';
import type { GraphIndex } from '../graph-index.ts';
import type { Point } from '../layout.ts';
import { type OverlayScale, overlayLegend, paintComponent } from '../overlay.ts';

type NodeAttrs = {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
};

type EdgeAttrs = {
  size: number;
  color: string;
  kind: string;
};

const SELECTED_COLOR = '#b4341f';
const EDGE_COLOR = '#9aa1ad';
const SELECTED_EDGE_COLOR = '#d0663f';

/**
 * Canvas colours read from the same custom properties as the rest of the page.
 *
 * The canvas is drawn on a WebGL surface, so it inherits nothing from the stylesheet. Reading the resolved values keeps
 * the map legible in both themes instead of painting dark labels on a dark background.
 */
interface CanvasPalette {
  readonly label: string;
  readonly edge: string;
}

function readPalette(element: HTMLElement): CanvasPalette {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  };
  return { label: read('--fg', '#1c2028'), edge: read('--border-strong', EDGE_COLOR) };
}
const BASE_EDGE_SIZE = 1;
const SELECTED_SIZE_BOOST = 4;

interface BuiltGraph {
  readonly graph: MultiDirectedGraph<NodeAttrs, EdgeAttrs>;
  /** Edges whose endpoints are not in the graph. Reported rather than dropped quietly. */
  readonly danglingEdges: readonly string[];
}

function buildGraph(index: GraphIndex): BuiltGraph {
  const graph = new MultiDirectedGraph<NodeAttrs, EdgeAttrs>();
  for (const [id, component] of index.componentsById) {
    const point = index.layout.positions.get(id) ?? { x: 0, y: 0 };
    graph.addNode(id, {
      x: point.x,
      y: point.y,
      size: 6,
      color: '#5aa2f0',
      label: component.displayName,
    });
  }
  const dangling: string[] = [];
  for (const [id, edge] of index.edgesById) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) {
      dangling.push(id);
      continue;
    }
    if (graph.hasEdge(id)) {
      continue;
    }
    graph.addDirectedEdgeWithKey(id, edge.from, edge.to, {
      size: BASE_EDGE_SIZE,
      color: EDGE_COLOR,
      kind: edge.kind,
    });
  }
  return { graph, danglingEdges: dangling };
}

interface PaintState {
  visibleNodes: ReadonlySet<string>;
  visibleEdges: ReadonlySet<string>;
  overlay: OverlayScale | null;
  selected: string | null;
  neighbours: ReadonlySet<string>;
}

export function GraphCanvas(props: {
  readonly index: GraphIndex;
  readonly visibleComponents: readonly Component[];
  readonly visibleEdges: readonly Edge[];
  readonly overlay: OverlayScale | null;
  readonly selected: string | null;
  readonly onSelect: (componentId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const paletteRef = useRef<CanvasPalette>({ label: '#1c2028', edge: EDGE_COLOR });
  const rendererRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const built = useMemo(() => buildGraph(props.index), [props.index]);

  const neighbours = useMemo(() => {
    if (props.selected === null) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    for (const edge of props.index.outgoing.get(props.selected) ?? []) {
      ids.add(edge.id);
    }
    for (const edge of props.index.incoming.get(props.selected) ?? []) {
      ids.add(edge.id);
    }
    return ids;
  }, [props.index, props.selected]);

  const paint = useRef<PaintState>({
    visibleNodes: new Set(),
    visibleEdges: new Set(),
    overlay: null,
    selected: null,
    neighbours: new Set(),
  });
  paint.current = {
    visibleNodes: new Set(props.visibleComponents.map((component) => component.id)),
    visibleEdges: new Set(props.visibleEdges.map((edge) => edge.id)),
    overlay: props.overlay,
    selected: props.selected,
    neighbours,
  };

  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }
    let renderer: Sigma<NodeAttrs, EdgeAttrs>;
    try {
      paletteRef.current = readPalette(container);
      renderer = new Sigma<NodeAttrs, EdgeAttrs>(built.graph, container, {
        allowInvalidContainer: true,
        defaultEdgeType: 'arrow',
        renderEdgeLabels: false,
        labelFont: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        labelSize: 11,
        labelDensity: 0.5,
        labelColor: { color: paletteRef.current.label },
        zIndex: true,
        minCameraRatio: 0.05,
        maxCameraRatio: 12,
        // The reducer result is the data the renderer draws with, so the stored coordinate has to be carried
        // through. Returning only the attributes that change would leave the node without a position.
        nodeReducer: (node, data) => {
          const state = paint.current;
          if (!state.visibleNodes.has(node)) {
            return { ...data, hidden: true };
          }
          const painted = paintComponent(state.overlay, node);
          const isSelected = state.selected === node;
          return {
            ...data,
            hidden: false,
            color: isSelected ? SELECTED_COLOR : painted.color,
            size: isSelected ? painted.size + SELECTED_SIZE_BOOST : painted.size,
            zIndex: isSelected ? 2 : 1,
            highlighted: isSelected,
            forceLabel: isSelected,
          };
        },
        edgeReducer: (edge, data) => {
          const state = paint.current;
          if (!state.visibleEdges.has(edge)) {
            return { ...data, hidden: true };
          }
          const incident = state.neighbours.has(edge);
          return {
            ...data,
            hidden: false,
            color: incident ? SELECTED_EDGE_COLOR : paletteRef.current.edge,
            size: incident ? BASE_EDGE_SIZE * 2 : BASE_EDGE_SIZE,
            zIndex: incident ? 2 : 0,
          };
        },
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return undefined;
    }
    renderer.on('clickNode', ({ node }) => {
      onSelectRef.current(node);
    });
    rendererRef.current = renderer;

    // The theme is switched by an attribute on the root element, which the canvas cannot see any other way.
    const themeWatcher = new MutationObserver(() => {
      try {
        paletteRef.current = readPalette(container);
        renderer.setSetting('labelColor', { color: paletteRef.current.label });
        renderer.refresh({ skipIndexation: true });
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    });
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      themeWatcher.disconnect();
      renderer.kill();
      rendererRef.current = null;
    };
  }, [built]);

  /**
   * A renderer that fails part way through must not take the page with it: the accessible mirror below the
   * canvas is the primary representation of this data, so every call into the renderer is contained.
   */
  useEffect(() => {
    try {
      rendererRef.current?.refresh({ skipIndexation: true });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, [props.visibleComponents, props.visibleEdges, props.overlay, props.selected, neighbours]);

  const camera = () => rendererRef.current?.getCamera() ?? null;
  const zoom = (factor: number) => {
    const current = camera();
    if (current === null) {
      return;
    }
    const state = current.getState();
    current.setState({ ratio: Math.min(12, Math.max(0.05, state.ratio * factor)) });
  };
  /**
   * Frames what is on screen rather than the whole graph. Sigma fits its camera to the bounding box it is given, so
   * restricting that box to the visible nodes is what makes the control mean what its label says when a filter is on.
   */
  const fit = () => {
    const renderer = rendererRef.current;
    if (renderer === null) {
      return;
    }
    const points: Point[] = [];
    for (const id of paint.current.visibleNodes) {
      const point = props.index.layout.positions.get(id);
      if (point !== undefined) {
        points.push(point);
      }
    }
    if (points.length === 0) {
      renderer.setCustomBBox(null);
    } else {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      renderer.setCustomBBox({
        x: [Math.min(...xs), Math.max(...xs)],
        y: [Math.min(...ys), Math.max(...ys)],
      });
    }
    renderer.refresh({ skipIndexation: true });
    renderer.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  };

  const canvasStyle: JSX.CSSProperties = { '--canvas-height': '420px' };

  return (
    <div class="canvas-block">
      <div class="canvas-toolbar" role="toolbar" aria-label="Map view controls">
        <button type="button" class="button" onClick={() => zoom(1 / 1.3)} title="Zoom in">
          Zoom in
        </button>
        <button type="button" class="button" onClick={() => zoom(1.3)} title="Zoom out">
          Zoom out
        </button>
        <button
          type="button"
          class="button"
          onClick={fit}
          title="Frame every component that the current filters leave visible"
        >
          Zoom to fit
        </button>
        <p class="muted canvas-hint">
          {`Drag to pan, scroll to zoom, click a node to select it. ${formatInteger(props.visibleComponents.length)} of ${formatInteger(props.index.componentsById.size)} components and ${formatInteger(props.visibleEdges.length)} of ${formatInteger(props.index.edgesById.size)} relations shown.`}
        </p>
      </div>
      {failure === null ? null : (
        <p class="callout callout-warn" role="note">
          {`The canvas could not start: ${failure}. Everything it would show is in the table below.`}
        </p>
      )}
      <div
        class="canvas"
        style={canvasStyle}
        ref={containerRef}
        aria-hidden="true"
        role="presentation"
      />
      {built.danglingEdges.length === 0 ? null : (
        <p class="muted">
          {`${formatInteger(built.danglingEdges.length)} relations name a component that is not in this graph and are not drawn.`}
        </p>
      )}
      {props.index.layout.fallbackIds.length === 0 ? null : (
        <p class="muted">
          {`${formatInteger(props.index.layout.fallbackIds.length)} components carried no stored position and were placed on a ring computed from their identifiers, so the map is stable between reloads but their placement carries no meaning.`}
        </p>
      )}
      {props.overlay === null ? null : <OverlayLegend overlay={props.overlay} />}
    </div>
  );
}

function OverlayLegend(props: { readonly overlay: OverlayScale }) {
  const { overlay } = props;
  const unit = overlay.unit === null ? '' : ` ${overlay.unit}`;
  const stops = overlayLegend(overlay);
  return (
    <div class="legend">
      <p class="legend-title">
        {`${overlay.label}${overlay.unit === null ? '' : ` (${overlay.unit})`}`}
      </p>
      <ul class="legend-stops">
        {stops.map((stop) => (
          <li class="legend-stop" key={stop.t}>
            <span
              class="legend-swatch"
              style={{ '--swatch': stop.color } as JSX.CSSProperties}
              aria-hidden="true"
            />
            <span class="legend-value">{`${formatNumber(stop.value)}${unit}`}</span>
          </li>
        ))}
        <li class="legend-stop">
          <span class="legend-swatch legend-neutral" aria-hidden="true" />
          <span class="legend-value">no measurement</span>
        </li>
      </ul>
      <p class="legend-basis">{`Basis: ${humanise(overlay.basis)}. Node colour and size both encode the value; a component with no measurement is grey and smallest, which is not the same as a value of zero.`}</p>
      {overlay.caveat === null ? null : <p class="legend-caveat">{`Caveat: ${overlay.caveat}`}</p>}
    </div>
  );
}
