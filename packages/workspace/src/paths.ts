import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { OrchescopeError } from '@orchescope/domain';

/**
 * Workspace paths.
 *
 * Everything Orchescope writes goes under `.orchescope` inside the audited repository, and nowhere else. That
 * makes the footprint obvious, makes cleanup a single directory removal, and means a scan of someone else's
 * repository cannot leave state in a home directory the user did not expect.
 *
 * Configuration is meant to be committed. State, cache and reports are not, so `orchescope init` writes a
 * `.gitignore` inside `.orchescope` that excludes them.
 */

export const ORCHESCOPE_DIRECTORY = '.orchescope';

export type WorkspacePaths = {
  readonly root: string;
  readonly orchescope: string;
  readonly configFile: string;
  readonly manifestFile: string;
  readonly state: string;
  readonly databaseFile: string;
  readonly artifacts: string;
  readonly reports: string;
  readonly cache: string;
  readonly scenarios: string;
};

export const resolvePaths = (root: string): WorkspacePaths => {
  const absoluteRoot = resolve(root);
  const orchescope = join(absoluteRoot, ORCHESCOPE_DIRECTORY);
  const state = join(orchescope, 'state');
  return {
    root: absoluteRoot,
    orchescope,
    configFile: join(orchescope, 'config.json'),
    manifestFile: join(orchescope, 'manifest.yaml'),
    state,
    databaseFile: join(state, 'orchescope.db'),
    artifacts: join(state, 'artifacts'),
    reports: join(state, 'reports'),
    cache: join(orchescope, 'cache'),
    scenarios: join(absoluteRoot, 'scenarios'),
  };
};

/** Creates the state directories with owner only permissions. */
export const ensureStateDirectories = (paths: WorkspacePaths): void => {
  for (const directory of [
    paths.orchescope,
    paths.state,
    paths.artifacts,
    paths.reports,
    paths.cache,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
};

export const workspaceExists = (paths: WorkspacePaths): boolean => existsSync(paths.configFile);

/**
 * Resolves a repository relative path and refuses anything that escapes the root. Every path that arrives from
 * a configuration file, a scenario or an HTTP request goes through here.
 */
export const resolveInsideRoot = (paths: WorkspacePaths, relativePath: string): string => {
  if (isAbsolute(relativePath)) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'An absolute path is not accepted here.', {
      detail: { path: relativePath },
    });
  }
  const resolved = resolve(paths.root, relativePath);
  const prefix = paths.root.endsWith('/') ? paths.root : `${paths.root}/`;
  if (resolved !== paths.root && !resolved.startsWith(prefix)) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'The path escapes the repository root.', {
      detail: { path: relativePath },
      remediation: 'Use a path inside the repository.',
    });
  }
  return resolved;
};

export const parentDirectory = (path: string): string => dirname(path);
