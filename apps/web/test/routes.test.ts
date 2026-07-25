/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SECTION, formatHash, parseHash, SECTIONS, sectionLabel } from '../src/routes.ts';

describe('parseHash', () => {
  it('reads every declared section', () => {
    for (const section of SECTIONS) {
      assert.equal(parseHash(`#/${section.id}`).section, section.id);
    }
  });

  it('falls back to the default section for anything it does not know', () => {
    for (const hash of ['', '#', '#/', '#/nope', 'garbage']) {
      assert.equal(parseHash(hash).section, DEFAULT_SECTION);
    }
  });

  it('reads query parameters and decodes them', () => {
    const route = parseHash('#/map?component=tool%3Arefund&overlay=cost');
    assert.equal(route.section, 'map');
    assert.equal(route.params['component'], 'tool:refund');
    assert.equal(route.params['overlay'], 'cost');
  });

  it('accepts a parameter with no value', () => {
    assert.equal(parseHash('#/findings?open').params['open'], '');
  });

  it('keeps a malformed escape as literal text rather than throwing', () => {
    assert.equal(parseHash('#/map?component=%E0%A4%A').params['component'], '%E0%A4%A');
  });

  it('tolerates a missing leading slash', () => {
    assert.equal(parseHash('#goals').section, 'goals');
  });
});

describe('formatHash', () => {
  it('produces a bare section route when there are no parameters', () => {
    assert.equal(formatHash('overview'), '#/overview');
    assert.equal(formatHash('overview', {}), '#/overview');
  });

  it('encodes parameter values', () => {
    assert.equal(formatHash('map', { component: 'tool:refund' }), '#/map?component=tool%3Arefund');
  });

  it('drops empty values so the route stays clean', () => {
    assert.equal(
      formatHash('findings', { severity: '', finding: 'OSC-A-0001' }),
      '#/findings?finding=OSC-A-0001',
    );
  });

  it('round trips through parseHash', () => {
    const route = parseHash(formatHash('map', { component: 'agent:planner~1a2b3c' }));
    assert.equal(route.section, 'map');
    assert.equal(route.params['component'], 'agent:planner~1a2b3c');
  });
});

describe('sectionLabel', () => {
  it('gives every section a label', () => {
    for (const section of SECTIONS) {
      assert.equal(sectionLabel(section.id), section.label);
      assert.ok(section.label.length > 0);
    }
  });
});
