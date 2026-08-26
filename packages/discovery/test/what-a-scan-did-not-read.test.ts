import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

/**
 * What a scan says about the part of a repository it never opened.
 *
 * Two claims, and they answer the same question at two different resolutions. `pathsWalked` counts every
 * path traversal reached, so the difference between it and `filesDiscovered` is the part of a repository
 * that reaches no count, no parser, no document reader and no refusal. `language_not_analysed` names a
 * language where the extension table happens to know one, and that table matched nothing across fifty six
 * pinned repositories, which is why the count is the load-bearing half and the name is the bonus.
 *
 * The area string carries no count, because `area` is the only field the terminal prints and the only
 * field the corpus records, so a number in it makes a pinned expectation churn on an edit that says
 * nothing about this build.
 */

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>) => {
  const workspace = createTempWorkspace('orchescope-unread-paths-');
  workspaces.push(workspace);
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'unread-paths-fixture',
      orchescopeVersion: '0.9.2',
      clock,
      deadline,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 100,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 2,
    });
  } finally {
    deadline.dispose();
  }
};

describe('the paths a scan walked and recorded nothing about', () => {
  it('counts them, so a repository this build barely read cannot report as fully read', async () => {
    const result = await scan({
      'index.ts': 'export const value = 1;\n',
      'guide.adoc': '= A format this build does not read\n',
      'notes.org': '* Another one\n',
      'diagram.excalidraw': '{"type":"excalidraw"}\n',
    });
    const coverage = result.graph.coverage;
    assert.equal(
      coverage.filesParsed,
      1,
      'one TypeScript file is the whole of what this build parses here',
    );
    assert.ok(
      coverage.pathsWalked !== undefined,
      'a scan states how many paths it walked, or a reader cannot tell a small repository from an unread one',
    );
    assert.equal(
      coverage.pathsWalked - coverage.filesDiscovered,
      3,
      'the three files in formats this build recognises as no language at all are counted, and they reach no other number in the coverage block',
    );
  });

  it('names a language it does not read without putting the count in the name', async () => {
    const result = await scan({
      'index.ts': 'export const value = 1;\n',
      'main.go': 'package main\n\nfunc main() {}\n',
      'other.go': 'package main\n',
    });
    const areas = result.graph.coverage.unsupported.filter(
      (area) => area.kind === 'language_not_analysed',
    );
    assert.equal(areas.length, 1, 'one language, one area');
    const area = areas[0];
    assert.ok(area !== undefined);
    assert.equal(
      area.area,
      'go source files',
      'the area is the identity and nothing that moves, because it is the only field the terminal prints and the only field the corpus records',
    );
    assert.match(
      area.reason,
      /\b2\b/,
      'the count is in the reason, where the machine readable document carries it in full',
    );
  });

  it('says the same thing about the area whichever number of files there are', async () => {
    const two = await scan({
      'index.ts': 'export const value = 1;\n',
      'main.go': 'package main\n',
      'other.go': 'package main\n',
    });
    const three = await scan({
      'index.ts': 'export const value = 1;\n',
      'main.go': 'package main\n',
      'other.go': 'package main\n',
      'third.go': 'package main\n',
    });
    const areaOf = (result: Awaited<ReturnType<typeof scan>>) =>
      result.graph.coverage.unsupported.find((area) => area.kind === 'language_not_analysed')?.area;
    assert.equal(
      areaOf(two),
      areaOf(three),
      'adding one file of a language this build does not read must not rewrite a recorded corpus expectation',
    );
  });
});
