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

/**
 * The exit status of a git command, which is the answer when the command reports by status rather than
 * by output. `undefined` means git could not be asked at all.
 */
const exitStatus = (root: string, args: readonly string[]): number | undefined => {
  try {
    execFileSync('git', args, {
      cwd: root,
      timeout: 3_000,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    });
    return 0;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return typeof status === 'number' ? status : undefined;
  }
};

/**
 * The rule that excludes a path from git, when one does.
 *
 * Two calls, because one cannot answer both questions without ambiguity. With `--verbose` git prints the
 * last pattern that matched even when that pattern is a negation, and it exits zero in both cases, so the
 * output is a rule and not a decision: on a repository excluding nothing, the nested `!config.json` came
 * back as though it were what excluded the file. The quiet form's exit status is the decision, and the
 * verbose form is asked only once the decision is yes.
 *
 * The index is deliberately consulted rather than skipped. A file that is already tracked will be
 * committed whatever the ignore rules say, and warning about one would be telling a reader to fix
 * something that is not broken.
 *
 * A path nothing excludes, a directory that is not a git checkout, and a machine with no git all answer
 * the same way, which is the safe direction: nothing is claimed and nothing is printed.
 */
export const ignoreRuleFor = (root: string, relativePath: string): string | undefined => {
  if (exitStatus(root, ['check-ignore', '--quiet', '--', relativePath]) !== 0) return undefined;
  const output = run(root, ['check-ignore', '--verbose', '--', relativePath]);
  const rule = output?.split('\n')[0]?.split('\t')[0];
  return rule === undefined || rule.length === 0 ? undefined : rule;
};

/** Resolves a user supplied revision to a commit, used by comparison against a git reference. */
export const resolveRevision = (root: string, revision: string): string | undefined => {
  if (!/^[A-Za-z0-9._/-]{1,120}$/.test(revision)) return undefined;
  const commit = run(root, ['rev-parse', '--verify', `${revision}^{commit}`]);
  return commit !== undefined && /^[0-9a-f]{40}$/.test(commit) ? commit : undefined;
};
