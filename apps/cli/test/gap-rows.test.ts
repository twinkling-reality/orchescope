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
          { area: 'prompt use: 1 unresolved', kind: 'topology_incomplete', reason: 'p' },
          { area: 'something older', reason: 'w' },
        ] as never,
      }),
      [
        'gap             . unparsed   go source files (1)',
        'gap             . unread     mcp used in source',
        'gap             . discarded  edge to nowhere',
        'gap             . incomplete  prompt use: 1 unresolved',
        'gap             1 more, in the report: unread',
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
  it('renders an unclaimed imported construction as unread', () => {
    assert.deepEqual(
      render({
        unsupported: [
          {
            area: 'unknown_agents.Factory at src/app.py:3',
            kind: 'unclaimed_imported_construction',
            reason: 'an imported construction no adapter claims',
          },
        ] as never,
      }),
      ['gap             . unread     unknown_agents.Factory at src/app.py:3'],
    );
  });

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
    assert.equal(rendered.at(-1), 'gap             2 more, in the report: skipped');
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

/**
 * The third bound in series between a construction and a reader.
 *
 * Discovery samples a refusal, the per-distribution share samples it again, and this ceiling could then
 * replace what survived both with a number. A repository holding a failed adapter, a truncated scan and
 * a skipped file has spent every slot before an unread distribution is considered, so the row a reader
 * saw was a count and the refusal reached the machine readable document and nowhere else.
 *
 * All three are FALSIFIERS: against the revision before this the overflow row read
 * `N more kinds of gap, in the report` and named nothing.
 */
describe('what the row ceiling drops', () => {
  it('names the states it dropped rather than only counting them', () => {
    /* Truncation and two skip reasons fill three of four slots, so the unread distribution is dropped. */
    const rendered = render({
      truncated: true as never,
      skipped: [...skipped('binary', 2), ...skipped('generated', 1)] as never,
      unsupported: [
        { area: 'go source files (1)', kind: 'language_not_analysed', reason: 'x' },
        {
          area: 'a distribution nobody claims',
          kind: 'unclaimed_imported_construction',
          reason: 'y',
        },
        { area: 'edge to nowhere', kind: 'discarded_relation', reason: 'z' },
      ] as never,
    });

    const last = rendered.at(-1) ?? '';
    assert.match(last, /in the report:/, rendered.join(' | '));
    assert.match(
      last,
      /unread/,
      `the unread distribution was dropped without being named: ${last}`,
    );
    assert.match(last, /discarded/, last);
  });

  it('still bounds the region at the ceiling plus the one row that names the rest', () => {
    const rendered = render({
      unsupported: Array.from({ length: 30 }, (_value, index) => ({
        area: `area ${index}`,
        kind: 'unclaimed_imported_construction',
        reason: 'r',
      })) as never,
    });

    assert.equal(rendered.length, 5, rendered.join(' | '));
    assert.equal(rendered.at(-1), 'gap             26 more, in the report: unread');
  });

  it('GUARD: fits the frame with every state the vocabulary allows overflowing at once', () => {
    const kinds = [
      'language_not_analysed',
      'adapter_found_nothing',
      'discarded_relation',
      'topology_incomplete',
      'excluded_from_analysis',
    ];
    const rendered = render({
      truncated: true as never,
      skipped: [
        { file: 'a.py', reason: 'binary' },
        { file: 'b.py', reason: 'generated' },
        { file: 'c.py', reason: 'too_large' },
        { file: 'd.py', reason: 'parse_error' },
      ] as never,
      componentsDeclaredInTest: 3 as never,
      unsupported: kinds.map((kind, index) => ({
        area: `area ${index}`,
        kind,
        reason: 'r',
      })) as never,
    });

    const last = rendered.at(-1) ?? '';
    assert.ok(last.length <= 80, `the overflow row does not fit the frame: ${last.length} columns`);
    assert.equal(last.includes('…'), false, `the frame cut the names: ${last}`);
    assert.match(last, /and \d+ more$/, last);
  });

  it('names a state once however many rows carried it', () => {
    const rendered = render({
      unsupported: Array.from({ length: 12 }, (_value, index) => ({
        area: `area ${index}`,
        kind: index % 2 === 0 ? 'discarded_relation' : 'topology_incomplete',
        reason: 'r',
      })) as never,
    });

    const last = rendered.at(-1) ?? '';
    assert.equal(last.match(/discarded/g)?.length, 1, last);
    assert.equal(last.match(/incomplete/g)?.length, 1, last);
  });
});
