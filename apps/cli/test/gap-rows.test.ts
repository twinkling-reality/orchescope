import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { gapRegion } from '../src/terminal/gap-rows.ts';
import { adapter, coverage } from './audit-fixture.ts';

/**
 * What could not be looked at.
 *
 * The measurement this region is easiest to get wrong is the skip count. `filesSkipped` is how many
 * files were skipped and `skipped` is a bounded sample of them, and counting reasons out of the sample
 * and printing them as though they described the whole is an inference presented as an observation.
 */

const skipped = (reason: string, times: number) =>
  Array.from({ length: times }, (_value, index) => ({ file: `f${index}.py`, reason }));

const render = (over: Parameters<typeof coverage>[0], columns = 80): readonly string[] => {
  const layout = layoutFor(columns);
  return gapRegion(coverage(over), layout).map((row) => renderRow(row, layout));
};

describe('when nothing was missed', () => {
  it('renders no region and no blank line', () => {
    assert.deepEqual(render({}), []);
  });
});

/*
 * The word is `path` rather than `file`. A directory traversal declined to enter is one entry standing
 * for everything inside it, and calling two excluded directories two files understates what was lost in
 * the one line a reader has to notice it in.
 */
describe('skipped paths', () => {
  it('groups a complete list by reason and counts each one', () => {
    assert.deepEqual(
      render({
        filesSkipped: 20,
        skipped: [...skipped('too_large', 7), ...skipped('symlink', 13)] as never,
      }),
      [
        'gap             . skipped    13 paths, symlink',
        'gap             . skipped    7 paths, too large',
      ],
    );
  });

  /*
   * On `pydantic-ai-exercised` the total is eighty one and the sample is thirty four. A per reason
   * count taken from the sample and printed beside the total would be an inference wearing the clothes
   * of an observation, so the reasons are named and the sample size travels with them.
   */
  it('states the total, names the reasons from the sample, and counts neither out of the other', () => {
    const line = render({
      filesSkipped: 81,
      skipped: [...skipped('too_large', 21), ...skipped('symlink', 13)] as never,
    })[0];
    assert.equal(line, 'gap             . skipped    81 paths, 34 sampled: too large, symlink');
    assert.equal(/\d+ paths, too large/.test(line ?? ''), false);
  });

  it('falls back to the sample as the total when the scan recorded no total', () => {
    assert.deepEqual(render({ skipped: skipped('binary', 3) as never }), [
      'gap             . skipped    3 paths, binary',
    ]);
  });
});

describe('an area no adapter models', () => {
  it('maps each kind to a symbol and a word, and guesses at none', () => {
    assert.deepEqual(
      render({
        unsupported: [
          { area: 'go source files (1)', kind: 'language_not_analysed', reason: 'x' },
          { area: 'mcp used in source', kind: 'adapter_found_nothing', reason: 'y' },
          { area: 'edge to nowhere', kind: 'discarded_relation', reason: 'z' },
          { area: 'something older', reason: 'w' },
        ] as never,
      }),
      [
        'gap             . unparsed   go source files (1)',
        'gap             . unread     mcp used in source',
        'gap             . discarded  edge to nowhere',
        'gap             . unread     something older',
      ],
    );
  });

  it('shows a bounded source-located topology refusal through the generic gap path', () => {
    assert.deepEqual(
      render({
        unsupported: [
          {
            area: 'topology: 1 unresolved at src/graph.py:14',
            reason: 'The conditional router computes its destination dynamically.',
          },
        ] as never,
      }),
      ['gap             . unread     topology: 1 unresolved at src/graph.py:14'],
    );
  });

  /*
   * `adapter_blind_spot` is the name this build stopped writing, and a report stored by an earlier one
   * still carries it. Accepted for reading and never emitted, so it has to render rather than fall
   * through to the unnamed case, which would tell a reader less than the document holds.
   */
  it('renders the name this build no longer writes', () => {
    assert.deepEqual(
      render({
        unsupported: [
          { area: 'mcp used in source', kind: 'adapter_blind_spot', reason: 'y' },
        ] as never,
      }),
      ['gap             . unread     mcp used in source'],
    );
  });

  /*
   * The reason is prose the schema caps at no length at all, and on `crewai` it is two hundred and
   * twenty six characters, which rendered as four wrapped rows inside a sixty nine column frame.
   */
  it('never lets the paragraph behind an area reach a line', () => {
    const rendered = render({
      unsupported: [
        { area: 'mcp used in source', kind: 'adapter_blind_spot', reason: 'q'.repeat(226) },
      ] as never,
    });
    assert.equal(
      rendered.some((line) => line.includes('qqq')),
      false,
    );
    for (const line of rendered) assert.ok(line.length <= 80, line);
  });
});

describe('an input the project wrote and this build rejected', () => {
  const detail =
    '.orchescope/manifest.yaml is not a valid manifest: /components/0/sideEffect must have required property idempotency';

  it('comes first, and keeps the pointer that says which line to change', () => {
    const rendered = render({ adapters: [adapter('adapter:manifest', 'failed', detail)] });
    assert.equal(rendered.length, 2);
    assert.match(
      rendered[0] ?? '',
      /^gap {13}x failed {5}manifest: \.orchescope\/manifest\.yaml is not a valid/,
    );
    assert.match(rendered.join(' '), /\/components\/0\/sideEffect/);
    for (const line of rendered) assert.ok(line.length <= 80, line);
  });

  it('spends at most one further row on it, so a row never becomes a paragraph', () => {
    const rendered = render({
      adapters: [adapter('adapter:manifest', 'failed', 'z'.repeat(400))],
    });
    assert.equal(rendered.length, 2);
    for (const line of rendered) assert.ok(line.length <= 80, line);
  });
});

describe('the ceiling', () => {
  it('shows four kinds and counts the rest in one line', () => {
    const rendered = render({
      filesSkipped: 5,
      skipped: [
        ...skipped('too_large', 1),
        ...skipped('symlink', 1),
        ...skipped('binary', 1),
        ...skipped('ignored', 1),
        ...skipped('unreadable', 1),
      ] as never,
      truncated: true,
    });
    assert.equal(rendered.filter((line) => line.startsWith('gap')).length, 5);
    assert.equal(rendered.at(-1), 'gap             2 more kinds of gap, in the report');
  });
});

/**
 * A directory this build's own configuration excluded, in a repository that tracks source inside it.
 *
 * The state word is its own, because the owner of this gap is neither the repository nor this reader: it
 * is the configuration, and the remediation is a setting to narrow rather than a parser to write.
 */
describe('a directory excluded from analysis', () => {
  it('renders under a word of its own rather than as an unread area', () => {
    assert.deepEqual(
      render({
        unsupported: [
          {
            area: 'src/build',
            kind: 'excluded_from_analysis',
            reason: 'Traversal did not enter it.',
          },
        ] as never,
      }),
      ['gap             . excluded   src/build'],
    );
  });
});
