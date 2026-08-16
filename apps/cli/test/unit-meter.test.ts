import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unitMeter } from '../src/terminal/unit-meter.ts';

/**
 * Unit meters are the fraction drawn. They refuse to render when there is no total, or when drawing
 * one cell per unit would invent a scaled picture to fit the line.
 */

describe('unitMeter', () => {
  it('draws one cell per unit of the known total', () => {
    assert.equal(unitMeter(14, 21), '[##############.......] 14/21');
  });

  it('stays absent when the total is zero or too wide to draw honestly', () => {
    assert.equal(unitMeter(0, 0), undefined);
    assert.equal(unitMeter(3, 100), undefined);
  });

  it('never claims more filled cells than the total', () => {
    assert.equal(unitMeter(30, 21), '[#####################] 21/21');
  });
});
