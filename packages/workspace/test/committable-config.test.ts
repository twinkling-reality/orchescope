import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { excludedConfig } from '../src/committable-config.ts';
import { ensureStateDirectories, resolvePaths } from '../src/paths.ts';

/**
 * Whether the configuration a project grants ends up in that project's history.
 *
 * `init` says the file is meant to be committed. Git never consults a `.gitignore` inside a directory an
 * ancestor rule already excluded, so a host repository carrying `/.orchescope/` gets the sentence and not
 * the behaviour. Every case here is run against real git rather than against a model of it, because the
 * two answers this has to get right, whether a path is excluded and what to change, are both answers only
 * git has: the obvious remediation turns out not to work, and the obvious way to ask turns out to report
 * a negation as an exclusion.
 */

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repositoryWith = (ignoreRules: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-ignore-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', '.'], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, '.gitignore'), ignoreRules, { mode: 0o600 });
  ensureStateDirectories(resolvePaths(root));
  writeFileSync(join(root, '.orchescope', 'config.json'), '{}\n', { mode: 0o600 });
  return root;
};

const isIgnored = (root: string, relativePath: string): boolean => {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', relativePath], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

describe('excludedConfig', () => {
  it('names the rule that keeps the configuration out of the repository', () => {
    const excluded = excludedConfig(repositoryWith('node_modules\n/.orchescope/\n'));
    assert.match(excluded?.rule ?? '', /\.gitignore:2:\/\.orchescope\//);
  });

  /*
   * The nested ignore file this build writes carries `!config.json`, and `check-ignore --verbose` reports
   * the last pattern that matched even when it is a negation, exiting zero either way. Read as a decision
   * it said the file this build works to keep committable was excluded by its own rule.
   */
  it('says nothing when the last rule to match is the one keeping the file', () => {
    assert.equal(excludedConfig(repositoryWith('node_modules\n')), undefined);
  });

  it('says nothing about a directory that is not a git checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'orchescope-nogit-'));
    roots.push(root);
    ensureStateDirectories(resolvePaths(root));
    assert.equal(excludedConfig(root), undefined);
  });

  /*
   * The measured half. Adding the negation beneath the existing rule, which is the fix that first
   * suggests itself, changes nothing: git will not re-include a file whose parent directory is excluded.
   * What this prints has to be what works, so what works is asserted against git.
   */
  it('prints a fix that git actually honours', () => {
    const excluded = excludedConfig(repositoryWith('/.orchescope/\n'));
    assert.deepEqual(excluded?.fix, ['/.orchescope/*', '!/.orchescope/config.json']);

    const fixed = repositoryWith(`${(excluded?.fix ?? []).join('\n')}\n`);
    assert.equal(excludedConfig(fixed), undefined, 'the printed fix left the file excluded');
    assert.equal(
      isIgnored(fixed, '.orchescope/state/orchescope.db'),
      true,
      'the printed fix stopped ignoring the state it is meant to keep ignoring',
    );
  });

  it('leaves a tracked configuration alone, because it will be committed whatever the rules say', () => {
    const root = repositoryWith('/.orchescope/\n');
    execFileSync('git', ['add', '--force', '.orchescope/config.json'], {
      cwd: root,
      stdio: 'ignore',
    });
    assert.equal(excludedConfig(root), undefined);
  });
});
