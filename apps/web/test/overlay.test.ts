/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildOverlayScale,
  MIN_NODE_SIZE,
  NEUTRAL_COLOR,
  normaliseValue,
  overlayColor,
  overlayLegend,
  overlayNodeSize,
  paintComponent,
} from '../src/overlay.ts';
import { overlay } from './fixture.ts';

describe('buildOverlayScale', () => {
  it('records the range and the values it was given', () => {
    const scale = buildOverlayScale(
      overlay({
        unit: 'ms',
        caveat: 'estimated from token counts',
        values: [
          { componentId: 'agent:a', value: 10 },
          { componentId: 'agent:b', value: 40 },
        ],
      }),
    );
    assert.equal(scale.min, 10);
    assert.equal(scale.max, 40);
    assert.equal(scale.unit, 'ms');
    assert.equal(scale.caveat, 'estimated from token counts');
    assert.equal(scale.values.get('agent:b'), 40);
  });

  it('collapses an empty overlay to a zero range rather than to infinities', () => {
    const scale = buildOverlayScale(overlay({ values: [] }));
    assert.equal(scale.min, 0);
    assert.equal(scale.max, 0);
    assert.equal(scale.values.size, 0);
  });

  it('drops non finite values instead of poisoning the range', () => {
    const scale = buildOverlayScale(
      overlay({
        values: [
          { componentId: 'a', value: Number.NaN },
          { componentId: 'b', value: 5 },
        ],
      }),
    );
    assert.equal(scale.values.has('a'), false);
    assert.equal(scale.min, 5);
    assert.equal(scale.max, 5);
  });

  it('reports a missing unit and caveat as absent rather than as an empty string', () => {
    const scale = buildOverlayScale(overlay());
    assert.equal(scale.unit, null);
    assert.equal(scale.caveat, null);
  });
});

describe('normaliseValue', () => {
  it('maps a value onto the unit interval', () => {
    assert.equal(normaliseValue(0, 0, 10), 0);
    assert.equal(normaliseValue(5, 0, 10), 0.5);
    assert.equal(normaliseValue(10, 0, 10), 1);
  });

  it('clamps values outside the range', () => {
    assert.equal(normaliseValue(-5, 0, 10), 0);
    assert.equal(normaliseValue(50, 0, 10), 1);
  });

  it('returns the midpoint when the range has no spread, so identical values look identical', () => {
    assert.equal(normaliseValue(7, 7, 7), 0.5);
    assert.equal(normaliseValue(7, 10, 5), 0.5);
  });

  it('returns the midpoint for non finite input', () => {
    assert.equal(normaliseValue(Number.NaN, 0, 1), 0.5);
    assert.equal(normaliseValue(1, Number.NaN, 1), 0.5);
  });
});

describe('overlayColor', () => {
  it('produces a six digit hex colour across the whole interval', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      assert.match(overlayColor(t), /^#[0-9a-f]{6}$/);
    }
  });

  it('clamps out of range input to the ends of the ramp', () => {
    assert.equal(overlayColor(-1), overlayColor(0));
    assert.equal(overlayColor(2), overlayColor(1));
  });

  it('moves monotonically away from the low end', () => {
    assert.notEqual(overlayColor(0), overlayColor(0.5));
    assert.notEqual(overlayColor(0.5), overlayColor(1));
  });

  it('falls back to the neutral colour for non finite input', () => {
    assert.equal(overlayColor(Number.NaN), NEUTRAL_COLOR);
  });
});

describe('overlayNodeSize', () => {
  it('scales between the given bounds', () => {
    assert.equal(overlayNodeSize(0, 4, 12), 4);
    assert.equal(overlayNodeSize(1, 4, 12), 12);
    assert.equal(overlayNodeSize(0.5, 4, 12), 8);
  });

  it('clamps out of range input', () => {
    assert.equal(overlayNodeSize(-3, 4, 12), 4);
    assert.equal(overlayNodeSize(9, 4, 12), 12);
  });
});

describe('overlayLegend', () => {
  it('spans the measured range with the requested number of stops', () => {
    const scale = buildOverlayScale(
      overlay({
        values: [
          { componentId: 'a', value: 100 },
          { componentId: 'b', value: 200 },
        ],
      }),
    );
    const stops = overlayLegend(scale, 3);
    assert.equal(stops.length, 3);
    assert.equal(stops[0]?.value, 100);
    assert.equal(stops[1]?.value, 150);
    assert.equal(stops[2]?.value, 200);
  });

  it('never produces fewer than two stops', () => {
    assert.equal(overlayLegend(buildOverlayScale(overlay()), 1).length, 2);
  });
});

describe('paintComponent', () => {
  it('paints a measured component from the ramp', () => {
    const scale = buildOverlayScale(
      overlay({
        values: [
          { componentId: 'a', value: 1 },
          { componentId: 'b', value: 9 },
        ],
      }),
    );
    const painted = paintComponent(scale, 'b');
    assert.equal(painted.value, 9);
    assert.equal(painted.color, overlayColor(1));
  });

  it('keeps an unmeasured component neutral and smallest, distinct from a value of zero', () => {
    const scale = buildOverlayScale(
      overlay({
        values: [
          { componentId: 'a', value: 0 },
          { componentId: 'b', value: 9 },
        ],
      }),
    );
    const unmeasured = paintComponent(scale, 'missing');
    assert.equal(unmeasured.value, null);
    assert.equal(unmeasured.color, NEUTRAL_COLOR);
    assert.equal(unmeasured.size, MIN_NODE_SIZE);

    const zero = paintComponent(scale, 'a');
    assert.equal(zero.value, 0);
    assert.notEqual(zero.color, NEUTRAL_COLOR);
  });

  it('paints uniformly when no overlay is selected', () => {
    const painted = paintComponent(null, 'anything');
    assert.equal(painted.value, null);
    assert.notEqual(painted.color, NEUTRAL_COLOR);
  });
});
