import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { sourceRegion } from '../src/terminal/source-headline.ts';
import { adapter, auditResult, coverage } from './audit-fixture.ts';

const plain = (text: string): string => text;

const lines = (
  result: Parameters<typeof sourceRegion>[0],
  columns: number,
  verbose = false,
): readonly string[] => {
  const layout = layoutFor(columns);
  return sourceRegion(result, layout, plain, verbose).map((row) => renderRow(row, layout));
};

describe('the headline', () => {
  it('describes the project by what is in it, then says what was read', () => {
    assert.deepEqual(lines(auditResult({}), 80), [
      'demo            this project has 5 agents, 7 tools and 2 models',
      '                read from 23 of 23 files, with no runs on record',
    ]);
  });

  it('names only the kinds that are present', () => {
    assert.equal(
      lines(auditResult({ componentKinds: { agent: 3 } }), 80)[0],
      'demo            this project has 3 agents',
    );
    assert.equal(
      lines(auditResult({ componentKinds: { tool: 1, model: 4 } }), 80)[0],
      'demo            this project has 1 tool and 4 models',
    );
  });

  it('falls back to a part count when none of the three kinds were found', () => {
    assert.equal(
      lines(auditResult({ componentKinds: {}, componentCount: 12 }), 80)[0],
      'demo            this project has 12 parts',
    );
  });

  it('counts the runs behind the report, because that is what decides the rest', () => {
    const withRuns = auditResult({
      runs: [{ id: 'run_a' }, { id: 'run_b' }] as unknown as ReturnType<
        typeof auditResult
      >['bundle']['runs'],
    });
    assert.equal(
      lines(withRuns, 80)[1],
      '                read from 23 of 23 files, with 2 runs on record',
    );
  });

  it('sheds the framing words before it drops the counts', () => {
    assert.deepEqual(
      lines(auditResult({ projectName: 'a-very-long-repository-name-here-now' }), 60),
      [
        'a-very-long-repository-name…  5 agents, 7 tools and 2 models',
        '                read from 23 of 23 files',
      ],
    );
  });

  it('cuts a project name that would otherwise choose the width of the line', () => {
    const absurd = auditResult({ projectName: 'a'.repeat(200) });
    const rendered = lines(absurd, 80);
    for (const line of rendered) assert.ok([...line].length <= 80, line);
    assert.match(rendered[0] ?? '', /^a+…/);
  });

  it('keeps the count beside a name long enough to have crowded it out', () => {
    for (const columns of [60, 80, 120]) {
      const rendered = lines(auditResult({ projectName: 'b'.repeat(200) }), columns);
      assert.match(rendered[0] ?? '', /5 agents, 7 tools and 2 models$/);
      assert.equal([...(rendered[0] ?? '')].length, columns);
    }
  });
});

describe('verbose', () => {
  it('adds the graph counts to the line that already carries coverage', () => {
    assert.deepEqual(lines(auditResult({}), 80, true), [
      'demo            this project has 5 agents, 7 tools and 2 models',
      '                33 parts and 32 links; 23 of 23 files read; no runs on record',
    ]);
  });
});

describe('the refusal', () => {
  const empty = auditResult({
    projectName: 'orchescope-discovery',
    componentCount: 0,
    componentKinds: {},
    edgeCount: 0,
    agentSystemDetected: false,
    coverage: coverage({
      adapters: [
        adapter('adapter:effects', 'completed'),
        adapter('adapter:prompts', 'not_applicable'),
      ],
    }),
  });

  it('renders on the glance without the adapter roster', () => {
    const rendered = lines(empty, 80);
    assert.equal(rendered[0], 'orchescope-discovery  this project has 0 parts');
    /*
     * A claim about the repository this reader cannot make. What it can say is that none of its own
     * adapters recognised anything, which is what the row below this one enumerates.
     */
    assert.match(rendered[2] ?? '', /^No agent system was detected: no adapter here recognised/);
    assert.doesNotMatch(rendered[2] ?? '', /nothing looked like/);
    assert.equal(
      rendered.some((line) => line.startsWith('adapters')),
      false,
    );
  });

  it('names the adapters when verbose', () => {
    const rendered = lines(empty, 120, true);
    assert.ok(rendered.some((line) => line.startsWith('adapters')));
  });
});
