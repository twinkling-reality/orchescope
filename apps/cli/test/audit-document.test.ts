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
 * The default glance answers four questions and no others: what was audited, what is wrong, what is
 * still missing, and the one command that gets it. Verbose restores the spine. Goldens are against
 * fixtures, not the corpus.
 */

const style = createStyle('plain');

const render = (
  result: Parameters<typeof auditDocument>[0]['result'],
  columns?: number,
  verbose = false,
): string =>
  auditDocument({
    result,
    layout: layoutFor(columns),
    style,
    verbose,
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
  componentKinds: {},
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

describe('the glance', () => {
  it('says what was audited, what is wrong, what is missing, and what to run', () => {
    assert.equal(
      render(detected),
      [
        'demo            this project has 5 agents, 7 tools and 2 models',
        '                read from 23 of 23 files, with 1 run on record',
        '',
        'problems        1 serious, 1 medium, worst first',
        'serious         a model is called with no timeout declared',
        'medium          a model is called with no timeout declared',
        '',
        'missing         a problem picked to work on, with a check that proves it fixed',
        'run             orchescope goal create OSC-REL-0001',
      ].join('\n'),
    );
  });

  it('hides system deltas, the five step loop, and engine severity tokens', () => {
    const document = render(detected);
    assert.equal(document.includes('\nsystem'), false);
    assert.equal(document.includes('1 audit'), false);
    assert.equal(document.includes('parts in the code'), false);
    assert.equal(/HIGH|MEDIUM/.test(document), false);
  });

  it('names the missing half of the loop directly above the command that gets it', () => {
    const lines = render(detected).split('\n');
    const missing = lines.findIndex((line) => line.startsWith('missing '));
    assert.ok(missing > 0);
    assert.ok(lines[missing + 1]?.startsWith('run '));
  });

  it('still refuses an undetected repository with one next command', () => {
    assert.equal(
      render(undetected),
      [
        'express         this project has 5 parts',
        '                read from 141 of 141 files, with no runs on record',
        'No agent system was detected: nothing looked like an agent, tool, or model.',
        '',
        'problems        no problems found',
        'nothing was reported as a problem, which is not the same as nothing being wrong',
        '',
        'missing         a description of this project that this build can read',
        'run             orchescope init --manifest',
      ].join('\n'),
    );
  });
});

describe('verbose', () => {
  it('restores the loop, plain system rows, and the identifiers', () => {
    const document = render(detected, 80, true);
    assert.match(document, /1 audit/);
    assert.match(document, /parts in the code showed up in a run/);
    assert.match(document, /OSC-REL-0001/);
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

  it('keeps the supporting line under the sentence it supports, at every width', () => {
    for (const columns of [60, 80, 120]) {
      const lines = render(detected, columns).split('\n');
      const headline = lines[0] ?? '';
      const support = lines[1] ?? '';
      const valueColumn = headline.length - headline.replace(/^demo\s+/, '').length;
      assert.equal(support.length - support.trimStart().length, valueColumn, `${columns}`);
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
