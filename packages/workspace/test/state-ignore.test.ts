import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { ensureStateDirectories, resolvePaths } from '../src/paths.ts';

/**
 * Keeping analysis state out of a repository's history.
 *
 * The nested ignore file used to be written by `orchescope init` alone, and the quickstart tells a reader
 * to run `audit` first. Across a sweep of thirty three git repositories that left thirty of them showing
 * an untracked `.orchescope/`, ninety seven megabytes in total. So the property under test is that the
 * file arrives with the directory, from whichever command created it.
 */

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repository = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-state-ignore-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', '.'], { cwd: root, stdio: 'ignore' });
  return root;
};

/** Listed file by file rather than as a collapsed directory, so the exceptions can be named. */
const untracked = (root: string): readonly string[] =>
  execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line.length > 0);

describe('the ignore file beside the state', () => {
  it('is written whenever the state directories are, not only by init', () => {
    const root = repository();
    ensureStateDirectories(resolvePaths(root));
    assert.match(readFileSync(join(root, '.orchescope', '.gitignore'), 'utf8'), /^\*$/m);
  });

  it('leaves a repository whose only orchescope directory is state showing nothing untracked', () => {
    const root = repository();
    const paths = resolvePaths(root);
    ensureStateDirectories(paths);
    writeFileSync(paths.databaseFile, 'not really a database', { mode: 0o600 });
    assert.deepEqual(untracked(root), []);
  });

  /*
   * The two files a repository is meant to carry. A deny list with exceptions covers whatever else this
   * build writes later, which naming `state/` and `cache/` did not.
   */
  it('keeps the configuration and the manifest committable', () => {
    const root = repository();
    const paths = resolvePaths(root);
    ensureStateDirectories(paths);
    writeFileSync(paths.configFile, '{}\n', { mode: 0o600 });
    writeFileSync(paths.manifestFile, 'components: []\n', { mode: 0o600 });
    assert.deepEqual(
      untracked(root)
        .map((line) => line.slice(3))
        .sort(),
      ['.orchescope/config.json', '.orchescope/manifest.yaml'],
    );
  });

  it('is rewritten on every open, so a file edited by hand cannot leave state exposed', () => {
    const root = repository();
    const paths = resolvePaths(root);
    ensureStateDirectories(paths);
    writeFileSync(join(paths.orchescope, '.gitignore'), '# emptied by hand\n', { mode: 0o600 });
    ensureStateDirectories(paths);
    writeFileSync(paths.databaseFile, 'not really a database', { mode: 0o600 });
    assert.deepEqual(untracked(root), []);
  });
});
