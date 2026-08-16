import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { installServer, installTargets } from '../src/install.ts';

/**
 * Registering the server with a client.
 *
 * The property worth holding is which files may name this machine. Three of the four targets are written
 * into the repository and read by whoever checks it out, and a machine specific path in one of those does
 * not fail loudly: the client starts a command that is not there, lists no tools, and the agent behaves as
 * though Orchescope were not installed. The fourth is the user's own file, where the absolute paths are
 * correct and an inherited working directory is not something to rely on.
 */

const roots: string[] = [];
const root = (): string => {
  const made = mkdtempSync(join(tmpdir(), 'orchescope-install-'));
  roots.push(made);
  return made;
};

after(() => {
  for (const path of roots) rmSync(path, { recursive: true, force: true });
});

describe('registering the server with a client', () => {
  it('keeps this machine out of every file the repository carries', () => {
    const home = root();
    const repository = root();
    const project = installTargets(repository, home).filter((target) => target.scope === 'project');
    assert.equal(project.length, 3, 'the shared targets are the three written into the repository');

    for (const target of project) {
      installServer({ target, command: 'orchescope', args: ['mcp', 'serve'], overwrite: true });
      const written = readFileSync(target.file, 'utf8');
      assert.ok(!written.includes(repository), `${target.client} named the repository path`);
      assert.ok(!written.includes(process.execPath), `${target.client} named this node binary`);
      assert.ok(!written.includes('--cwd'), `${target.client} pinned a working directory`);
      const entry = (JSON.parse(written) as Record<string, Record<string, { command: string }>>)[
        target.key
      ]?.['orchescope'];
      assert.equal(entry?.command, 'orchescope');
    }
  });

  it('writes the absolute paths into the file that belongs to one machine', () => {
    const target = installTargets(root(), root()).find((entry) => entry.scope === 'user');
    assert.ok(target !== undefined);
    installServer({
      target,
      command: process.execPath,
      args: ['/somewhere/main.ts', 'mcp', 'serve', '--cwd', '/somewhere/repo'],
      overwrite: true,
    });
    const written = readFileSync(target.file, 'utf8');
    assert.ok(written.includes('--cwd'), 'a user scoped client cannot infer the repository');
  });

  it('leaves an entry it did not write alone unless asked to replace it', () => {
    const target = installTargets(root(), root())[0];
    assert.ok(target !== undefined);
    installServer({ target, command: 'orchescope', args: ['mcp', 'serve'], overwrite: true });
    const again = installServer({
      target,
      command: 'somethingelse',
      args: [],
      overwrite: false,
    });
    assert.equal(again.action, 'unchanged');
    assert.match(readFileSync(target.file, 'utf8'), /orchescope/);
  });

  it('refuses a file that is not valid json rather than overwriting what it cannot read', () => {
    const target = installTargets(root(), root())[0];
    assert.ok(target !== undefined);
    writeFileSync(target.file, '{ not json');
    assert.throws(
      () => installServer({ target, command: 'orchescope', args: [], overwrite: true }),
      /not valid JSON/,
    );
  });
});
