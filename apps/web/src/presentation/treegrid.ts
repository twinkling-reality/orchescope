/**
 * Keyboard model for the accessible mirror of the system map.
 *
 * A WebGL canvas exposes nothing to assistive technology, so the same components are also rendered as
 * a WAI-ARIA treegrid: group rows per component kind, component rows beneath them, one row in the tab
 * order at a time. All of the state transitions live here as pure functions so that the keyboard
 * contract is tested without a browser.
 */

export interface TreeGridItem {
  readonly id: string;
  readonly groupKey: string;
  readonly groupLabel: string;
  readonly label: string;
}

export interface TreeGridGroup {
  readonly key: string;
  readonly label: string;
  readonly componentIds: readonly string[];
}

export interface TreeGridGroupRow {
  readonly type: 'group';
  readonly id: string;
  readonly groupKey: string;
  readonly level: 1;
  readonly childCount: number;
}

export interface TreeGridComponentRow {
  readonly type: 'component';
  readonly id: string;
  readonly groupKey: string;
  readonly componentId: string;
  readonly level: 2;
}

export type TreeGridRow = TreeGridGroupRow | TreeGridComponentRow;

export interface TreeGridState {
  /** Group keys that are expanded. */
  readonly expanded: readonly string[];
  readonly focusRowId: string | null;
}

export interface TreeGridKeyResult {
  readonly state: TreeGridState;
  /** Component identifier the user asked to select, when the key was an activation. */
  readonly activate: string | null;
  /** False when the key is not part of the treegrid contract and the browser should keep it. */
  readonly handled: boolean;
}

export function groupRowId(groupKey: string): string {
  return `group:${groupKey}`;
}

export function componentRowId(groupKey: string, componentId: string): string {
  return `component:${groupKey}:${componentId}`;
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Groups are ordered by label and members by label, so the mirror order never depends on input order. */
export function buildGroups(items: readonly TreeGridItem[]): readonly TreeGridGroup[] {
  const byKey = new Map<string, { label: string; members: TreeGridItem[] }>();
  for (const item of items) {
    const existing = byKey.get(item.groupKey);
    if (existing === undefined) {
      byKey.set(item.groupKey, { label: item.groupLabel, members: [item] });
    } else {
      existing.members.push(item);
    }
  }
  const groups: TreeGridGroup[] = [];
  for (const [key, value] of byKey) {
    const members = [...value.members].sort(
      (left, right) => compareStrings(left.label, right.label) || compareStrings(left.id, right.id),
    );
    groups.push({ key, label: value.label, componentIds: members.map((member) => member.id) });
  }
  groups.sort((left, right) => compareStrings(left.label, right.label));
  return groups;
}

export function visibleRows(
  groups: readonly TreeGridGroup[],
  expanded: readonly string[],
): readonly TreeGridRow[] {
  const open = new Set(expanded);
  const rows: TreeGridRow[] = [];
  for (const group of groups) {
    rows.push({
      type: 'group',
      id: groupRowId(group.key),
      groupKey: group.key,
      level: 1,
      childCount: group.componentIds.length,
    });
    if (!open.has(group.key)) {
      continue;
    }
    for (const componentId of group.componentIds) {
      rows.push({
        type: 'component',
        id: componentRowId(group.key, componentId),
        groupKey: group.key,
        componentId,
        level: 2,
      });
    }
  }
  return rows;
}

export function initialState(groups: readonly TreeGridGroup[]): TreeGridState {
  const expanded = groups.map((group) => group.key);
  const rows = visibleRows(groups, expanded);
  return { expanded, focusRowId: rows[0]?.id ?? null };
}

export function focusIndex(rows: readonly TreeGridRow[], focusRowId: string | null): number {
  if (focusRowId === null) {
    return -1;
  }
  return rows.findIndex((row) => row.id === focusRowId);
}

function focusAt(state: TreeGridState, rows: readonly TreeGridRow[], index: number): TreeGridState {
  const row = rows[index];
  if (row === undefined) {
    return state;
  }
  return { expanded: state.expanded, focusRowId: row.id };
}

function withExpanded(state: TreeGridState, expanded: readonly string[]): TreeGridState {
  return { expanded, focusRowId: state.focusRowId };
}

function expandGroup(state: TreeGridState, groupKey: string): TreeGridState {
  if (state.expanded.includes(groupKey)) {
    return state;
  }
  return withExpanded(state, [...state.expanded, groupKey]);
}

function collapseGroup(state: TreeGridState, groupKey: string): TreeGridState {
  if (!state.expanded.includes(groupKey)) {
    return state;
  }
  return withExpanded(
    state,
    state.expanded.filter((key) => key !== groupKey),
  );
}

interface KeyContext {
  readonly groups: readonly TreeGridGroup[];
  readonly state: TreeGridState;
  readonly rows: readonly TreeGridRow[];
  readonly index: number;
}

function done(state: TreeGridState, activate: string | null = null): TreeGridKeyResult {
  return { state, activate, handled: true };
}

function moveBy(context: KeyContext, delta: number): TreeGridKeyResult {
  const { rows, index, state } = context;
  if (rows.length === 0) {
    return done(state);
  }
  if (index === -1) {
    return done(focusAt(state, rows, delta > 0 ? 0 : rows.length - 1));
  }
  const next = Math.min(rows.length - 1, Math.max(0, index + delta));
  return done(focusAt(state, rows, next));
}

function expandOrDescend(context: KeyContext): TreeGridKeyResult {
  const { state, rows, index, groups } = context;
  const row = rows[index];
  if (row === undefined || row.type !== 'group') {
    return done(state);
  }
  if (!state.expanded.includes(row.groupKey)) {
    return done(expandGroup(state, row.groupKey));
  }
  const group = groups.find((candidate) => candidate.key === row.groupKey);
  const firstChild = group?.componentIds[0];
  if (firstChild === undefined) {
    return done(state);
  }
  return done({ expanded: state.expanded, focusRowId: componentRowId(row.groupKey, firstChild) });
}

function collapseOrAscend(context: KeyContext): TreeGridKeyResult {
  const { state, rows, index } = context;
  const row = rows[index];
  if (row === undefined) {
    return done(state);
  }
  if (row.type === 'component') {
    return done({ expanded: state.expanded, focusRowId: groupRowId(row.groupKey) });
  }
  return done(collapseGroup(state, row.groupKey));
}

function activate(context: KeyContext): TreeGridKeyResult {
  const { state, rows, index } = context;
  const row = rows[index];
  if (row === undefined) {
    return done(state);
  }
  if (row.type === 'component') {
    return done(state, row.componentId);
  }
  const toggled = state.expanded.includes(row.groupKey)
    ? collapseGroup(state, row.groupKey)
    : expandGroup(state, row.groupKey);
  return done(toggled);
}

function expandAll(context: KeyContext): TreeGridKeyResult {
  const { state, groups } = context;
  return done(
    withExpanded(
      state,
      groups.map((group) => group.key),
    ),
  );
}

const HANDLERS: Readonly<Record<string, (context: KeyContext) => TreeGridKeyResult>> = {
  ArrowDown: (context) => moveBy(context, 1),
  ArrowUp: (context) => moveBy(context, -1),
  ArrowRight: expandOrDescend,
  ArrowLeft: collapseOrAscend,
  Home: (context) => done(focusAt(context.state, context.rows, 0)),
  End: (context) => done(focusAt(context.state, context.rows, context.rows.length - 1)),
  Enter: activate,
  ' ': activate,
  '*': expandAll,
};

export function treeGridKey(
  groups: readonly TreeGridGroup[],
  state: TreeGridState,
  key: string,
): TreeGridKeyResult {
  const handler = Object.hasOwn(HANDLERS, key) ? HANDLERS[key] : undefined;
  if (handler === undefined) {
    return { state, activate: null, handled: false };
  }
  const rows = visibleRows(groups, state.expanded);
  return handler({ groups, state, rows, index: focusIndex(rows, state.focusRowId) });
}

/** Mouse and pointer toggling, keeping focus on a row that is still visible afterwards. */
export function toggleGroup(
  groups: readonly TreeGridGroup[],
  state: TreeGridState,
  groupKey: string,
): TreeGridState {
  const next = state.expanded.includes(groupKey)
    ? collapseGroup(state, groupKey)
    : expandGroup(state, groupKey);
  const rows = visibleRows(groups, next.expanded);
  if (focusIndex(rows, next.focusRowId) === -1) {
    return { expanded: next.expanded, focusRowId: groupRowId(groupKey) };
  }
  return next;
}

/** Brings a component chosen elsewhere, for example on the canvas, into view in the mirror. */
export function revealComponent(
  groups: readonly TreeGridGroup[],
  state: TreeGridState,
  componentId: string,
): TreeGridState {
  const group = groups.find((candidate) => candidate.componentIds.includes(componentId));
  if (group === undefined) {
    return state;
  }
  const expanded = state.expanded.includes(group.key)
    ? state.expanded
    : [...state.expanded, group.key];
  return { expanded, focusRowId: componentRowId(group.key, componentId) };
}
