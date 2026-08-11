import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visibleWidth } from '../src/terminal/display-width.ts';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { findingRegion } from '../src/terminal/finding-rows.ts';
import { finding } from './audit-fixture.ts';

/**
 * The one region that answers what was found.
 *
 * Two things are load bearing. Every row carries the number of evidence records behind it, because a
 * finding title is itself a numeric claim and a metric without a sample size is not reported. And a
 * repository where nothing fired says so in a sentence rather than by leaving a gap, because an empty
 * list reads as a clean bill of health and this product is not a certification.
 */

const risks = (count: number, over: Parameters<typeof finding>[0] = {}) =>
  Array.from({ length: count }, (_value, index) =>
    finding({ id: `OSC-REL-${String(index).padStart(4, '0')}`, ...over }),
  );

const render = (input: Parameters<typeof findingRegion>[0], columns = 80): readonly string[] => {
  const layout = layoutFor(columns);
  return findingRegion(input).map((row) => renderRow(row, layout));
};

describe('the heading sentence', () => {
  it('states the mix when more than one severity fired', () => {
    const mixed = [
      ...risks(3, { severity: 'high' }),
      ...risks(6, { severity: 'medium' }),
      ...risks(10, { severity: 'low' }),
    ];
    assert.equal(
      render({ risks: mixed, strengths: risks(2), verbose: false })[0],
      'findings        19 risks: 3 high, 6 medium, 10 low; 2 strengths',
    );
  });

  it('says so plainly when every risk is the same severity', () => {
    assert.equal(
      render({ risks: risks(4), strengths: risks(1), verbose: false })[0],
      'findings        4 risks, all medium; 1 strength',
    );
    assert.equal(
      render({ risks: risks(1), strengths: [], verbose: false })[0],
      'findings        1 risk, medium; no strengths',
    );
  });

  it('states the strength count exactly once', () => {
    const rendered = render({ risks: risks(19), strengths: risks(2), verbose: false });
    assert.equal(rendered.filter((line) => line.includes('2 strengths')).length, 1);
  });
});

describe('a repository where nothing fired', () => {
  /*
   * An audit that reports nothing means the rules that had enough evidence to fire did not fire. Left
   * unsaid, a reader takes it for a clean bill of health.
   */
  it('states the caveat at column one and never leaves the region empty', () => {
    const rendered = render({ risks: [], strengths: [], verbose: false });
    assert.deepEqual(rendered, [
      'findings        no risks, no strengths',
      'nothing was reported as a problem, which is not the same as nothing being wrong',
    ]);
  });

  it('fits the caveat whole at eighty columns, and never shortens it', () => {
    for (const columns of [60, 80, 120]) {
      const caveat = render({ risks: [], strengths: [], verbose: false }, columns)[1] ?? '';
      assert.equal(caveat.endsWith('nothing being wrong'), true, `${columns}: ${caveat}`);
    }
  });
});

describe('the rows', () => {
  it('lists six and then names the remainder in one line', () => {
    const rendered = render({ risks: risks(19), strengths: risks(2), verbose: false });
    assert.equal(rendered.filter((line) => line.startsWith('OSC-')).length, 6);
    assert.equal(rendered.at(-1), 'findings        13 more risks, in the report');
  });

  it('lists everything and names no remainder when the list is complete', () => {
    const rendered = render({ risks: risks(4), strengths: [], verbose: false });
    assert.equal(rendered.length, 5);
    assert.equal(
      rendered.some((line) => line.includes('more risks')),
      false,
    );
  });

  /*
   * A finding that cannot become an automated goal is a finding that needs a person, and hiding those
   * from the person is the exact inversion of what the flag is for.
   */
  it('lists a finding no automated goal can be bounded from', () => {
    const rendered = render({
      risks: [
        finding({
          id: 'OSC-ARCH-0001',
          goalReadiness: {
            eligible: false,
            reason: 'this needs a person',
            requiresRuntimeEvidence: false,
            requiresHumanReview: true,
          },
        }),
      ],
      strengths: [],
      verbose: false,
    });
    assert.ok(rendered.some((line) => line.startsWith('OSC-ARCH-0001')));
  });

  it('carries the sample size and its class on every row, right aligned to one anchor', () => {
    const rendered = render({
      risks: [
        finding({ id: 'OSC-RES-0003', evidence: ['a'], basis: 'simulated', severity: 'high' }),
        finding({
          id: 'OSC-REL-0002',
          evidence: Array(11).fill('e'),
          basis: 'observed',
          severity: 'high',
        }),
      ],
      strengths: [],
      verbose: false,
    });
    const rows = rendered.filter((line) => line.startsWith('OSC-'));
    assert.ok(rows[0]?.endsWith(' 1 simulated'));
    assert.ok(rows[1]?.endsWith('11 observed'));
    for (const row of rows) assert.equal(visibleWidth(row), 80);
  });

  it('cuts the title and never the field beside it', () => {
    const long = finding({ title: 'x'.repeat(139), evidence: Array(20).fill('e') });
    const row = render({ risks: [long], strengths: [], verbose: false })[1] ?? '';
    assert.equal(visibleWidth(row), 80);
    assert.ok(row.endsWith('20 discovered'));
    assert.match(row, /x+…/);
  });
});

describe('what verbose adds', () => {
  it('lists strengths only when asked, and never among the risks otherwise', () => {
    const quiet = render({
      risks: risks(1),
      strengths: [finding({ id: 'OSC-STR-0001', polarity: 'strength' })],
      verbose: false,
    });
    assert.equal(
      quiet.some((line) => line.startsWith('OSC-STR-0001')),
      false,
    );

    const loud = render({
      risks: risks(1),
      strengths: [finding({ id: 'OSC-STR-0001', polarity: 'strength' })],
      verbose: true,
    });
    assert.ok(loud.some((line) => line.includes('+ strength')));
  });

  it('brings back the two fields a row cannot carry', () => {
    const loud = render({ risks: [finding({ confidence: 0.75 })], strengths: [], verbose: true });
    assert.ok(loud.some((line) => line.trim() === 'reliability, confidence 0.75'));
  });
});
