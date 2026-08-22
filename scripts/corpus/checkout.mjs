/**
 * Materialises a corpus entry into `corpus/.cache`.
 *
 * Third party source is never vendored into this repository, so a git entry is cloned at its pinned commit into a
 * directory git ignores. The fetch is shallow and asks for one revision by name, which is what keeps a corpus of a
 * dozen repositories small enough to be worth having.
 *
 * A local entry is copied rather than audited in place, for two reasons: the audit writes state into the directory
 * it audits, and only tracked files belong to the measurement. Copying from `git ls-files` means the working tree
 * is what gets measured, so an uncommitted change to an adapter shows up in the offline gate immediately.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const git = (args, cwd) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });

export const cacheDirectory = (root) => join(root, 'corpus/.cache');

/** Every path this script writes to is resolved and checked against the cache, never assembled and trusted. */
const directoryFor = (root, name) => {
  const cache = cacheDirectory(root);
  const directory = resolve(cache, name);
  if (directory !== join(cache, name)) {
    throw new Error(`${name} does not resolve to a directory inside ${cache}`);
  }
  return directory;
};

const alreadyFetched = (directory, commit) => {
  try {
    git(['cat-file', '-e', `${commit}^{commit}`], directory);
    return true;
  } catch {
    return false;
  }
};

const checkoutGit = (root, entry, allowNetwork) => {
  const directory = directoryFor(root, entry.name);
  if (!existsSync(join(directory, '.git'))) {
    if (!allowNetwork) {
      throw new Error(`${entry.name} is not in the cache, and this run is offline`);
    }
    mkdirSync(directory, { recursive: true });
    git(['init', '--quiet'], directory);
    git(['remote', 'add', 'origin', entry.url], directory);
  }
  if (!alreadyFetched(directory, entry.commit)) {
    if (!allowNetwork) {
      throw new Error(`${entry.name} is in the cache at another commit, and this run is offline`);
    }
    git(['fetch', '--quiet', '--depth', '1', 'origin', entry.commit], directory);
  }
  // Forced, because a formatter or an editor pointed at the cache would otherwise change what is measured.
  git(['checkout', '--quiet', '--force', '--detach', entry.commit], directory);
  if (entry.subpath === undefined) return directory;
  const repositoryRoot = realpathSync(directory);
  const candidate = resolve(directory, entry.subpath);
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`${entry.name}: ${entry.subpath} is not a directory at ${entry.commit}`);
  }
  const auditRoot = realpathSync(candidate);
  const inside = relative(repositoryRoot, auditRoot);
  if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`${entry.name}: ${entry.subpath} resolves outside its pinned repository`);
  }
  return auditRoot;
};

const checkoutLocal = (root, entry) => {
  const directory = directoryFor(root, entry.name);
  rmSync(directory, { recursive: true, force: true });
  const files = git(['ls-files', '-z', '--', entry.path], root).split('\0').filter(Boolean);
  if (files.length === 0) throw new Error(`${entry.name}: ${entry.path} holds no tracked file`);
  for (const file of files) {
    const destination = join(directory, file.slice(entry.path.length + 1));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, file), destination);
  }
  return directory;
};

export const checkout = (root, entry, allowNetwork) =>
  entry.source === 'git' ? checkoutGit(root, entry, allowNetwork) : checkoutLocal(root, entry);
