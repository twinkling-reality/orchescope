/**
 * The accessible mirror of the system map.
 *
 * A WebGL canvas exposes nothing to assistive technology, so the same components are always present as
 * a real DOM treegrid: never a toggle, never hidden, and never a summary of the canvas. Components are
 * grouped by kind, one row holds the tab stop, and the arrow keys, Home, End and Enter follow the
 * WAI-ARIA authoring practices for the pattern.
 *
 * The markup is a real table, so rows, row headers and column headers carry their native semantics and
 * only the composite role itself has to be declared.
 */

import type { Component } from '@orchescope/schema';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { describeBasis } from '../basis.ts';
import { formatConfidence, formatDuration, formatInteger, humanise, UNKNOWN } from '../format.ts';
import type { GraphIndex } from '../graph-index.ts';
import { useApp } from '../store.tsx';
import {
  buildGroups,
  focusIndex,
  initialState,
  revealComponent,
  type TreeGridGroup,
  type TreeGridRow,
  type TreeGridState,
  toggleGroup,
  treeGridKey,
  visibleRows,
} from '../treegrid.ts';
import { computeWindow, scrollToRow, shouldVirtualise } from '../window.ts';

const ROW_HEIGHT = 28;
const VIEWPORT_HEIGHT = 420;

const COLUMNS = [
  'Component',
  'Kind',
  'Presence',
  'Evidence class',
  'Confidence',
  'Executions',
  'Findings',
] as const;

interface RowCells {
  readonly name: string;
  readonly kind: string;
  readonly presence: string;
  readonly basis: string;
  readonly confidence: string;
  readonly executions: string;
  readonly findings: string;
  readonly note: string | null;
}

function presenceOf(component: Component): string {
  const parts: string[] = [];
  if (component.presence.static) {
    parts.push('source');
  }
  if (component.presence.manifest) {
    parts.push('manifest');
  }
  if (component.presence.runtime) {
    parts.push('runtime');
  }
  return parts.length === 0 ? 'not recorded' : parts.join(' + ');
}

function missingComponentCells(componentId: string, findingCount: number): RowCells {
  return {
    name: componentId,
    kind: 'unknown',
    presence: 'not recorded',
    basis: 'unknown',
    confidence: UNKNOWN,
    executions: UNKNOWN,
    findings: formatInteger(findingCount),
    note: 'referenced but absent from the graph',
  };
}

function componentCells(index: GraphIndex, componentId: string): RowCells {
  const findings = index.findingsByComponent.get(componentId) ?? [];
  const component = index.componentsById.get(componentId);
  if (component === undefined) {
    return missingComponentCells(componentId, findings.length);
  }
  const metrics = index.metricsByComponent.get(componentId);
  const notes: string[] = [];
  if (index.runtimeOnly.has(componentId)) {
    notes.push('runtime only');
  }
  if (index.neverExercised.has(componentId)) {
    notes.push('never exercised');
  }
  return {
    name: component.displayName,
    kind: humanise(component.kind),
    presence: presenceOf(component),
    basis: describeBasis(component.basis).label,
    confidence: formatConfidence(component.confidence),
    executions:
      metrics === undefined
        ? 'not measured'
        : `${formatInteger(metrics.executionCount)} (${formatDuration(metrics.selfDurationMs)} self)`,
    findings: formatInteger(findings.length),
    note: notes.length === 0 ? null : notes.join(', '),
  };
}

function groupCells(index: GraphIndex, group: TreeGridGroup): RowCells {
  let executions = 0;
  let findings = 0;
  let measured = false;
  for (const componentId of group.componentIds) {
    const metrics = index.metricsByComponent.get(componentId);
    if (metrics !== undefined) {
      executions += metrics.executionCount;
      measured = true;
    }
    findings += (index.findingsByComponent.get(componentId) ?? []).length;
  }
  return {
    name: group.label,
    kind: `${formatInteger(group.componentIds.length)} components`,
    presence: '',
    basis: '',
    confidence: '',
    executions: measured ? formatInteger(executions) : 'not measured',
    findings: formatInteger(findings),
    note: null,
  };
}

function TailCells(props: { readonly cells: RowCells }) {
  const { cells } = props;
  const rest = [
    cells.kind,
    cells.presence,
    cells.basis,
    cells.confidence,
    cells.executions,
    cells.findings,
  ];
  return (
    <>
      {rest.map((value, offset) => (
        <td class="tg-cell" aria-colindex={offset + 2} key={offset}>
          {value}
        </td>
      ))}
    </>
  );
}

function GroupRow(props: {
  readonly row: TreeGridRow & { readonly type: 'group' };
  readonly rowIndex: number;
  readonly cells: RowCells;
  readonly focused: boolean;
  readonly expanded: boolean;
  readonly onActivate: () => void;
}) {
  return (
    <tr
      class="tg-row tg-level-1"
      aria-rowindex={props.rowIndex}
      aria-level={1}
      aria-expanded={props.expanded}
      tabIndex={props.focused ? 0 : -1}
      data-row-id={props.row.id}
      onClick={props.onActivate}
    >
      <th class="tg-cell tg-name" scope="row" aria-colindex={1}>
        <span class="tg-twisty" aria-hidden="true">
          {props.expanded ? '▾' : '▸'}
        </span>
        {props.cells.name}
      </th>
      <TailCells cells={props.cells} />
    </tr>
  );
}

function ComponentRowView(props: {
  readonly row: TreeGridRow & { readonly type: 'component' };
  readonly rowIndex: number;
  readonly cells: RowCells;
  readonly focused: boolean;
  readonly selected: boolean;
  readonly onActivate: () => void;
}) {
  return (
    <tr
      class={props.selected ? 'tg-row tg-level-2 selected' : 'tg-row tg-level-2'}
      aria-rowindex={props.rowIndex}
      aria-level={2}
      aria-selected={props.selected}
      tabIndex={props.focused ? 0 : -1}
      data-row-id={props.row.id}
      onClick={props.onActivate}
    >
      <th class="tg-cell tg-name" scope="row" aria-colindex={1}>
        <span class="tg-indent" aria-hidden="true" />
        <span class="tg-label">{props.cells.name}</span>
        {props.cells.note === null ? null : <span class="tg-note">{props.cells.note}</span>}
      </th>
      <TailCells cells={props.cells} />
    </tr>
  );
}

function Spacer(props: { readonly height: number }) {
  if (props.height <= 0) {
    return null;
  }
  const style: JSX.CSSProperties = { '--spacer-height': `${props.height}px` };
  return (
    <tr class="tg-spacer" style={style}>
      <td colSpan={COLUMNS.length} aria-hidden="true" />
    </tr>
  );
}

function useGroups(components: readonly Component[]): readonly TreeGridGroup[] {
  return useMemo(
    () =>
      buildGroups(
        components.map((component) => ({
          id: component.id,
          groupKey: component.kind,
          groupLabel: humanise(component.kind),
          label: component.displayName,
        })),
      ),
    [components],
  );
}

export function TreeGridView(props: {
  readonly components: readonly Component[];
  readonly index: GraphIndex;
}) {
  const app = useApp();
  const groups = useGroups(props.components);

  const [state, setState] = useState<TreeGridState>(() => initialState(groups));
  const [scrollTop, setScrollTop] = useState(0);
  const gridRef = useRef<HTMLTableElement | null>(null);
  const wantFocus = useRef(false);
  const selected = app.state.selected;

  useEffect(() => {
    setState((current) => {
      const rows = visibleRows(groups, current.expanded);
      if (rows.length === 0) {
        return { expanded: groups.map((group) => group.key), focusRowId: null };
      }
      if (focusIndex(rows, current.focusRowId) !== -1) {
        return current;
      }
      return { expanded: current.expanded, focusRowId: rows[0]?.id ?? null };
    });
  }, [groups]);

  useEffect(() => {
    if (selected === null) {
      return;
    }
    setState((current) => revealComponent(groups, current, selected));
  }, [groups, selected]);

  const rows = visibleRows(groups, state.expanded);
  const focused = focusIndex(rows, state.focusRowId);
  const virtualised = shouldVirtualise(rows.length);
  const range = virtualised
    ? computeWindow(rows.length, ROW_HEIGHT, VIEWPORT_HEIGHT, scrollTop)
    : { start: 0, end: rows.length, padTop: 0, padBottom: 0 };

  useEffect(() => {
    if (!wantFocus.current) {
      return;
    }
    wantFocus.current = false;
    const grid = gridRef.current;
    if (grid === null || state.focusRowId === null) {
      return;
    }
    grid.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(state.focusRowId)}"]`)?.focus();
  });

  useEffect(() => {
    if (!virtualised || focused === -1) {
      return;
    }
    setScrollTop((current) => scrollToRow(focused, ROW_HEIGHT, VIEWPORT_HEIGHT, current));
  }, [focused, virtualised]);

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLTableElement>) => {
    const result = treeGridKey(groups, state, event.key);
    if (!result.handled) {
      return;
    }
    event.preventDefault();
    wantFocus.current = true;
    setState(result.state);
    if (result.activate !== null) {
      app.selectComponent(result.activate);
    }
  };

  const activate = (row: TreeGridRow) => () => {
    wantFocus.current = true;
    if (row.type === 'group') {
      setState(toggleGroup(groups, state, row.groupKey));
      return;
    }
    setState({ expanded: state.expanded, focusRowId: row.id });
    app.selectComponent(row.componentId);
  };

  const renderRow = (row: TreeGridRow, offset: number) => {
    const rowIndex = range.start + offset + 2;
    if (row.type === 'group') {
      const group = groups.find((candidate) => candidate.key === row.groupKey);
      if (group === undefined) {
        return null;
      }
      return (
        <GroupRow
          key={row.id}
          row={row}
          rowIndex={rowIndex}
          cells={groupCells(props.index, group)}
          focused={row.id === state.focusRowId}
          expanded={state.expanded.includes(row.groupKey)}
          onActivate={activate(row)}
        />
      );
    }
    return (
      <ComponentRowView
        key={row.id}
        row={row}
        rowIndex={rowIndex}
        cells={componentCells(props.index, row.componentId)}
        focused={row.id === state.focusRowId}
        selected={row.componentId === selected}
        onActivate={activate(row)}
      />
    );
  };

  const style: JSX.CSSProperties = {
    '--viewport-height': `${VIEWPORT_HEIGHT}px`,
    '--tg-row-height': `${ROW_HEIGHT}px`,
  };

  return (
    <div class="treegrid-wrap">
      <p class="muted" id="treegrid-help">
        Every component on the canvas is also a row here. Use the up and down arrows to move between
        rows, the right and left arrows to open and close a kind, Enter to select, and Home or End
        to jump to the ends.
      </p>
      <div
        class={virtualised ? 'treegrid-scroll virtual-viewport' : 'treegrid-scroll'}
        style={style}
        onScroll={
          virtualised
            ? (event) => {
                setScrollTop((event.currentTarget as HTMLElement).scrollTop);
              }
            : undefined
        }
      >
        <table
          class="tg-table"
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the WAI-ARIA treegrid pattern is a composite widget with no plain HTML equivalent. A real table is used so that rows, row headers and column headers keep their native semantics and only the composite role has to be declared.
          role="treegrid"
          aria-label="Components grouped by kind"
          aria-describedby="treegrid-help"
          aria-rowcount={rows.length + 1}
          aria-colcount={COLUMNS.length}
          ref={gridRef}
          onKeyDown={onKeyDown}
        >
          <thead>
            <tr class="tg-row tg-head" aria-rowindex={1}>
              {COLUMNS.map((label, offset) => (
                <th class="tg-cell" scope="col" aria-colindex={offset + 1} key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Spacer height={range.padTop} />
            {rows.slice(range.start, range.end).map(renderRow)}
            <Spacer height={range.padBottom} />
          </tbody>
        </table>
      </div>
      {virtualised ? (
        <p class="muted virtual-note">
          {`Showing rows ${formatInteger(range.start + 1)} to ${formatInteger(range.end)} of ${formatInteger(rows.length)}. Move with the arrow keys or scroll for the rest.`}
        </p>
      ) : null}
      {rows.length === 0 ? <p class="muted">No component matches the current filters.</p> : null}
    </div>
  );
}
