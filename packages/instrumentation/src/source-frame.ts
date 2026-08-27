import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCallSites } from 'node:util';

/**
 * The source location a call was made from, read off the stack that reached the transport.
 *
 * This is the producer for the strongest rule reconciliation has. Everything else a span carries is a
 * name, and a name is the declared half's vocabulary, which is a catalogue of framework readers that
 * decays. A file and a line are produced by the run and read off the source, and neither end needs
 * anybody to have written a reader for the framework in between.
 *
 * **What decides that a frame is the repository's own is whether the repository tracks the file.** Not a
 * list of directories to skip, and not containment inside the audit root. Asking the index excludes
 * `node_modules`, `dist`, `.venv` and every other derived directory without naming any of them, because
 * a repository has already said so by ignoring them, and it is the only test that refuses a file sitting
 * under an unrelated checkout: measured over this repository's own corpus cache, 14 of 69 directories
 * resolve to an enclosing repository they are not part of, and three of the four gates the corpus
 * prototype used confirm that false identity while the index rejects it.
 *
 * **Two populations this provably does not reach, and no bound recovers either.**
 *
 * A built application reports the file the build produced. `getFileName` returned the build output in
 * all seven source-map configurations and all six deployment shapes measured, and zero of the eleven
 * built packages in the pinned corpus that hold a model call ask for a runtime source map, six of them
 * being Next.js applications. The build output is not tracked in most repositories, so this refuses
 * rather than reporting a file no declaration was read from; where it is committed, it reports a real
 * file the scan never opened.
 *
 * A framework that streams reaches the transport from its own scheduler with no repository frame on the
 * stack at any bound. Three of eight Node cases measured, `ai`'s `streamText` in both spellings and
 * `@openai/agents` with `stream: true`, put nothing of the caller's on the stack, while the same
 * frameworks non-streamed put it at index 16 and 13.
 *
 * A third limit is not a population of repositories: this is Node only. Python has no `fetch` to patch,
 * and `openai` 3.3.1 sends through `httpx2` rather than `httpx`, so a Python transport list would be a
 * catalogue that has already decayed once inside one vendor's own SDK.
 */

/**
 * How far out the walk goes, which is a ceiling on work rather than a place to look.
 *
 * Twenty is chosen on measured reach: a bound of five finds the repository's own frame through one of
 * four Node stacks, ten through two, and twenty through all four, including `ai` over `@ai-sdk/openai`
 * at index 16 and `@openai/agents` at index 13. A framework's own machinery is about a dozen frames and
 * that is what the bound has to be able to cross.
 */
const MAX_FRAMES = 20;

/** Beyond this many distinct files a run has stopped identifying call sites and started walking a tree. */
const MAX_TRACKED_FILES = 512;

const GIT_TIMEOUT_MS = 3_000;
const MAX_GIT_OUTPUT = 64 * 1024;

/** Source files are read to be hashed, and a file this large is not one somebody wrote by hand. */
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

export type SourceFrame = {
  /** Absolute real path, which OpenTelemetry defines `code.file.path` as. */
  readonly absoluteFile: string;
  /** Path relative to the repository that tracks the file, which is the form the join compares. */
  readonly repositoryFile: string;
  /** Path relative to the audited repository, present only when the file is inside it. */
  readonly auditFile?: string;
  readonly line?: number;
  readonly functionName?: string;
  /** sha256 of the file as it was when the call was made, so staleness is detectable per file. */
  readonly digest?: string;
  readonly repositoryUrl?: string;
  readonly revision?: string;
};

const git = (directory: string, ...args: readonly string[]): string | undefined => {
  try {
    const output = execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_GIT_OUTPUT,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    }).trim();
    return output.length === 0 ? undefined : output;
  } catch {
    return undefined;
  }
};

/**
 * The absolute real path a frame names, or nothing.
 *
 * `getCallSites` reports a `file:` URL for a module loaded as ESM and a bare path for one loaded as
 * CommonJS, so the discriminator is the module system rather than the location and both spellings have
 * to be handled. Everything else a frame can name is refused by construction: a `node:` builtin, an
 * `eval` wrapper, a synthetic `<anonymous>`, and anything that does not resolve to a file on disk.
 */
const absoluteFrameFile = (scriptName: unknown): string | undefined => {
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

/** A repository-relative path the join can compare: forward slashes, no traversal, no empty segment. */
const relativeInside = (root: string, absoluteFile: string): string | undefined => {
  const path = relative(root, absoluteFile).split(sep).join('/');
  if (path.length === 0 || path.startsWith('../') || path === '..') return undefined;
  if (path.includes('\0') || path.includes('\n')) return undefined;
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return undefined;
  }
  return path;
};

const canonicalRepositoryUrl = (value: string): string | undefined => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
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

/**
 * What a repository can say about itself, read once and kept.
 *
 * The pin is optional and its absence is ordinary. A working tree mid-edit has no immutable revision to
 * report and that is exactly the tree most audits run against, so the pin is what a clean checkout adds
 * rather than what every repository must have. `dirty` is answered rather than assumed because the
 * consuming end refuses a pinned coordinate from a tree that had moved, and reporting one anyway would
 * produce a coordinate that can only ever be refused.
 */
type Repository = {
  readonly root: string;
  readonly repositoryUrl?: string;
  readonly revision?: string;
};

/**
 * Whether the tree has uncommitted changes, asked separately because empty output is the answer.
 *
 * `git` above collapses an empty result and a failed command into the same `undefined`, which is right
 * for a value and wrong for a question whose affirmative answer is silence. Reading a failure as a clean
 * tree would attach an immutable revision to source that had moved.
 */
const checkoutIsClean = (root: string): boolean => {
  try {
    const output = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain', '--untracked-files=no'],
      {
        encoding: 'utf8',
        maxBuffer: MAX_GIT_OUTPUT,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    return output.trim().length === 0;
  } catch {
    return false;
  }
};

const readRepository = (root: string): Repository => {
  const revision = git(root, 'rev-parse', 'HEAD');
  const immutable =
    revision !== undefined && /^[0-9a-f]{40}$/.test(revision) ? revision : undefined;
  const clean = checkoutIsClean(root);
  const remote = git(root, 'remote', 'get-url', 'origin');
  const url = remote === undefined ? undefined : canonicalRepositoryUrl(remote);
  if (!clean || immutable === undefined || url === undefined) return { root };
  return { root, repositoryUrl: url, revision: immutable };
};

export type SourceFrameReader = {
  readonly capture: () => SourceFrame | undefined;
  /** The digest of a file already captured, computed once and kept. */
  readonly digestOf: (absoluteFile: string) => string | undefined;
};

/**
 * A reader bound to one audited repository, holding what it has already learned.
 *
 * Every answer is memoised by the path it was asked about, because a run calls the same handful of lines
 * many times and the questions underneath are subprocesses and file reads. Nothing here is unbounded: the
 * memo stops accepting new files at a ceiling, and past it the reader reports no location rather than
 * growing inside somebody else's process.
 */
export const createSourceFrameReader = (options: {
  readonly repositoryRoot: string;
  /**
   * The directory the shim itself was loaded from, whose frames are the boundary rather than the caller.
   *
   * A directory rather than a list of files because the shim is one bundle in an installed build and
   * several modules in a source checkout, and because the case that matters is auditing a repository
   * that contains this code: its own files are tracked there, so without this the frame that reached the
   * transport would be reported as the call site.
   */
  readonly instrumentationRoot?: string;
}): SourceFrameReader => {
  const auditRoot = (() => {
    try {
      return realpathSync(resolve(options.repositoryRoot));
    } catch {
      return undefined;
    }
  })();
  const instrumentationRoot = (() => {
    if (options.instrumentationRoot === undefined) return undefined;
    try {
      return realpathSync(options.instrumentationRoot);
    } catch {
      return undefined;
    }
  })();
  const isInstrumentation = (absoluteFile: string): boolean =>
    instrumentationRoot !== undefined &&
    (absoluteFile === instrumentationRoot ||
      absoluteFile.startsWith(`${instrumentationRoot}${sep}`));

  const repositoryByDirectory = new Map<string, Repository | undefined>();
  const trackedByFile = new Map<string, Repository | undefined>();
  const digestByFile = new Map<string, string | undefined>();

  const repositoryOf = (directory: string): Repository | undefined => {
    const known = repositoryByDirectory.get(directory);
    if (known !== undefined || repositoryByDirectory.has(directory)) return known;
    const toplevel = git(directory, 'rev-parse', '--show-toplevel');
    let repository: Repository | undefined;
    if (toplevel !== undefined) {
      try {
        const root = realpathSync(toplevel);
        if (statSync(root).isDirectory()) repository = readRepository(root);
      } catch {
        repository = undefined;
      }
    }
    repositoryByDirectory.set(directory, repository);
    return repository;
  };

  /** The repository that tracks this file, which is the whole of "is this frame the repository's own". */
  const trackingRepository = (absoluteFile: string): Repository | undefined => {
    if (trackedByFile.has(absoluteFile)) return trackedByFile.get(absoluteFile);
    if (trackedByFile.size >= MAX_TRACKED_FILES) return undefined;
    const repository = repositoryOf(dirname(absoluteFile));
    const path =
      repository === undefined ? undefined : relativeInside(repository.root, absoluteFile);
    const tracked =
      repository !== undefined &&
      path !== undefined &&
      git(repository.root, 'ls-files', '--error-unmatch', '--', path) !== undefined;
    const answer = tracked ? repository : undefined;
    trackedByFile.set(absoluteFile, answer);
    return answer;
  };

  const digestOf = (absoluteFile: string): string | undefined => {
    if (digestByFile.has(absoluteFile)) return digestByFile.get(absoluteFile);
    if (digestByFile.size >= MAX_TRACKED_FILES) return undefined;
    let digest: string | undefined;
    try {
      if (statSync(absoluteFile).size <= MAX_SOURCE_BYTES) {
        digest = createHash('sha256').update(readFileSync(absoluteFile)).digest('hex');
      }
    } catch {
      digest = undefined;
    }
    digestByFile.set(absoluteFile, digest);
    return digest;
  };

  const frameOf = (absoluteFile: string, frame: unknown): SourceFrame | undefined => {
    const repository = trackingRepository(absoluteFile);
    if (repository === undefined) return undefined;
    const repositoryFile = relativeInside(repository.root, absoluteFile);
    if (repositoryFile === undefined) return undefined;
    const site = frame as { lineNumber?: unknown; functionName?: unknown };
    const line =
      typeof site.lineNumber === 'number' &&
      Number.isInteger(site.lineNumber) &&
      site.lineNumber >= 1
        ? site.lineNumber
        : undefined;
    const functionName =
      typeof site.functionName === 'string' && site.functionName.length > 0
        ? site.functionName
        : undefined;
    const auditFile = auditRoot === undefined ? undefined : relativeInside(auditRoot, absoluteFile);
    return {
      absoluteFile,
      repositoryFile,
      ...(auditFile === undefined ? {} : { auditFile }),
      ...(line === undefined ? {} : { line }),
      ...(functionName === undefined ? {} : { functionName }),
      ...(repository.repositoryUrl === undefined
        ? {}
        : { repositoryUrl: repository.repositoryUrl }),
      ...(repository.revision === undefined ? {} : { revision: repository.revision }),
    };
  };

  return {
    digestOf,
    capture: () => {
      if (auditRoot === undefined) return undefined;
      try {
        for (const frame of getCallSites(MAX_FRAMES)) {
          const absoluteFile = absoluteFrameFile((frame as { scriptName?: unknown }).scriptName);
          if (absoluteFile === undefined || isInstrumentation(absoluteFile)) continue;
          const found = frameOf(absoluteFile, frame);
          if (found !== undefined) return found;
        }
      } catch {
        // A process must not fail on account of being watched.
      }
      return undefined;
    },
  };
};
