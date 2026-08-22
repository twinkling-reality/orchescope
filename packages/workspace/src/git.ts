import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';

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
  readonly repositoryUrl?: string;
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

/**
 * Every path git tracks, which is the answer to whether an ignored file is part of the repository.
 *
 * An ignore rule states an intention and the index states the outcome, and where they disagree the index
 * is what git honours. One pinned repository ignores `*_*.md` and has committed twenty one documentation
 * files matching it, so a traversal that read the rules alone and stopped there would drop real source
 * that its author kept on purpose. Reading the rules without reading this is the version of the feature
 * that removes what it was meant to preserve.
 *
 * The result holds every tracked file and every directory containing one, because traversal asks about
 * both and a directory it declines to enter takes the tracked files inside it with it. The file count
 * comes back beside it rather than as the size of that set, which counts the implied directories too, and
 * beside it rather than from a second `git ls-files`, so coverage cannot report a whole that disagrees
 * with the set traversal was given.
 *
 * The output is bounded generously because it is one line per tracked file, and a repository too large for
 * that bound produces nothing rather than a partial list, since a partial list would silently exclude the
 * files it failed to mention.
 */
export type TrackedPaths = {
  /** Every tracked file, and every directory holding one. */
  readonly paths: ReadonlySet<string>;
  /** How many of them are files, which is what the index actually lists. */
  readonly fileCount: number;
};

export const readTrackedPaths = (root: string): TrackedPaths | undefined => {
  let output: string;
  try {
    output = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch {
    return undefined;
  }
  const kept = new Set<string>();
  let fileCount = 0;
  for (const path of output.split('\0')) {
    if (path.length === 0) continue;
    kept.add(path);
    fileCount += 1;
    /*
     * Git tracks files and not directories, and traversal asks about both. A directory holding a tracked
     * file is kept by implication: excluding it would drop the tracked file without ever asking about it,
     * since traversal stops at a directory it does not enter.
     */
    for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
      kept.add(path.slice(0, slash));
    }
  }
  return { paths: kept, fileCount };
};

export const readGitFacts = (root: string): GitFacts | undefined => {
  const inside = run(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return undefined;
  const commit = run(root, ['rev-parse', 'HEAD']);
  const ref = run(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const remote = run(root, ['remote', 'get-url', 'origin']);
  const status = run(root, ['status', '--porcelain', '--untracked-files=no']);
  return {
    ...(commit === undefined || !/^[0-9a-f]{7,40}$/.test(commit) ? {} : { commit }),
    ...(ref === undefined || ref.length === 0 ? {} : { ref }),
    ...(remote === undefined ? {} : canonicalRepositoryUrl(remote)),
    dirty: status !== undefined && status.length > 0,
  };
};

/**
 * The scan root's location inside its Git checkout.
 *
 * A package inside a monorepo stores source locations relative to the package root, while runtime source
 * identity is relative to the Git root. This prefix is derived from Git and the resolved scan root, not
 * from an operator-authored workspace list. It is absent for a repository-root scan or when Git cannot
 * establish one contained relationship.
 */
export const readGitRepositoryPath = (root: string): string | undefined => {
  const topLevel = run(root, ['rev-parse', '--show-toplevel']);
  if (topLevel === undefined) return undefined;
  let fromTop: string;
  try {
    fromTop = relative(realpathSync(topLevel), realpathSync(root)).split(sep).join('/');
  } catch {
    return undefined;
  }
  if (
    fromTop.length === 0 ||
    fromTop === '.' ||
    fromTop.startsWith('../') ||
    fromTop === '..' ||
    fromTop.startsWith('/')
  ) {
    return undefined;
  }
  return fromTop;
};

const canonicalRepositoryUrl = (remote: string): { readonly repositoryUrl?: string } => {
  try {
    const parsed = new URL(remote);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return {};
    if (parsed.username.length > 0 || parsed.password.length > 0) return {};
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\.git$/, '').replace(/\/$/, '');
    parsed.search = '';
    parsed.hash = '';
    if (parsed.pathname.length <= 1) return {};
    return { repositoryUrl: parsed.toString().replace(/\/$/, '') };
  } catch {
    return {};
  }
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
