/**
 * Derive source identity from the JavaScript call stack and the Git checkout that owns the frame.
 *
 * The component name, package name, working directory and corpus definition are deliberately absent.
 * A frame qualifies only when it names an existing tracked file in a clean Git checkout whose origin
 * is a credential-free HTTP(S) URL and whose HEAD is a full immutable revision.
 */

import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCallSites } from 'node:util';

const MAX_FRAMES = 64;
const MAX_GIT_OUTPUT = 64 * 1024;
const GIT_TIMEOUT_MS = 3_000;
const THIS_FILE = realpathSync(fileURLToPath(import.meta.url));

const git = (directory, ...arguments_) => {
  try {
    const output = execFileSync('git', ['-C', directory, ...arguments_], {
      encoding: 'utf8',
      maxBuffer: MAX_GIT_OUTPUT,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    }).trim();
    return output.length === 0 ? undefined : output;
  } catch {
    return undefined;
  }
};

const checkoutIsClean = (root) => {
  try {
    const output = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain', '--untracked-files=no'],
      {
        encoding: 'utf8',
        maxBuffer: MAX_GIT_OUTPUT,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_TIMEOUT_MS,
      },
    );
    return output.trim().length === 0;
  } catch {
    return false;
  }
};

const canonicalRepositoryUrl = (value) => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    if (parsed.username.length > 0 || parsed.password.length > 0) return undefined;
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\.git$/, '').replace(/\/$/, '');
    parsed.search = '';
    parsed.hash = '';
    if (parsed.pathname.length <= 1) return undefined;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
};

const absoluteFrameFile = (scriptName) => {
  if (typeof scriptName !== 'string' || scriptName.length === 0) return undefined;
  let candidate = scriptName;
  if (candidate.startsWith('file:')) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'file:' || (parsed.hostname && parsed.hostname !== 'localhost')) {
        return undefined;
      }
      candidate = fileURLToPath(parsed);
    } catch {
      return undefined;
    }
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)) {
    return undefined;
  }
  if (!candidate.startsWith(sep)) return undefined;
  try {
    const absolute = realpathSync(candidate);
    return statSync(absolute).isFile() ? absolute : undefined;
  } catch {
    return undefined;
  }
};

const sourceIdentityFromFrame = (frame, ignoredFiles) => {
  const absoluteFile = absoluteFrameFile(frame.scriptName);
  if (absoluteFile === undefined || ignoredFiles.has(absoluteFile)) return undefined;

  const rootValue = git(resolve(absoluteFile, '..'), 'rev-parse', '--show-toplevel');
  if (rootValue === undefined) return undefined;
  let repositoryRoot;
  try {
    repositoryRoot = realpathSync(rootValue);
    if (!statSync(repositoryRoot).isDirectory()) return undefined;
  } catch {
    return undefined;
  }

  const repositoryFile = relative(repositoryRoot, absoluteFile).split(sep).join('/');
  if (
    repositoryFile.length === 0 ||
    repositoryFile.startsWith('../') ||
    repositoryFile.includes('\0') ||
    repositoryFile.includes('\n') ||
    repositoryFile
      .split('/')
      .some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  if (git(repositoryRoot, 'ls-files', '--error-unmatch', '--', repositoryFile) === undefined) {
    return undefined;
  }

  const revision = git(repositoryRoot, 'rev-parse', 'HEAD');
  if (revision === undefined || !/^[0-9a-f]{40}$/.test(revision)) return undefined;
  if (!checkoutIsClean(repositoryRoot)) return undefined;
  const remote = git(repositoryRoot, 'remote', 'get-url', 'origin');
  const repositoryUrl = remote === undefined ? undefined : canonicalRepositoryUrl(remote);
  if (repositoryUrl === undefined) return undefined;

  const line =
    Number.isInteger(frame.lineNumber) && frame.lineNumber >= 1 ? frame.lineNumber : undefined;
  const functionName =
    typeof frame.functionName === 'string' && frame.functionName.length > 0
      ? frame.functionName
      : undefined;
  return {
    absoluteFile,
    repositoryFile,
    repositoryUrl,
    revision,
    ...(line === undefined ? {} : { line }),
    ...(functionName === undefined ? {} : { functionName }),
  };
};

/** Capture the first qualifying caller frame, after excluding the instrumentation boundary. */
export const captureNodeSourceIdentity = (ignored = []) => {
  const ignoredFiles = new Set([THIS_FILE]);
  for (const file of ignored) {
    try {
      ignoredFiles.add(realpathSync(file));
    } catch {
      return undefined;
    }
  }
  for (const frame of getCallSites(MAX_FRAMES, { sourceMap: true })) {
    const identity = sourceIdentityFromFrame(frame, ignoredFiles);
    if (identity !== undefined) return identity;
  }
  return undefined;
};

/** OpenTelemetry attributes for a source identity captured by this module. */
export const nodeSourceAttributes = (identity) => ({
  'code.file.path': identity.absoluteFile,
  'orchescope.code.repository.path': identity.repositoryFile,
  'vcs.repository.url.full': identity.repositoryUrl,
  'vcs.ref.head.revision': identity.revision,
  'orchescope.source.capture': 'node.callsite.source_map',
  ...(identity.line === undefined ? {} : { 'code.line.number': identity.line }),
  ...(identity.functionName === undefined ? {} : { 'code.function.name': identity.functionName }),
});
