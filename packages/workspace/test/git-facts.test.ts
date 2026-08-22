import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { readGitFacts } from '../src/git.ts';

const roots: string[] = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const repository = (remote?: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-git-facts-'));
  roots.push(root);
  writeFileSync(join(root, 'agent.ts'), 'export const agent = true;\n');
  const git = (args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
  };
  git(['init', '--quiet']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'fixture']);
  if (remote !== undefined) git(['remote', 'add', 'origin', remote]);
  return root;
};

describe('Git repository identity', () => {
  it('records a canonical browser coordinate without credentials or the Git suffix', () => {
    const facts = readGitFacts(repository('https://GitHub.com/openai/example.git'));
    assert.equal(facts?.repositoryUrl, 'https://github.com/openai/example');
    assert.match(facts?.commit ?? '', /^[0-9a-f]{40}$/);
  });

  it('stays absent when the remote cannot be represented as a browser coordinate', () => {
    const facts = readGitFacts(repository('git@github.com:openai/example.git'));
    assert.equal(facts?.repositoryUrl, undefined);
  });
});
