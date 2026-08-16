import { createHash } from 'node:crypto';
import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { OrchescopeError } from '@orchescope/domain';
import type { SkippedFile } from '@orchescope/schema';
import { generationDetail, generationSignal } from './generated-code.ts';
import { type Language, languageOf } from './language.ts';

/**
 * Repository traversal.
 *
 * Traversal is the first place a hostile repository can attack an analyser, so the rules are explicit:
 * symbolic links are not followed unless the caller asks, nothing outside the root is read, files over
 * the size limit are skipped and reported rather than truncated, and the file count is bounded.
 */

export type SourceFile = {
  /** Repository relative POSIX path. */
  readonly path: string;
  readonly absolutePath: string;
  readonly language: Language;
  readonly byteLength: number;
};

export type FileSet = {
  readonly root: string;
  readonly files: readonly SourceFile[];
  readonly skipped: readonly SkippedFile[];
  readonly truncated: boolean;
  /**
   * Counts of every file extension seen during traversal, including languages Orchescope does not
   * analyse. This is what lets a scan say "this repository also contains Go" instead of presenting an
   * incomplete graph with no explanation.
   */
  readonly extensionCounts: Readonly<Record<string, number>>;
};

export type TraversalOptions = {
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly followSymlinks: boolean;
  /** Directory names never entered. Matched exactly against a path segment. */
  readonly excludeDirectories: readonly string[];
  /** Additional path prefixes to exclude, repository relative. */
  readonly excludePrefixes: readonly string[];
};

export const DEFAULT_EXCLUDED_DIRECTORIES: readonly string[] = [
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.orchescope',
  'target',
  'vendor',
  '.tox',
  '.idea',
  '.vscode-test',
  // Dependencies and derived output of the Apple toolchains, which a repository with a mobile or desktop surface in it
  // carries beside its own source. Walking Pods produced eight thousand skipped symbolic links on the first real
  // repository this was pointed at, and not one of them said anything about that repository.
  'Pods',
  '.build',
  'DerivedData',
  'Carthage',
  '.gradle',
];

export const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'));

const isExcluded = (relativePath: string, options: TraversalOptions): boolean =>
  options.excludePrefixes.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  );

type Walker = {
  readonly files: SourceFile[];
  readonly skipped: SkippedFile[];
  readonly extensionCounts: Map<string, number>;
  truncated: boolean;
};

const classifyEntry = (
  entry: Dirent,
  absolutePath: string,
  relativePath: string,
  options: TraversalOptions,
  walker: Walker,
): 'directory' | 'file' | 'skip' => {
  if (entry.isSymbolicLink()) {
    if (!options.followSymlinks) {
      walker.skipped.push({
        file: relativePath,
        reason: 'symlink',
        detail: 'symbolic links are not followed',
      });
      return 'skip';
    }
    try {
      return statSync(absolutePath).isDirectory() ? 'directory' : 'file';
    } catch {
      walker.skipped.push({
        file: relativePath,
        reason: 'unreadable',
        detail: 'broken symbolic link',
      });
      return 'skip';
    }
  }
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  walker.skipped.push({ file: relativePath, reason: 'unreadable', detail: 'not a regular file' });
  return 'skip';
};

/**
 * Records one file, or the reason it was not recorded.
 *
 * Every extension seen is counted whether or not the file is analysed, because the count of files in a language nothing
 * here can parse is what the coverage report needs in order to say what was not inspected.
 */
const considerFile = (
  name: string,
  absolutePath: string,
  relativePath: string,
  options: TraversalOptions,
  walker: Walker,
): void => {
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const extension = name.slice(dot).toLowerCase();
    walker.extensionCounts.set(extension, (walker.extensionCounts.get(extension) ?? 0) + 1);
  }

  const language = languageOf(name);
  if (language === 'other') return;

  let byteLength: number;
  try {
    byteLength = statSync(absolutePath).size;
  } catch (error) {
    walker.skipped.push({
      file: relativePath,
      reason: 'unreadable',
      detail: error instanceof Error ? error.message : 'stat failed',
    });
    return;
  }
  if (byteLength > options.maxFileBytes) {
    walker.skipped.push({
      file: relativePath,
      reason: 'too_large',
      detail: `${byteLength} bytes exceeds the ${options.maxFileBytes} byte limit`,
    });
    return;
  }

  walker.files.push({ path: relativePath, absolutePath, language, byteLength });
  if (walker.files.length >= options.maxFiles) {
    walker.truncated = true;
    walker.skipped.push({
      file: relativePath,
      reason: 'ignored',
      detail: `file limit of ${options.maxFiles} reached, traversal stopped`,
    });
  }
};

const walk = (root: string, current: string, options: TraversalOptions, walker: Walker): void => {
  if (walker.truncated) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch (error) {
    walker.skipped.push({
      file: toPosix(relative(root, current)) || '.',
      reason: 'unreadable',
      detail: error instanceof Error ? error.message : 'directory could not be read',
    });
    return;
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  for (const entry of entries) {
    if (walker.truncated) return;
    const absolutePath = join(current, entry.name);
    const relativePath = toPosix(relative(root, absolutePath));
    if (isExcluded(relativePath, options)) continue;

    const kind = classifyEntry(entry, absolutePath, relativePath, options, walker);
    if (kind === 'skip') continue;
    if (kind === 'directory') {
      if (options.excludeDirectories.includes(entry.name)) continue;
      walk(root, absolutePath, options, walker);
      continue;
    }

    considerFile(entry.name, absolutePath, relativePath, options, walker);
    if (walker.truncated) return;
  }
};

/**
 * How many skipped files are listed for each reason before the rest are counted instead.
 *
 * A coverage report that names every skipped file is unbounded output dressed as thoroughness: the first repository
 * outside the corpus that this was pointed at produced eight and a half thousand of them, all the same reason, all
 * inside a vendored dependency directory. What a reader needs is the reason, how many, and enough examples to
 * recognise them.
 *
 * This bounds what is listed and nothing else. Every count is taken from the full list first, because a limit that
 * reaches a number turns a display decision into a measurement, and this one did: bounding before counting took a
 * repository from 596 of 600 files parsed to 596 of 596, which reads as complete coverage and was a truncated list.
 */
const SKIPPED_SAMPLE_PER_REASON = 20;

export const boundSkipped = (skipped: readonly SkippedFile[]): readonly SkippedFile[] => {
  const shown = new Map<string, number>();
  const withheld = new Map<string, number>();
  const bounded: SkippedFile[] = [];
  for (const entry of skipped) {
    const seen = shown.get(entry.reason) ?? 0;
    if (seen < SKIPPED_SAMPLE_PER_REASON) {
      shown.set(entry.reason, seen + 1);
      bounded.push(entry);
      continue;
    }
    withheld.set(entry.reason, (withheld.get(entry.reason) ?? 0) + 1);
  }
  for (const [reason, count] of withheld) {
    bounded.push({
      file: '.',
      reason: reason as SkippedFile['reason'],
      detail: `${count} further file(s) were skipped for this reason and are not listed individually`,
    });
  }
  return bounded;
};

export const collectFiles = (root: string, options: TraversalOptions): FileSet => {
  const stats = statSync(root);
  if (!stats.isDirectory()) {
    throw new OrchescopeError('INVALID_ARGUMENT', 'The analysis root must be a directory.', {
      detail: { root },
    });
  }
  const walker: Walker = {
    files: [],
    skipped: [],
    extensionCounts: new Map(),
    truncated: false,
  };
  walk(root, root, options, walker);
  return {
    root,
    files: walker.files,
    skipped: walker.skipped,
    truncated: walker.truncated,
    extensionCounts: Object.fromEntries(walker.extensionCounts),
  };
};

export type FileContents = {
  readonly file: SourceFile;
  readonly text: string;
  /** SHA-256 of the raw bytes, used as the cache key and recorded on evidence. */
  readonly hash: string;
};

/**
 * Reads a file as UTF-8 and records its digest. A file containing a NUL byte in its first kilobyte is
 * treated as binary and rejected, because a mislabelled binary would otherwise reach a parser.
 *
 * Code a program wrote is set aside here for the same reason: this is the one point every analyser passes
 * through, so a decision made here holds for every adapter and every rule, including ones added later.
 */
export const readSource = (file: SourceFile): FileContents | SkippedFile => {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file.absolutePath);
  } catch (error) {
    return {
      file: file.path,
      reason: 'unreadable',
      detail: error instanceof Error ? error.message : 'read failed',
    };
  }
  const probe = bytes.subarray(0, 1024);
  if (probe.includes(0)) {
    return { file: file.path, reason: 'binary', detail: 'NUL byte within the first kilobyte' };
  }
  const text = bytes.toString('utf8');
  const signal = generationSignal(text, file.language);
  if (signal !== undefined) {
    return { file: file.path, reason: 'generated', detail: generationDetail(signal) };
  }
  return {
    file,
    text,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
};

export const isSkipped = (value: FileContents | SkippedFile): value is SkippedFile =>
  (value as SkippedFile).reason !== undefined;
