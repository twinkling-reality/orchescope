import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { sourceRegion } from '../src/terminal/source-headline.ts';
import { adapter, auditResult, coverage } from './audit-fixture.ts';

/**
 * Line one, and the two lines that only appear when nothing was found.
 *
 * The two extra lines are a refusal rather than a decoration. A repository where no agent system was
 * detected has to be told what was looked for and which readers found nothing, or an unsupported
 * ecosystem and an empty one look identical.
 */

const plain = (text: string): string => text;

const lines = (result: Parameters<typeof sourceRegion>[0], columns: number): readonly string[] => {
  const layout = layoutFor(columns);
  return sourceRegion(result, layout, plain).map((row) => renderRow(row, layout));
};

describe('the count tail', () => {
  it('states components, edges and the files read when there is room', () => {
    assert.deepEqual(lines(auditResult({}), 80), [
      'demo            33 components, 32 edges, 23 of 23 files read',
    ]);
  });

  /*
   * `edge` is shorter than the old inventory noun `relation`, so the full demo line now fits the
   * sixty column floor. A fatter edge count is what forces the files-read clause off first.
   */
  it('sheds the files-read clause before it drops a count', () => {
    assert.deepEqual(lines(auditResult({ edgeCount: 3200 }), 60), [
      'demo            33 components, 3200 edges',
    ]);
  });

  it('sheds again, keeping the count that identifies the repository', () => {
    const wide = auditResult({ projectName: 'a-very-long-repository-name-here-now' });
    assert.deepEqual(lines(wide, 60), ['a-very-long-repository-name-here-now  33 components']);
  });

  /*
   * The name is the identity of the document and it overhangs, but it overhangs to a ceiling.
   *
   * A project name is the directory the audit ran in or a string a configuration file set, and this
   * repository treats both as untrusted, so a key that never cuts is a line whose width the audited
   * repository chooses. Half the effective width leaves the value the other half whatever the name
   * does, and the longest name in the pinned corpus is twenty seven columns, so nothing measured is cut.
   */
  it('cuts a project name that would otherwise choose the width of the line', () => {
    const absurd = auditResult({ projectName: 'a'.repeat(200) });
    const rendered = lines(absurd, 80);
    for (const line of rendered) assert.ok([...line].length <= 80, line);
    assert.match(rendered[0] ?? '', /^a+…/);
  });

  /*
   * The ceiling is derived from what the key is a key to, so the count cannot fall off the line.
   *
   * A name is cut at the point that still leaves the shortest count its columns, which means the count
   * survives at every width and for every name. A measurement that disappeared without saying it was
   * unavailable is the one thing this document may never do.
   */
  it('keeps the count beside a name long enough to have crowded it out', () => {
    for (const columns of [60, 80, 120]) {
      const rendered = lines(auditResult({ projectName: 'b'.repeat(200) }), columns);
      assert.equal(rendered.length, 1);
      assert.match(rendered[0] ?? '', /33 components$/);
      assert.equal([...(rendered[0] ?? '')].length, columns);
    }
  });

  /*
   * A repository that mapped nothing still states the denominator. Silence about a zero reads as a
   * scan that was not run, and the whole point of this line is that a scan happened.
   */
  it('states the denominator on a repository where nothing was mapped', () => {
    const empty = auditResult({
      projectName: 'orchescope-discovery',
      componentCount: 0,
      edgeCount: 0,
      agentSystemDetected: false,
    });
    assert.equal(
      lines(empty, 80)[0],
      'orchescope-discovery  0 components, 0 edges, 23 of 23 files read',
    );
  });

  it('pushes a project name longer than the key column right rather than cutting it', () => {
    const named = auditResult({ projectName: 'vercel-ai-chatbot-exercised' });
    assert.ok(lines(named, 80)[0]?.startsWith('vercel-ai-chatbot-exercised  33 components'));
  });
});

describe('the refusal', () => {
  const undetected = (columns: number) =>
    lines(
      auditResult({
        agentSystemDetected: false,
        coverage: coverage({
          adapters: [
            adapter('adapter:effects', 'completed'),
            adapter('adapter:prompts', 'completed'),
            adapter('adapter:mcp', 'not_applicable'),
            adapter('adapter:langgraph', 'not_applicable'),
          ],
        }),
      }),
      columns,
    );

  it('renders, and is never replaced by a blank line', () => {
    const rendered = undetected(80);
    assert.equal(rendered.length, 3);
    assert.equal(
      rendered[1],
      'No agent system was detected: nothing declared an agent, a tool or a model call.',
    );
  });

  it('opens with the same sentence at every width, and shortens the rest', () => {
    for (const columns of [60, 80, 120]) {
      const caveat = undetected(columns)[1] ?? '';
      assert.ok(caveat.startsWith('No agent system was detected'), caveat);
      assert.ok(caveat.length <= Math.max(60, Math.min(120, columns)), caveat);
    }
  });

  it('names the adapters that ran when there is room for their names', () => {
    assert.equal(
      undetected(80)[2],
      'adapters        2 ran (effects, prompts), 2 found nothing to read',
    );
  });

  /*
   * A strip sheds whole items and never truncates one, because half an adapter name matches no
   * adapter. The two counts are the claim and the names are only the evidence for it, so the counts
   * are what survives when nothing else does.
   */
  it('sheds whole names and never half of one, and never sheds a count', () => {
    for (let columns = 60; columns <= 120; columns += 1) {
      const line = undetected(columns)[2] ?? '';
      assert.ok(line.length <= columns, `${columns}: ${line}`);
      assert.match(line, /2 ran/);
      assert.match(line, /2 found nothing to read/);
      const named = /\(([^)]*)\)/.exec(line)?.[1];
      if (named === undefined) continue;
      for (const name of named.replace(/ and \d+ more$/, '').split(', ')) {
        assert.ok(['effects', 'prompts'].includes(name), `${columns}: half a name, ${name}`);
      }
    }
    assert.equal(undetected(60)[2], 'adapters        2 ran, 2 found nothing to read');
  });

  it('says nothing about adapters when the scan recorded none, rather than saying zero', () => {
    const bare = lines(auditResult({ agentSystemDetected: false }), 80);
    assert.equal(bare.length, 2);
  });
});
