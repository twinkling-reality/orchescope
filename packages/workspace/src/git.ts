import { execFileSync } from 'node:child_process';

/**
 * Git facts, read for provenance.
 *
 * Every invocation is `execFileSync` with an argument array and no shell, a short timeout and a bounded output,
 * so a repository cannot influence what runs. A repository that is not a git checkout is a normal case and
 * produces no facts rather than an error.
 */

export type GitFacts = {
  readonly commit?: string;
  readonly ref?: string;
  readonly dirty: boolean;
};

const run = (root: string, args: readonly string[]): string | undefined => {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 3_000,
      maxBuffer: 256 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
};

export const readGitFacts = (root: string): GitFacts | undefined => {
  const inside = run(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return undefined;
  const commit = run(root, ['rev-parse', 'HEAD']);
  const ref = run(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const status = run(root, ['status', '--porcelain', '--untracked-files=no']);
  return {
    ...(commit === undefined || !/^[0-9a-f]{7,40}$/.test(commit) ? {} : { commit }),
    ...(ref === undefined || ref.length === 0 ? {} : { ref }),
    dirty: status !== undefined && status.length > 0,
  };
};

/** Resolves a user supplied revision to a commit, used by comparison against a git reference. */
export const resolveRevision = (root: string, revision: string): string | undefined => {
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(revision)) return undefined;
  const commit = run(root, ['rev-parse', '--verify', `${revision}^{commit}`]);
  return commit !== undefined && /^[0-9a-f]{40}$/.test(commit) ? commit : undefined;
};
