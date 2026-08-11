import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { severityUnitMeter, unitMeter } from '../src/terminal/unit-meter.ts';

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

describe('severityUnitMeter', () => {
  it('draws one letter per risk, grouped by severity', () => {
    assert.equal(
      severityUnitMeter({ critical: 0, high: 3, medium: 2, low: 1, info: 0 }),
      '|HHHMML| 6',
    );
  });

  it('stays absent when there are no risks or too many to draw one cell each', () => {
    assert.equal(
      severityUnitMeter({ critical: 0, high: 0, medium: 0, low: 0, info: 0 }),
      undefined,
    );
    assert.equal(
      severityUnitMeter({ critical: 0, high: 41, medium: 0, low: 0, info: 0 }),
      undefined,
    );
  });
});
