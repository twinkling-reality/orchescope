/**
 * Runs one audit over a materialised corpus entry.
 *
 * The command line is what a user runs, so the harness runs it too rather than calling discovery directly: a
 * regression that only appears once the CLI has composed the workspace is exactly the kind this corpus exists to
 * catch. The report bundle is exported alongside the JSON document because component kinds live in the graph, and
 * it is written outside the audited tree so the next scan does not discover it.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cacheDirectory } from './checkout.mjs';

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const parseDocument = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const bundlePathFor = (root, name) => join(cacheDirectory(root), 'bundles', `${name}.json`);

export const auditRepository = (root, name, directory) => {
  /*
   * State written by an earlier run would make the measurement depend on this machine: stored runs produce a
   * reconciliation delta, and the corpus is about what a repository declares. The fact cache survives, because its
   * keys carry the content digest and the analyser version.
   */
  rmSync(join(directory, '.orchescope/state'), { recursive: true, force: true });

  const bundlePath = bundlePathFor(root, name);
  mkdirSync(dirname(bundlePath), { recursive: true });
  rmSync(bundlePath, { force: true });

  let stdout;
  try {
    stdout = execFileSync(
      'node',
      [
        join(root, 'apps/cli/src/main.ts'),
        '--cwd',
        directory,
        'audit',
        '--json',
        '--export-json',
        bundlePath,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: MAX_OUTPUT_BYTES,
        env: { ...process.env, NO_COLOR: '1' },
      },
    );
  } catch (error) {
    const document = parseDocument(String(error.stdout ?? ''));
    const detail = document?.error?.message ?? String(error.stderr ?? error.message).trim();
    throw new Error(`the audit of ${name} failed: ${detail}`);
  }

  const document = parseDocument(stdout);
  if (document === undefined) throw new Error(`the audit of ${name} wrote no JSON document`);
  if (document.ok !== true) {
    throw new Error(`the audit of ${name} failed: ${document.error?.message ?? 'no message'}`);
  }
  return { audit: document.data, bundle: JSON.parse(readFileSync(bundlePath, 'utf8')) };
};
