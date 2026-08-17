import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { collectFiles, DEFAULT_EXCLUDED_DIRECTORIES } from '../src/file-set.ts';

/**
 * What traversal reads once the repository is allowed to say what it contains.
 *
 * The name list traversal used before is a guess at what an ignore file says, and it loses to every project
 * that puts its build output somewhere else. What it must not do is take the rules at their word over the
 * index: one pinned repository ignores `*_*.md` and has committed twenty one documentation files matching
 * it, so a build reading only the rules would drop real source its author kept on purpose.
 */

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const project = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-ignore-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
};

const paths = (
  root: string,
  options: { respectIgnoreFiles?: boolean; trackedPaths?: ReadonlySet<string> } = {},
): readonly string[] =>
  collectFiles(root, {
    maxFileBytes: 512 * 1024,
    maxFiles: 500,
    followSymlinks: false,
    excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
    excludePrefixes: [],
    ...options,
  })
    .files.map((file) => file.path)
    .sort();

const REPOSITORY = {
  '.gitignore': 'generated/\n*.local.ts\n',
  'src/main.ts': 'export const main = (): void => undefined;\n',
  'generated/client.ts': 'export const generated = 1;\n',
  'src/settings.local.ts': 'export const local = 1;\n',
};

describe('traversal and the repository ignore file', () => {
  it('reads everything when it is not asked to consult one', () => {
    assert.deepEqual(paths(project(REPOSITORY)), [
      'generated/client.ts',
      'src/main.ts',
      'src/settings.local.ts',
    ]);
  });

  it('leaves out what the repository excluded when it is', () => {
    assert.deepEqual(paths(project(REPOSITORY), { respectIgnoreFiles: true }), ['src/main.ts']);
  });

  it('names the file that excluded each one, so coverage can say why', () => {
    const set = collectFiles(project(REPOSITORY), {
      maxFileBytes: 512 * 1024,
      maxFiles: 500,
      followSymlinks: false,
      excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
      excludePrefixes: [],
      respectIgnoreFiles: true,
    });
    const ignored = set.skipped.filter((entry) => entry.reason === 'ignored');
    assert.deepEqual(
      ignored.map((entry) => entry.file),
      ['src/settings.local.ts'],
      'a directory is not entered, so only the file is listed individually',
    );
    assert.match(ignored[0]?.detail ?? '', /excluded by \.gitignore/);
  });

  /*
   * A rule states an intention and the index states the outcome, and git honours the index. Reading the
   * rules without reading the index is the version of this feature that removes what it was meant to keep.
   */
  it('keeps a file the repository tracks despite a rule that matches it', () => {
    assert.deepEqual(
      paths(project(REPOSITORY), {
        respectIgnoreFiles: true,
        trackedPaths: new Set(['src/main.ts', 'src/settings.local.ts']),
      }),
      ['src/main.ts', 'src/settings.local.ts'],
    );
  });

  it('enters an excluded directory when it holds something tracked', () => {
    assert.deepEqual(
      paths(project(REPOSITORY), {
        respectIgnoreFiles: true,
        trackedPaths: new Set(['generated', 'generated/client.ts', 'src/main.ts']),
      }),
      ['generated/client.ts', 'src/main.ts'],
    );
  });
});
