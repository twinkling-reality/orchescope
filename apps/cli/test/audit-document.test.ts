import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { auditDocument } from '../src/terminal/audit-document.ts';
import { visibleWidth } from '../src/terminal/display-width.ts';
import { layoutFor } from '../src/terminal/document-grid.ts';
import { createStyle } from '../src/terminal/style.ts';
import { adapter, auditResult, coverage, finding, reconciliation } from './audit-fixture.ts';

/**
 * The whole document, composed.
 *
 * The golden comparison is against a repository built here rather than against a cached bundle, so a
 * failure names a layout decision rather than a corpus that moved. What the corpus is for is the runs
 * in the report, and those are the ones that prove the numbers; this proves the arrangement.
 */

const style = createStyle('plain');

const render = (result: Parameters<typeof auditDocument>[0]['result'], columns?: number): string =>
  auditDocument({
    result,
    layout: layoutFor(columns),
    style,
    verbose: false,
    written: [],
  });

const detected = auditResult({
  reconciliation: reconciliation({}),
  findings: [
    finding({ id: 'OSC-REL-0001', severity: 'high', evidence: ['a', 'b'] }),
    finding({ id: 'OSC-SEC-0001', basis: 'inferred', evidence: ['a'] }),
  ],
});

const undetected = auditResult({
  projectName: 'express',
  componentCount: 5,
  edgeCount: 3,
  agentSystemDetected: false,
  coverage: coverage({
    filesDiscovered: 141,
    filesInSupportedLanguages: 141,
    filesParsed: 141,
    adapters: [
      adapter('adapter:effects', 'completed'),
      adapter('adapter:prompts', 'completed'),
      adapter('adapter:mcp', 'not_applicable'),
    ],
  }),
});

describe('a repository with a system, a run and two problems', () => {
  it('composes one document, in one order, at eighty columns', () => {
    assert.equal(
      render(detected),
      [
        'demo            33 components, 32 relations, 23 of 23 files read',
        '',
        '1 audit         + done       no check had anything to look at',
        '2 goal          . not yet    nothing handed off yet',
        '3 rerun         . not yet    no scenario to repeat',
        '4 measure       . not yet    nothing has been run',
        '5 did it help   . not yet    needs a before and an after',
        '',
        'join            15 of 22 parts a run could reach',
        'join            7 declared components never exercised',
        'join            1 exercised component never declared',
        'join            0 contradicted declarations',
        'join            1 duplicated external effect',
        '',
        'findings        2 risks: 1 high, 1 medium; no strengths',
        'OSC-REL-0001    ! high       a model is called with no timeout de…  2 discovered',
        'OSC-SEC-0001    ! medium     a model is called with no timeout de…    1 inferred',
        '',
        'run             orchescope goal create OSC-REL-0001',
        "run             orchescope trace -- '<the command that starts your system>'",
      ].join('\n'),
    );
  });

  /*
   * Width changes what is cut and never where anything sits. Every key and every state word is on the
   * same column at both widths and only the right edge moves, which is the property a frame cannot
   * have because a frame's own edge is a function of its contents.
   */
  it('keeps every anchor and every line count when the terminal is wider', () => {
    const narrow = render(detected).split('\n');
    const wide = render(detected, 120).split('\n');
    assert.equal(wide.length, narrow.length);
    for (const [index, line] of wide.entries()) {
      assert.equal(line.slice(0, 29), narrow[index]?.slice(0, 29));
    }
    assert.ok(wide.some((line) => line.includes('a model is called with no timeout declared ')));
  });
});

describe('a repository where nothing was detected', () => {
  it('still draws the loop, states the refusal, and names the file to write in', () => {
    assert.equal(
      render(undetected),
      [
        'express         5 components, 3 relations, 141 of 141 files read',
        'No agent system was detected: nothing declared an agent, a tool or a model call.',
        'adapters        2 ran (effects, prompts), 1 found nothing to read',
        '',
        '1 audit         + done       no check had anything to look at',
        '2 goal          . not yet    nothing handed off yet',
        '3 rerun         . not yet    no scenario to repeat',
        '4 measure       . not yet    nothing is declared for a run to be joined against',
        '5 did it help   . not yet    needs a before and an after',
        '',
        'findings        no risks, no strengths',
        'nothing was reported as a problem, which is not the same as nothing being wrong',
        '',
        'run             orchescope init --manifest',
        'next            declare your components in .orchescope/manifest.yaml',
      ].join('\n'),
    );
  });
});

describe('what is true of every document', () => {
  const documents = [detected, undetected].flatMap((result) =>
    [60, 80, 100, 120].map((columns) => render(result, columns)),
  );

  it('holds every line to the effective width, except a row that must not be cut', () => {
    for (const document of documents) {
      const effective = Math.max(...document.split('\n').map((line) => visibleWidth(line)));
      assert.ok(effective <= 120, `${effective}`);
    }
    for (const columns of [60, 80, 100, 120]) {
      for (const line of render(detected, columns).split('\n')) {
        if (line.startsWith('run ') || line.startsWith('next ')) continue;
        assert.ok(visibleWidth(line) <= Math.max(60, columns), `${columns}: ${line}`);
      }
    }
  });

  it('never opens or closes on a blank line, and never puts two together', () => {
    for (const document of documents) {
      const lines = document.split('\n');
      assert.notEqual(lines[0], '');
      assert.notEqual(lines.at(-1), '');
      for (const [index, line] of lines.entries()) {
        if (line === '') assert.notEqual(lines[index + 1], '');
      }
    }
  });

  it('leaves no line ending in whitespace, so a diff reports what changed', () => {
    for (const document of documents) {
      for (const line of document.split('\n')) assert.equal(/\s$/.test(line), false);
    }
  });

  it('records what this invocation wrote, in the document that caused it', () => {
    const written = auditDocument({
      result: detected,
      layout: layoutFor(80),
      style,
      verbose: false,
      written: ['report.json', 'report.html'],
    });
    assert.match(written, /\nwrote {11}report\.json\nwrote {11}report\.html\n/);
  });
});
