/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildGroups,
  componentRowId,
  focusIndex,
  groupRowId,
  initialState,
  revealComponent,
  type TreeGridItem,
  type TreeGridState,
  toggleGroup,
  treeGridKey,
  visibleRows,
} from '../src/treegrid.ts';

const items: readonly TreeGridItem[] = [
  { id: 'tool:refund', groupKey: 'tool', groupLabel: 'Tool', label: 'refund' },
  { id: 'agent:planner', groupKey: 'agent', groupLabel: 'Agent', label: 'planner' },
  { id: 'agent:worker', groupKey: 'agent', groupLabel: 'Agent', label: 'worker' },
  { id: 'tool:audit', groupKey: 'tool', groupLabel: 'Tool', label: 'audit' },
];

const groups = buildGroups(items);

describe('buildGroups', () => {
  it('groups by kind and orders groups and members by label', () => {
    assert.deepEqual(
      groups.map((group) => group.key),
      ['agent', 'tool'],
    );
    assert.deepEqual(groups[0]?.componentIds, ['agent:planner', 'agent:worker']);
    assert.deepEqual(groups[1]?.componentIds, ['tool:audit', 'tool:refund']);
  });

  it('does not depend on input order', () => {
    assert.deepEqual(buildGroups([...items].reverse()), groups);
  });

  it('handles an empty input', () => {
    assert.deepEqual(buildGroups([]), []);
  });
});

describe('visibleRows', () => {
  it('shows only group rows when nothing is expanded', () => {
    const rows = visibleRows(groups, []);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.type === 'group'));
  });

  it('shows children of expanded groups in order', () => {
    const rows = visibleRows(groups, ['agent']);
    assert.deepEqual(
      rows.map((row) => row.id),
      [
        groupRowId('agent'),
        componentRowId('agent', 'agent:planner'),
        componentRowId('agent', 'agent:worker'),
        groupRowId('tool'),
      ],
    );
  });

  it('gives every row its level', () => {
    for (const row of visibleRows(groups, ['agent'])) {
      assert.equal(row.level, row.type === 'group' ? 1 : 2);
    }
  });
});

describe('initialState', () => {
  it('opens every group and focuses the first row', () => {
    const state = initialState(groups);
    assert.deepEqual(state.expanded, ['agent', 'tool']);
    assert.equal(state.focusRowId, groupRowId('agent'));
  });

  it('focuses nothing when there are no groups', () => {
    assert.equal(initialState([]).focusRowId, null);
  });
});

describe('treeGridKey', () => {
  const open: TreeGridState = { expanded: ['agent', 'tool'], focusRowId: groupRowId('agent') };

  it('ignores keys outside its contract so the browser keeps them', () => {
    const result = treeGridKey(groups, open, 'a');
    assert.equal(result.handled, false);
    assert.equal(result.state, open);
  });

  it('moves down and up through visible rows only', () => {
    const down = treeGridKey(groups, open, 'ArrowDown');
    assert.equal(down.state.focusRowId, componentRowId('agent', 'agent:planner'));
    const up = treeGridKey(groups, down.state, 'ArrowUp');
    assert.equal(up.state.focusRowId, groupRowId('agent'));
  });

  it('stops at the ends rather than wrapping', () => {
    const atTop = treeGridKey(groups, open, 'ArrowUp');
    assert.equal(atTop.state.focusRowId, groupRowId('agent'));
    const last = visibleRows(groups, open.expanded).at(-1);
    const atBottom = treeGridKey(groups, { ...open, focusRowId: last?.id ?? null }, 'ArrowDown');
    assert.equal(atBottom.state.focusRowId, last?.id);
  });

  it('collapses a group with the left arrow and expands it with the right', () => {
    const collapsed = treeGridKey(groups, open, 'ArrowLeft');
    assert.deepEqual(collapsed.state.expanded, ['tool']);
    const expanded = treeGridKey(groups, collapsed.state, 'ArrowRight');
    assert.deepEqual([...expanded.state.expanded].sort(), ['agent', 'tool']);
  });

  it('moves into the first child when the right arrow is pressed on an open group', () => {
    const result = treeGridKey(groups, open, 'ArrowRight');
    assert.equal(result.state.focusRowId, componentRowId('agent', 'agent:planner'));
  });

  it('moves from a component row to its group row with the left arrow', () => {
    const onChild: TreeGridState = {
      expanded: ['agent', 'tool'],
      focusRowId: componentRowId('agent', 'agent:worker'),
    };
    assert.equal(treeGridKey(groups, onChild, 'ArrowLeft').state.focusRowId, groupRowId('agent'));
  });

  it('leaves a component row unchanged on the right arrow but still consumes the key', () => {
    const onChild: TreeGridState = {
      expanded: ['agent'],
      focusRowId: componentRowId('agent', 'agent:worker'),
    };
    const result = treeGridKey(groups, onChild, 'ArrowRight');
    assert.equal(result.handled, true);
    assert.equal(result.state.focusRowId, onChild.focusRowId);
    assert.equal(result.activate, null);
  });

  it('jumps to the first and last visible rows with Home and End', () => {
    const rows = visibleRows(groups, open.expanded);
    assert.equal(treeGridKey(groups, open, 'End').state.focusRowId, rows.at(-1)?.id);
    const fromEnd: TreeGridState = { ...open, focusRowId: rows.at(-1)?.id ?? null };
    assert.equal(treeGridKey(groups, fromEnd, 'Home').state.focusRowId, rows[0]?.id);
  });

  it('activates a component row with Enter and with Space', () => {
    const onChild: TreeGridState = {
      expanded: ['agent'],
      focusRowId: componentRowId('agent', 'agent:worker'),
    };
    assert.equal(treeGridKey(groups, onChild, 'Enter').activate, 'agent:worker');
    assert.equal(treeGridKey(groups, onChild, ' ').activate, 'agent:worker');
  });

  it('toggles a group with Enter rather than selecting anything', () => {
    const result = treeGridKey(groups, open, 'Enter');
    assert.equal(result.activate, null);
    assert.deepEqual(result.state.expanded, ['tool']);
  });

  it('opens every group with an asterisk', () => {
    const closed: TreeGridState = { expanded: [], focusRowId: groupRowId('tool') };
    assert.deepEqual(treeGridKey(groups, closed, '*').state.expanded, ['agent', 'tool']);
  });

  it('adopts a focus row when nothing is focused yet', () => {
    const nothing: TreeGridState = { expanded: ['agent', 'tool'], focusRowId: null };
    assert.equal(treeGridKey(groups, nothing, 'ArrowDown').state.focusRowId, groupRowId('agent'));
    assert.equal(
      treeGridKey(groups, nothing, 'ArrowUp').state.focusRowId,
      visibleRows(groups, nothing.expanded).at(-1)?.id,
    );
  });

  it('is a no-op on an empty grid', () => {
    const empty: TreeGridState = { expanded: [], focusRowId: null };
    const result = treeGridKey([], empty, 'ArrowDown');
    assert.equal(result.state.focusRowId, null);
    assert.equal(result.activate, null);
  });
});

describe('toggleGroup', () => {
  it('keeps focus on a row that is still visible', () => {
    const onChild: TreeGridState = {
      expanded: ['agent', 'tool'],
      focusRowId: componentRowId('agent', 'agent:worker'),
    };
    const collapsed = toggleGroup(groups, onChild, 'agent');
    assert.deepEqual(collapsed.expanded, ['tool']);
    assert.equal(collapsed.focusRowId, groupRowId('agent'));
    assert.notEqual(focusIndex(visibleRows(groups, collapsed.expanded), collapsed.focusRowId), -1);
  });

  it('leaves an unaffected focus row alone', () => {
    const state: TreeGridState = { expanded: ['agent', 'tool'], focusRowId: groupRowId('tool') };
    const toggled = toggleGroup(groups, state, 'agent');
    assert.equal(toggled.focusRowId, groupRowId('tool'));
  });
});

describe('revealComponent', () => {
  it('expands the owning group and focuses the component row', () => {
    const closed: TreeGridState = { expanded: [], focusRowId: null };
    const revealed = revealComponent(groups, closed, 'tool:refund');
    assert.deepEqual(revealed.expanded, ['tool']);
    assert.equal(revealed.focusRowId, componentRowId('tool', 'tool:refund'));
  });

  it('leaves the state alone when the component is not in the grid', () => {
    const state: TreeGridState = { expanded: ['agent'], focusRowId: groupRowId('agent') };
    assert.equal(revealComponent(groups, state, 'memory:missing'), state);
  });
});
