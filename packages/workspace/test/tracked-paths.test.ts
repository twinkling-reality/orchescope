import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { readTrackedPaths } from '../src/git.ts';

/**
 * What the index lists, counted apart from the set traversal is given.
 *
 * The set holds every tracked file and every directory holding one, because traversal asks about both, so
 * its size is larger than the repository by however many directories it has. Coverage states the count as
 * the whole its other numbers can be checked against, and a whole inflated by directory entries would be
 * a denominator nobody could reconcile with `git ls-files`.
 */

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repository = (files: readonly string[]): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-tracked-'));
  roots.push(root);
  for (const file of files) {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, 'x\n');
  }
  const git = (args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
  };
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'fixture']);
  return root;
};

describe('the paths an index tracks', () => {
  it('counts the files it lists, and not the directories kept for traversal', () => {
    const tracked = readTrackedPaths(repository(['a.ts', 'src/b.ts', 'src/deep/c.ts']));
    assert.equal(tracked?.fileCount, 3);
    assert.deepEqual([...(tracked?.paths ?? [])].sort(), [
      'a.ts',
      'src',
      'src/b.ts',
      'src/deep',
      'src/deep/c.ts',
    ]);
  });

  /* Nothing states what the repository is, so a count of what traversal reached would be self assessment. */
  it('says nothing at all where the root is not a checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-untracked-'));
    roots.push(root);
    writeFileSync(join(root, 'a.ts'), 'x\n');
    assert.equal(readTrackedPaths(root), undefined);
  });
});
