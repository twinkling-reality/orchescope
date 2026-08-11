/**
 * The WebGL system map.
 *
 * The canvas is a second rendering of data that is already present in the treegrid beside it, so it is
 * hidden from assistive technology rather than described badly. The zoom controls are real buttons
 * outside the canvas and stay in the tab order. When WebGL is unavailable the canvas says so and the
 * report keeps working, because the accessible mirror is the primary representation, not the fallback.
 *
 * Nodes are drawn with a border program rather than as plain discs, so the rule that holds everywhere
 * else in this workspace holds here too: a component a run reached is filled, and one that was only
 * ever declared is a ring. A filled disc and an empty ring are the same shape at the same size, so the
 * difference is evidence and not emphasis, and it survives a monochrome screen.
 *
 * With an overlay on, the fill carries the magnitude instead. That is consistent rather than an
 * exception: a component with an overlay value was measured, which is what the fill has meant all
 * along, and one with no value keeps its ring.
 */

import type { Component, Edge } from '@orchescope/schema';
import { createNodeBorderProgram } from '@sigma/node-border';
import { MultiDirectedGraph } from 'graphology';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Sigma from 'sigma';
import { formatInteger, formatNumber, humanise } from '../presentation/format.ts';
import type { GraphIndex } from '../presentation/graph-index.ts';
import { type MapLayoutKind, type Point, positionsFor } from '../presentation/layout.ts';
import {
  clearNames,
  type DrawnName,
  namesAllFit,
  namesFit,
  type NameRoom,
  nameRoom,
  zoomForNames,
} from '../presentation/map-names.ts';
import {
  DEFAULT_RAMP,
  type OverlayScale,
  overlayLegend,
  paintComponent,
  type Ramp,
} from '../presentation/overlay.ts';
import { drawHoverLabel } from './hover-label.ts';
import { Eyebrow, Meta } from './primitives.tsx';

type NodeAttrs = {
  x: number;
  y: number;
  size: number;
  color: string;
  borderColor: string;
  label: string;
};

type EdgeAttrs = {
  size: number;
  color: string;
  kind: string;
};

/**
 * Canvas colours read from the same custom properties as the rest of the page.
 *
 * The canvas is drawn on a WebGL surface, so it inherits nothing from the stylesheet. Reading the
 * resolved values keeps the map legible in both themes instead of painting dark labels on a dark
 * background, and it is what makes the overlay ramp end at the theme's own ink.
 */
interface CanvasPalette {
  readonly ink: string;
  readonly outline: string;
  readonly sheet: string;
  /** `--rule`, the hairline this page separates one surface from another with. */
  readonly hairline: string;
  /** What a relation is drawn in, which is not the hairline. See the fallback below for why. */
  readonly relation: string;
  readonly ramp: Ramp;
}

const FALLBACK_PALETTE: CanvasPalette = {
  ink: '#12151c',
  outline: '#aeb5c1',
  sheet: '#ffffff',
  hairline: '#e3e6ec',
  // Relations are drawn in the outline grey rather than the layout hairline: a canvas gives an edge no
  // adjacent block to be read against, so the hairline that works between two panels disappears here.
  relation: '#aeb5c1',
  ramp: DEFAULT_RAMP,
};

function readPalette(element: HTMLElement): CanvasPalette {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  };
  const ink = read('--ink', FALLBACK_PALETTE.ink);
  const outline = read('--outline', FALLBACK_PALETTE.outline);
  return {
    ink,
    outline,
    sheet: read('--sheet', FALLBACK_PALETTE.sheet),
    hairline: read('--rule', FALLBACK_PALETTE.hairline),
    relation: read('--outline', FALLBACK_PALETTE.relation),
    ramp: { from: outline, to: ink },
  };
}

const BASE_EDGE_SIZE = 1;
const BASE_NODE_SIZE = 6;
const SELECTED_SIZE_BOOST = 5;

/** Share of the drawing's own spread left as margin, so an outermost label is not cut in half. */
const LABEL_MARGIN_SHARE = 0.06;

/**
 * The width of one label, which is the width Sigma's collision grid has to reserve.
 *
 * 11px JetBrains Mono advances 0.6em, so 6.6px a character. This was 120, from an estimate of 18
 * characters a name; counted over the 2994 positioned components in the pinned corpus the mean is 22.7,
 * which is 159 pixels, and the ninetieth percentile is 56 characters. A grid cell narrower than a name is
 * not a collision check: it lets two names in adjacent cells overlap, which is the thing the grid is the
 * only remaining guard against once a drawing is past naming everything.
 */
const LABEL_CELL_PX = 159;

/** The border is a share of the radius, so a ring reads the same at every zoom level. */
const NodeBorderProgram = createNodeBorderProgram<NodeAttrs, EdgeAttrs>({
  borders: [
    { color: { attribute: 'borderColor' }, size: { value: 0.18 } },
    { color: { attribute: 'color' }, size: { fill: true } },
  ],
});

interface BuiltGraph {
  readonly graph: MultiDirectedGraph<NodeAttrs, EdgeAttrs>;
  /** Edges whose endpoints are not on the map. Reported rather than dropped quietly. */
  readonly danglingEdges: readonly string[];
}

/**
 * Only components the layout positioned are drawn, which is only components a relation touches.
 *
 * A component with no relation is not part of any topology. Drawing it anyway put 1091 anonymous
 * circles on the map of `openai-agents-python` that nothing connected to, which reads as a system and
 * is not one. They are counted and named by kind beside the map instead.
 */
function buildGraph(index: GraphIndex, positions: ReadonlyMap<string, Point>): BuiltGraph {
  const graph = new MultiDirectedGraph<NodeAttrs, EdgeAttrs>();
  for (const [id, component] of index.componentsById) {
    const point = positions.get(id);
    if (point === undefined) {
      continue;
    }
    graph.addNode(id, {
      x: point.x,
      y: point.y,
      size: BASE_NODE_SIZE,
      color: FALLBACK_PALETTE.ink,
      borderColor: FALLBACK_PALETTE.ink,
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
      color: FALLBACK_PALETTE.relation,
      kind: edge.kind,
    });
  }
  return { graph, danglingEdges: dangling };
}

/**
 * Frames what is on screen rather than the whole graph. Sigma fits its camera to the bounding box it is
 * given, so restricting that box to the visible nodes is what makes the control mean what its label says
 * when a filter is on. A node with no stored position is not on the map and cannot bound it.
 */
function frameVisible(renderer: Sigma<NodeAttrs, EdgeAttrs>): void {
  const xs: number[] = [];
  const ys: number[] = [];
  renderer.getGraph().forEachNode((node, attributes) => {
    if (!renderer.getNodeDisplayData(node)?.hidden) {
      xs.push(attributes.x);
      ys.push(attributes.y);
    }
  });
  if (xs.length === 0 || ys.length === 0) {
    renderer.setCustomBBox(null);
  } else {
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    // The box bounds the nodes, and a label runs to the right of the node it belongs to, so a box drawn
    // tight to the outermost node cuts that node's name in half. The extra room on the right is for the
    // label; the rest is so nothing sits against an edge of the canvas.
    const spread = Math.max(right - left, bottom - top, 1);
    renderer.setCustomBBox({
      x: [left - spread * LABEL_MARGIN_SHARE, right + spread * LABEL_MARGIN_SHARE * 3],
      y: [top - spread * LABEL_MARGIN_SHARE, bottom + spread * LABEL_MARGIN_SHARE],
    });
  }
  renderer.refresh({ skipIndexation: true });
  renderer.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
}

interface NodePaint {
  readonly color: string;
  readonly borderColor: string;
  readonly size: number;
}

/**
 * How one node is drawn, decided in one place so the reducer stays a lookup.
 *
 * Three cases, and the third is the one that is easy to get wrong. With an overlay on, a value is the
 * fill and its absence is a ring. With no overlay and at least one run to compare against, whether a
 * run reached the component is the fill. With no run at all nothing is ringed, because ringing every
 * node would state that none of them executes when the truth is that nothing was measured.
 */
function paintNode(state: PaintState, node: string): NodePaint {
  if (state.overlay !== null) {
    const painted = paintComponent(state.overlay, node, state.palette.ramp);
    return painted.value === null
      ? {
          color: state.palette.sheet,
          borderColor: state.palette.outline,
          size: painted.size,
        }
      : { color: painted.color, borderColor: painted.color, size: painted.size };
  }
  const filled = !state.measurable || state.exercised.has(node);
  return {
    color: filled ? state.palette.ink : state.palette.sheet,
    borderColor: filled ? state.palette.ink : state.palette.outline,
    size: BASE_NODE_SIZE,
  };
}

interface PaintState {
  visibleNodes: ReadonlySet<string>;
  visibleEdges: ReadonlySet<string>;
  overlay: OverlayScale | null;
  selected: string | null;
  neighbours: ReadonlySet<string>;
  /** Components at the other end of a relation from the selection, which are named with it. */
  neighbourNodes: ReadonlySet<string>;
  exercised: ReadonlySet<string>;
  /** False once the drawing has no room for a name at the camera's current position. */
  nameable: boolean;
  /** The names that are clear at this scale. Every other node is drawn without one. */
  named: ReadonlySet<string>;
  /** False when the report has no run at all, which is why nothing is drawn as unexercised. */
  measurable: boolean;
  palette: CanvasPalette;
}

/**
 * Whether this component was reached by a run, which decides whether it is filled.
 *
 * A report with no runs in it fills nothing and rings nothing: every node keeps the neutral treatment,
 * because ringing them all would state that none of them executes when the truth is that nothing was
 * measured. The map says so in its own legend rather than in the shape of the nodes.
 */
function exercisedIds(index: GraphIndex): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!index.hasRuntimeEvidence) {
    return ids;
  }
  for (const [id, component] of index.componentsById) {
    if (component.presence.runtime && !index.neverExercised.has(id)) {
      ids.add(id);
    }
  }
  return ids;
}

/** Pixels per layout unit at the camera's current position, asked of the renderer rather than modelled. */
function pixelsPerUnit(renderer: Sigma<NodeAttrs, EdgeAttrs>): number {
  const origin = renderer.graphToViewport({ x: 0, y: 0 });
  const along = renderer.graphToViewport({ x: 1000, y: 0 });
  const scale = Math.abs(along.x - origin.x) / 1000;
  return Number.isFinite(scale) ? scale : 0;
}

interface NamingState {
  readonly some: boolean;
  readonly every: boolean;
  readonly named: ReadonlySet<string>;
  /**
   * Pixels per layout unit with the whole visible drawing framed, which is what the note's magnification
   * is a multiple of. Derived from the live scale and the camera's own ratio rather than captured when
   * the drawing was framed, so it stays right when the window changes size under a settled camera.
   */
  readonly fitted: number;
}

/** What the canvas is doing about names at this scale: none of them, some of them, or all of them. */
function decideNames(
  renderer: Sigma<NodeAttrs, EdgeAttrs>,
  names: readonly DrawnName[],
  room: NameRoom,
): NamingState {
  const scale = pixelsPerUnit(renderer);
  const fitted = scale * renderer.getCamera().getState().ratio;
  const some = namesFit(scale, room);
  const every = namesAllFit(scale, room);
  if (!some) return { some, every, fitted, named: new Set<string>() };
  if (every) return { some, every, fitted, named: new Set(names.map((name) => name.id)) };
  return { some, every, fitted, named: clearNames(names, scale) };
}

const sameNames = (next: NamingState, current: NamingState): boolean => {
  if (next.fitted !== current.fitted) return false;
  if (next.named.size !== current.named.size) return false;
  for (const id of next.named) if (!current.named.has(id)) return false;
  return true;
};

export function GraphCanvas(props: {
  readonly index: GraphIndex;
  readonly visibleComponents: readonly Component[];
  readonly visibleEdges: readonly Edge[];
  readonly overlay: OverlayScale | null;
  readonly layout: MapLayoutKind;
  readonly selected: string | null;
  readonly onSelect: (componentId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [palette, setPalette] = useState<CanvasPalette>(FALLBACK_PALETTE);
  const positions = useMemo(
    () => positionsFor(props.index.layout, props.layout),
    [props.index, props.layout],
  );
  // Built once per report. Switching layout moves the nodes it already holds rather than making another
  // one, because tearing a WebGL context down and back up to change two numbers per node is not a
  // rebuild a reader should have to wait for.
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const built = useMemo(() => buildGraph(props.index, positionsRef.current), [props.index]);
  // What the canvas actually draws, which is the filtered components minus the ones with no relation.
  // Reporting the filtered total here would have the hint claim 33 while 26 were on screen.
  const drawn = useMemo(
    () => props.visibleComponents.filter((component) => positions.has(component.id)),
    [props.visibleComponents, positions],
  );
  const drawnCount = drawn.length;
  /**
   * The room the drawing has for its names, which is a property of the coordinates and the names and not
   * of the count. Recomputed when the visible set or the layout changes, never per frame.
   */
  const names = useMemo<readonly DrawnName[]>(() => {
    const drawnNames: DrawnName[] = [];
    for (const component of drawn) {
      const point = positions.get(component.id);
      if (point !== undefined) {
        drawnNames.push({
          id: component.id,
          x: point.x,
          y: point.y,
          chars: component.displayName.length,
          weight: props.index.degreeByComponent.get(component.id) ?? 0,
        });
      }
    }
    return drawnNames;
  }, [drawn, positions, props.index]);
  const room = useMemo<NameRoom>(() => nameRoom(names), [names]);
  /**
   * What the canvas is doing about names, which the camera moves and the camera is outside the render.
   * Set only when it changes rather than on every frame, so panning and zooming do not re-render the
   * section under the canvas.
   */
  const [naming, setNaming] = useState<{
    some: boolean;
    every: boolean;
    named: ReadonlySet<string>;
    fitted: number;
  }>({ some: true, every: true, named: new Set<string>(), fitted: 0 });
  const namingRef = useRef(naming);
  namingRef.current = naming;
  const exercised = useMemo(() => exercisedIds(props.index), [props.index]);

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

  const neighbourNodes = useMemo(() => {
    if (props.selected === null) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    for (const edge of props.index.outgoing.get(props.selected) ?? []) {
      ids.add(edge.to);
    }
    for (const edge of props.index.incoming.get(props.selected) ?? []) {
      ids.add(edge.from);
    }
    return ids;
  }, [props.index, props.selected]);

  const paint = useRef<PaintState>({
    visibleNodes: new Set(),
    visibleEdges: new Set(),
    overlay: null,
    selected: null,
    neighbours: new Set(),
    neighbourNodes: new Set(),
    exercised: new Set(),
    measurable: false,
    nameable: true,
    named: new Set<string>(),
    palette: FALLBACK_PALETTE,
  });
  paint.current = {
    visibleNodes: new Set(props.visibleComponents.map((component) => component.id)),
    visibleEdges: new Set(props.visibleEdges.map((edge) => edge.id)),
    overlay: props.overlay,
    selected: props.selected,
    neighbours,
    neighbourNodes,
    exercised,
    measurable: props.index.hasRuntimeEvidence,
    nameable: naming.some,
    named: naming.named,
    palette,
  };

  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;
  // The camera handler outlives the render that created it, and both move with the filters.
  const roomRef = useRef(room);
  roomRef.current = room;
  const namesRef = useRef(names);
  namesRef.current = names;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return undefined;
    }
    const initial = readPalette(container);
    paint.current = { ...paint.current, palette: initial };
    setPalette(initial);
    let cameraWatcher: ReturnType<Sigma<NodeAttrs, EdgeAttrs>['getCamera']> | null = null;
    let onCameraMove: (() => void) | null = null;
    try {
      rendererRef.current = new Sigma<NodeAttrs, EdgeAttrs>(built.graph, container, {
        allowInvalidContainer: true,
        defaultNodeType: 'bordered',
        nodeProgramClasses: { bordered: NodeBorderProgram },
        defaultEdgeType: 'arrow',
        renderEdgeLabels: false,
        labelFont: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
        labelSize: 11,
        labelWeight: '400',
        // Sigma drops a label when another has already claimed its grid cell, and this is the only thing
        // standing between a dense drawing and a heap of overlapping words. The cell has to be about as
        // wide as a label or two names in adjacent cells still land on each other: a component name in
        // this corpus runs to `create_frame_streaming_completion` and averages 22.7 characters, which is
        // about 159px of 11px mono. A cell of 50px was letting three names share the width of one.
        //
        // A drawing whose names are all clear at this scale is named in full instead, by `forceLabel`
        // below, because that is a promise the design makes and the grid does not know about it.
        labelDensity: 1,
        labelGridCellSize: LABEL_CELL_PX,
        labelColor: { color: initial.ink },
        // The plate behind a hovered or a selected node's name. Sigma's own draws it in `#FFF` under a
        // `#000` shadow, which is a white box behind near white text in the dark theme, so this one
        // reads the palette instead. It reads it at draw time rather than closing over the value,
        // because the theme can change under a renderer that is already running.
        defaultDrawNodeHover: (context, data, settings) => {
          const { palette: current } = paint.current;
          drawHoverLabel(context, {
            x: data.x,
            y: data.y,
            nodeSize: data.size,
            label: data.label ?? '',
            font: settings.labelFont,
            labelSize: settings.labelSize,
            labelWeight: settings.labelWeight,
            sheet: current.sheet,
            hairline: current.hairline,
            ink: current.ink,
          });
        },
        zIndex: true,
        minCameraRatio: 0.05,
        maxCameraRatio: 12,
        // The reducer result is the data the renderer draws with, so the stored coordinate has to be
        // carried through. Returning only the attributes that change would leave the node unplaced.
        nodeReducer: (node, data) => {
          const state = paint.current;
          if (!state.visibleNodes.has(node)) {
            return { ...data, hidden: true };
          }
          const isSelected = state.selected === node;
          const painted = paintNode(state, node);
          return {
            ...data,
            hidden: false,
            color: painted.color,
            borderColor: painted.borderColor,
            size: painted.size + (isSelected ? SELECTED_SIZE_BOOST : 0),
            zIndex: isSelected ? 2 : 1,
            highlighted: isSelected,
            // Which names are drawn is worked out from the drawing rather than left to the renderer's
            // collision grid, so every one that is drawn is forced past that grid. What the reader
            // selected and what it touches are named whether or not they had room, which is how a name
            // is got back where there is none.
            forceLabel: isSelected || state.neighbourNodes.has(node) || state.named.has(node),
            label:
              (state.nameable && state.named.has(node)) ||
              isSelected ||
              state.neighbourNodes.has(node)
                ? data.label
                : '',
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
            color: incident ? state.palette.ink : state.palette.relation,
            size: incident ? BASE_EDGE_SIZE * 2 : BASE_EDGE_SIZE,
            zIndex: incident ? 2 : 0,
          };
        },
      });
      rendererRef.current.on('clickNode', ({ node }) => {
        onSelectRef.current(node);
      });
      // Names are decided against the camera, so the decision has to be remade when the camera moves. The
      // renderer is only refreshed when the answer changes, which is once per crossing rather than once
      // per frame of a drag.
      cameraWatcher = rendererRef.current.getCamera();
      onCameraMove = () => {
        const renderer = rendererRef.current;
        if (renderer === null) return;
        const next = decideNames(renderer, namesRef.current, roomRef.current);
        // Panning does not move the scale, so the set does not change and the renderer is left alone.
        // Only a zoom that actually adds or removes a name costs a pass over the reducers.
        if (sameNames(next, namingRef.current)) return;
        namingRef.current = next;
        paint.current = { ...paint.current, nameable: next.some, named: next.named };
        setNaming(next);
        try {
          renderer.refresh({ skipIndexation: true });
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error));
        }
      };
      cameraWatcher.on('updated', onCameraMove);
      // Fit once, on mount. A camera left at its default ratio shows a corner of anything larger than the
      // viewport, and every graph in the corpus is larger than the viewport. It is not refitted afterwards,
      // because that would undo a reader's own pan and zoom every time a filter changed.
      frameVisible(rendererRef.current);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }

    // The theme is switched by an attribute on the root element, which the canvas cannot see any other way.
    const themeWatcher = new MutationObserver(() => {
      try {
        const next = readPalette(container);
        paint.current = { ...paint.current, palette: next };
        setPalette(next);
        rendererRef.current?.setSetting('labelColor', { color: next.ink });
        rendererRef.current?.refresh({ skipIndexation: true });
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
      if (cameraWatcher !== null && onCameraMove !== null) {
        cameraWatcher.removeListener('updated', onCameraMove);
      }
      rendererRef.current?.kill();
      rendererRef.current = null;
    };
  }, [built]);

  /**
   * Switching layout moves the nodes the renderer already holds and frames them again.
   *
   * Reframing is right here and wrong on a filter change: a reader who has zoomed into one corner of a
   * ring has not asked to be taken anywhere by narrowing a search, but they have asked for a different
   * drawing, and a different drawing at the old camera is a view of empty space.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    try {
      const graph = renderer.getGraph();
      graph.forEachNode((node) => {
        const point = positions.get(node);
        if (point !== undefined) graph.mergeNodeAttributes(node, { x: point.x, y: point.y });
      });
      frameVisible(renderer);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, [positions]);

  /**
   * A renderer that fails part way through must not take the page with it: the accessible mirror below
   * the canvas is the primary representation of this data, so every call into it is contained.
   */
  useEffect(() => {
    try {
      rendererRef.current?.refresh({ skipIndexation: true });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, [props.visibleComponents, props.visibleEdges, props.overlay, props.selected, neighbours]);

  /**
   * The naming decision, remade whenever anything it depends on moves.
   *
   * A filter changes what is drawn. A layout changes where it is drawn. And the canvas itself changes
   * size when a window is dragged, which moves the scale without moving the camera and so without any
   * event of the camera's to hear. The renderer says when it has taken a new size, which is the moment
   * after its own dimensions are right rather than the moment the window changed.
   */
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer === null) return undefined;
    const decide = () => {
      try {
        const next = decideNames(renderer, names, room);
        if (sameNames(next, namingRef.current)) return;
        namingRef.current = next;
        paint.current = { ...paint.current, nameable: next.some, named: next.named };
        setNaming(next);
        renderer.refresh({ skipIndexation: true });
      } catch (error) {
        setFailure(error instanceof Error ? error.message : String(error));
      }
    };
    decide();
    renderer.on('resize', decide);
    return () => {
      renderer.removeListener('resize', decide);
    };
  }, [names, room]);

  const camera = () => rendererRef.current?.getCamera() ?? null;
  const zoom = (factor: number) => {
    const current = camera();
    if (current === null) {
      return;
    }
    const state = current.getState();
    current.setState({ ratio: Math.min(12, Math.max(0.05, state.ratio * factor)) });
  };
  const fit = () => {
    const renderer = rendererRef.current;
    if (renderer !== null) {
      frameVisible(renderer);
    }
  };
  const magnification = zoomForNames(naming.fitted, room);

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
          title="Frame every part the current filters leave visible"
        >
          Zoom to fit
        </button>
        <p class="canvas-hint">
          {`Drag to pan, scroll to zoom, click something to select it. ${formatInteger(drawnCount)} parts and ${formatInteger(props.visibleEdges.length)} of ${formatInteger(props.index.edgesById.size)} connections drawn.`}
        </p>
      </div>
      {failure === null ? null : (
        <div class="refusal" role="note">
          <p class="t">The canvas could not start.</p>
          <p>{`${failure}. Everything it would show is in the table beside it, which is the representation this report treats as primary.`}</p>
        </div>
      )}
      <div class="canvas" ref={containerRef} aria-hidden="true" role="presentation" />
      {/* The key and the note about which names survived sit under the drawing rather than over it.
          Above it they were a four line paragraph and a legend between the reader and the thing they
          opened this screen for, which put the graph itself past the fold on a laptop. */}
      <div class="canvas-footnotes">
        {props.overlay === null ? (
          <ul class="key">
            {props.index.hasRuntimeEvidence ? (
              <>
                <li>
                  <i class="meter-cell is-exercised" />
                  Exercised
                </li>
                <li>
                  <i class="meter-cell is-declared_only" />
                  Declared, never exercised
                </li>
              </>
            ) : (
              <li>
                <i class="meter-cell is-unmeasured" />
                No run has been ingested, so nothing here is drawn as unexercised
              </li>
            )}
          </ul>
        ) : (
          <OverlayLegend overlay={props.overlay} ramp={palette.ramp} />
        )}
        <NamingNote
          drawnCount={drawnCount}
          namedCount={naming.named.size}
          some={naming.some}
          every={naming.every}
          magnification={magnification}
        />
      </div>
      {built.danglingEdges.length === 0 ? null : (
        <p class="note">
          {`${formatInteger(built.danglingEdges.length)} connections point at a part this report does not carry, so they are not drawn.`}
        </p>
      )}
    </div>
  );
}

/**
 * Which of the three readings of the names the canvas is giving, said rather than left to be guessed.
 *
 * Silence means every drawn component is named. The middle state is the one that used to be silent and
 * wrong: names are drawn where there is room for one and the rest are left out, which is what the
 * renderer's collision grid has always done under a ceiling that promised otherwise. The last state is
 * the shape of the system with no index to it.
 */
function NamingNote(props: {
  readonly drawnCount: number;
  readonly namedCount: number;
  readonly some: boolean;
  readonly every: boolean;
  readonly magnification: number | null;
}) {
  if (props.every || props.drawnCount === 0) {
    return null;
  }
  const closer =
    props.magnification === null || props.magnification <= 1
      ? ''
      : ` Zoom to about ${formatNumber(props.magnification, 1)} times the fitted view and the rest arrive as the room for them does.`;
  if (props.some) {
    return (
      <p class="note">
        {`There is room at this size for ${formatInteger(props.namedCount)} of these ${formatInteger(props.drawnCount)} names, so the busiest keep theirs and the rest are left out rather than printed over each other.${closer} Pick one to name it and everything it touches.`}
      </p>
    );
  }
  return (
    <p class="note">
      {`There is not room to name ${formatInteger(props.drawnCount)} parts at this size, so this is the shape of the system rather than a list of it.${closer} Pick one to name it and everything it touches, or narrow by kind above.`}
    </p>
  );
}

function OverlayLegend(props: { readonly overlay: OverlayScale; readonly ramp: Ramp }) {
  const { overlay } = props;
  const unit = overlay.unit === null ? '' : ` ${overlay.unit}`;
  const stops = overlayLegend(overlay, 5, props.ramp);
  return (
    <div class="legend">
      <Eyebrow level={4}>
        {`${overlay.label}${overlay.unit === null ? '' : ` (${overlay.unit})`}`}
      </Eyebrow>
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
      <Meta>
        <span>{humanise(overlay.basis)}</span>
        <span>tone and radius both carry the value</span>
        <span>an outlined node was not measured, which is not a value of zero</span>
      </Meta>
      {overlay.caveat === null ? null : <p class="note">{`Caveat: ${overlay.caveat}`}</p>}
    </div>
  );
}
