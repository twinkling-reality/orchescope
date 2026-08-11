/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Finding } from '@orchescope/schema';
import { groupFindingsByReadiness } from '../src/presentation/finding-groups.ts';
import { finding } from './fixture.ts';

const eligible = (id: string, severity: Finding['severity'] = 'medium') =>
  finding({
    id,
    severity,
    goalReadiness: {
      eligible: true,
      reason: 'ready',
      requiresRuntimeEvidence: false,
      requiresHumanReview: false,
    },
  });

const blocked = (id: string, severity: Finding['severity'] = 'critical') =>
  finding({
    id,
    severity,
    goalReadiness: {
      eligible: false,
      reason: 'needs human review',
      requiresRuntimeEvidence: false,
      requiresHumanReview: true,
    },
  });

describe('groupFindingsByReadiness', () => {
  it('returns nothing at all for an empty list', () => {
    assert.deepEqual(groupFindingsByReadiness([]), []);
  });

  it('puts what can be handed off ahead of what cannot', () => {
    const groups = groupFindingsByReadiness([blocked('OSC-A'), eligible('OSC-B')]);
    assert.deepEqual(
      groups.map((group) => group.id),
      ['goal_ready', 'needs_review'],
    );
    assert.deepEqual(
      groups.map((group) => group.findings.map((entry) => entry.id)),
      [['OSC-B'], ['OSC-A']],
    );
  });

  it('omits a group nothing falls into rather than drawing an empty heading', () => {
    const onlyReady = groupFindingsByReadiness([eligible('OSC-A'), eligible('OSC-B')]);
    assert.deepEqual(
      onlyReady.map((group) => group.id),
      ['goal_ready'],
    );
    const onlyBlocked = groupFindingsByReadiness([blocked('OSC-A')]);
    assert.deepEqual(
      onlyBlocked.map((group) => group.id),
      ['needs_review'],
    );
  });

  it('keeps the action order inside a group, so severity still ranks within it', () => {
    const groups = groupFindingsByReadiness([
      eligible('OSC-LOW', 'low'),
      eligible('OSC-HIGH', 'high'),
      eligible('OSC-MED', 'medium'),
    ]);
    assert.deepEqual(
      groups[0]?.findings.map((entry) => entry.id),
      ['OSC-HIGH', 'OSC-MED', 'OSC-LOW'],
    );
  });

  it('does not reorder across the boundary, so a critical blocked finding stays second', () => {
    const groups = groupFindingsByReadiness([
      blocked('OSC-CRIT', 'critical'),
      eligible('OSC-INFO', 'info'),
    ]);
    assert.equal(groups[0]?.findings[0]?.id, 'OSC-INFO');
    assert.equal(groups[1]?.findings[0]?.id, 'OSC-CRIT');
  });

  it('says why each group is on its side of the line', () => {
    const groups = groupFindingsByReadiness([eligible('OSC-A'), blocked('OSC-B')]);
    assert.match(groups[0]?.reason ?? '', /the command that decides whether it worked/);
    assert.match(groups[1]?.reason ?? '', /a task nothing could check/);
  });

  it('loses no finding to the split', () => {
    const input = [eligible('OSC-A'), blocked('OSC-B'), eligible('OSC-C'), blocked('OSC-D')];
    const total = groupFindingsByReadiness(input).reduce(
      (count, group) => count + group.findings.length,
      0,
    );
    assert.equal(total, input.length);
  });
});
