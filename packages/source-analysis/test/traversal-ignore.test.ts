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

/**
 * A directory taken out takes every file inside it, and said nothing.
 *
 * `analysis.exclude` matches a path segment at any depth, and `build`, `out`, `target`, `vendor` and
 * `coverage` are ordinary module names as well as ordinary build output names. A repository with
 * `src/build/` in it lost every file inside it while the report said `filesSkipped: 0` and listed
 * nothing, which is the one failure the coverage block exists to make impossible.
 */
describe('a directory traversal declines to enter', () => {
  const repositoryWithBuild = {
    'src/main.ts': 'export const main = (): void => undefined;\n',
    'src/build/plan.ts': 'export const plan = (): void => undefined;\n',
    'src/build/emit.ts': 'export const emit = (): void => undefined;\n',
    'node_modules/left-pad/index.js': 'module.exports = 1;\n',
  };

  const scan = (trackedPaths?: ReadonlySet<string>) =>
    collectFiles(project(repositoryWithBuild), {
      maxFileBytes: 512 * 1024,
      maxFiles: 500,
      followSymlinks: false,
      excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
      excludePrefixes: [],
      ...(trackedPaths === undefined ? {} : { trackedPaths }),
    });

  /** What `readTrackedPaths` produces: every tracked file and every directory holding one. */
  const tracked = new Set([
    'src',
    'src/main.ts',
    'src/build',
    'src/build/plan.ts',
    'src/build/emit.ts',
  ]);

  it('is named in coverage when the repository tracks files inside it', () => {
    const found = scan(tracked);
    const excluded = found.skipped.filter((entry) => entry.file === 'src/build');
    assert.equal(
      excluded.length,
      1,
      `src/build was not named among ${JSON.stringify(found.skipped)}`,
    );
    assert.equal(excluded[0]?.reason, 'ignored');
    assert.match(excluded[0]?.detail ?? '', /excluded by analysis\.exclude \(build\)/);
    assert.match(excluded[0]?.detail ?? '', /the repository tracks source inside it/);
  });

  it('is reported apart from the skip list, so a caller need not match on prose', () => {
    assert.deepEqual(scan(tracked).excludedTracked, [
      { path: 'src/build', rule: 'analysis.exclude (build)' },
    ]);
  });

  /*
   * The index decides both ways. A file it tracks is part of the repository whatever the rules say, and
   * a directory it tracks nothing inside is derived output: naming every `node_modules` would bury the
   * one line that matters.
   */
  it('is not named when the repository tracks nothing inside it', () => {
    const found = scan(tracked);
    assert.equal(
      found.skipped.some((entry) => entry.file === 'node_modules'),
      false,
      'a directory holding no tracked file was reported as a loss',
    );
    assert.deepEqual(
      found.excludedTracked.map((entry) => entry.path),
      ['src/build'],
    );
  });

  /* With no index there is no statement to read, so nothing is assumed and every decline is named. */
  it('is named whatever it holds when the root is not a checkout', () => {
    const found = scan(undefined);
    assert.deepEqual(
      found.skipped
        .filter((entry) => entry.reason === 'ignored')
        .map((entry) => entry.file)
        .sort(),
      ['node_modules', 'src/build'],
    );
    assert.deepEqual(found.excludedTracked, []);
  });

  it('leaves what it did read exactly as it was', () => {
    assert.deepEqual(
      scan(tracked).files.map((file) => file.path),
      ['src/main.ts'],
    );
  });
});

/**
 * A tracked file is not the same as tracked source.
 *
 * `.orchescope` is excluded by name and holds a manifest committed on purpose, so a rule that asked only
 * whether the repository tracks anything inside an excluded directory reported this tool's own state
 * directory as source it had failed to read, in the demonstration system it ships with.
 */
describe('an excluded directory holding no code', () => {
  it('is not reported as source that was not read', () => {
    const root = project({
      '.orchescope/manifest.yaml': 'project: demo\n',
      'src/main.ts': 'export const main = (): void => undefined;\n',
    });
    const found = collectFiles(root, {
      maxFileBytes: 512 * 1024,
      maxFiles: 500,
      followSymlinks: false,
      excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
      excludePrefixes: [],
      trackedPaths: new Set(['.orchescope', '.orchescope/manifest.yaml', 'src', 'src/main.ts']),
    });
    assert.deepEqual(found.excludedTracked, []);
    assert.deepEqual(found.skipped, []);
  });
});
