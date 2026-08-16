import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visibleWidth } from '../src/terminal/display-width.ts';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { findingRegion } from '../src/terminal/finding-rows.ts';
import { createStyle } from '../src/terminal/style.ts';
import { finding } from './audit-fixture.ts';

const risks = (count: number, over: Parameters<typeof finding>[0] = {}) =>
  Array.from({ length: count }, (_value, index) =>
    finding({ id: `OSC-REL-${String(index).padStart(4, '0')}`, ...over }),
  );

const render = (input: Parameters<typeof findingRegion>[0], columns = 80): readonly string[] => {
  const layout = layoutFor(columns);
  return findingRegion(input).map((row) => renderRow(row, layout));
};

const problemRows = (rendered: readonly string[]): readonly string[] =>
  rendered.filter((line) => /^(serious|medium|minor)\s/.test(line));

describe('the glance', () => {
  it('keys every problem by how bad it is, worst first', () => {
    const mixed = [
      ...risks(3, { severity: 'high' }),
      ...risks(6, { severity: 'medium' }),
      ...risks(10, { severity: 'low' }),
    ];
    const rendered = render({ risks: mixed, strengths: risks(2), verbose: false });
    assert.equal(rendered[0], 'problems        3 serious, 6 medium, 10 minor, worst first');
    assert.equal(problemRows(rendered).length, 3);
    assert.ok(problemRows(rendered).every((line) => line.startsWith('serious ')));
    assert.equal(rendered.at(-1), 'more            16 more problems: orchescope audit --verbose');
  });

  it('gives the sentence the columns the state field used to hold', () => {
    const long = 'issue_refund is retried and nothing makes it safe to repeat';
    const rendered = render({
      risks: [finding({ severity: 'high', title: long })],
      strengths: [],
      verbose: false,
    });
    assert.equal(problemRows(rendered)[0], `serious         ${long}`);
  });

  it('keeps identifiers and evidence tails off the glance', () => {
    const rendered = render({
      risks: [
        finding({
          id: 'OSC-RES-0003',
          evidence: ['a'],
          basis: 'simulated',
          severity: 'high',
          title: 'a refund ran twice',
        }),
      ],
      strengths: [],
      verbose: false,
    });
    assert.equal(
      rendered.some((line) => line.includes('OSC-') || line.includes('simulated')),
      false,
    );
    assert.ok(rendered.some((line) => line.includes('a refund ran twice')));
  });

  it('states the caveat when nothing fired', () => {
    const rendered = render({ risks: [], strengths: [], verbose: false });
    assert.deepEqual(rendered, [
      'problems        no problems found',
      'nothing was reported as a problem, which is not the same as nothing being wrong',
    ]);
  });
});

/**
 * A chip is a coloured word, not a coloured column.
 *
 * The grid pads a key after painting it, so the escape sequences close around the visible word and the
 * padding that follows is outside them. The failure this guards against printed an eleven column block
 * of ground with a six character label at one end of it.
 */
describe('the severity chip', () => {
  /* Built from a code point, so the pattern is not itself a control character in source. */
  const escapeChar = String.fromCharCode(0x1b);
  const chipPattern = new RegExp(`${escapeChar}\\[[0-9;]*m(.*?)${escapeChar}\\[0m`);
  const sequencePattern = new RegExp(`${escapeChar}\\[[0-9;]*m`, 'g');

  const painted = (line: string): string => chipPattern.exec(line)?.[1] ?? '';

  it('paints the severity word and nothing beside it', () => {
    const layout = layoutFor(80);
    const rows = findingRegion({
      risks: [
        finding({ severity: 'high', title: 'one' }),
        finding({ severity: 'medium', title: 'two' }),
        finding({ severity: 'low', title: 'three' }),
      ],
      strengths: [],
      verbose: false,
      style: createStyle('color'),
    }).map((row) => renderRow(row, layout));
    assert.deepEqual(rows.slice(1).map(painted), ['serious', 'medium', 'minor']);
  });

  it('leaves every row the same width and the same words it has without colour', () => {
    const input = {
      risks: [finding({ severity: 'high', title: 'one' })],
      strengths: [],
      verbose: false,
    };
    const layout = layoutFor(80);
    const coloured = findingRegion({ ...input, style: createStyle('color') }).map((row) =>
      renderRow(row, layout),
    );
    const plain = findingRegion({ ...input, style: createStyle('plain') }).map((row) =>
      renderRow(row, layout),
    );
    assert.deepEqual(coloured.map(visibleWidth), plain.map(visibleWidth));
    assert.deepEqual(
      coloured.map((line) => line.replaceAll(sequencePattern, '')),
      plain,
    );
  });
});

describe('verbose', () => {
  it('lists six, restores evidence tails, and names the remainder', () => {
    const rendered = render({ risks: risks(19), strengths: [], verbose: true });
    assert.equal(problemRows(rendered).length, 6);
    assert.ok(problemRows(rendered)[0]?.includes('discovered'));
    assert.equal(
      rendered.at(-1),
      'more            13 more problems; full list: orchescope audit --json',
    );
  });

  it('brings back the identifier and the exact severity on a detail line', () => {
    const loud = render({
      risks: [finding({ id: 'OSC-REL-0003', severity: 'critical', confidence: 0.75 })],
      strengths: [],
      verbose: true,
    });
    assert.ok(
      loud.some((line) => line.trim() === 'OSC-REL-0003, critical, reliability, confidence 0.75'),
    );
  });

  it('cuts the title and never the field beside it', () => {
    const long = finding({ title: 'x'.repeat(139), evidence: Array(20).fill('e') });
    const row = problemRows(render({ risks: [long], strengths: [], verbose: true }))[0] ?? '';
    assert.equal(visibleWidth(row), 80);
    assert.ok(row.endsWith('20 discovered'));
    assert.match(row, /x+…/);
  });
});
