import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Scenario } from '@orchescope/schema';
import { formatIssues } from '@orchescope/schema';
import { parseScenario } from './parse.ts';

/**
 * Scenario discovery on disk. This is the only part of the package that reads the filesystem.
 *
 * Traversal is where a hostile or merely confused repository can push an analyser somewhere it should not
 * go, so the rules are explicit: nothing outside the root is read, symbolic links are reported rather than
 * followed, and file size, directory depth and file count are all bounded. Problems are returned, never
 * thrown, so one unparseable file cannot hide the scenarios that are fine.
 */

const MAX_SCENARIO_BYTES = 256 * 1024;
const MAX_DEPTH = 8;
const MAX_FILES = 512;

export type ScenarioFile = { readonly scenario: Scenario; readonly path: string };

export type ScenarioProblem = { readonly file: string; readonly detail: string };

export type LoadedScenarios = {
  readonly scenarios: readonly ScenarioFile[];
  readonly problems: readonly ScenarioProblem[];
};

type Walker = {
  readonly scenarios: ScenarioFile[];
  readonly problems: ScenarioProblem[];
  readonly seen: Set<string>;
};

const detailOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'));

const isYamlFile = (name: string): boolean => name.endsWith('.yaml') || name.endsWith('.yml');

/** True when `candidate` resolves to the root itself or to something inside it. */
const insideRoot = (root: string, candidate: string): boolean => {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${sep}`);
};

const readScenarioFile = (absolutePath: string, relativePath: string, walker: Walker): void => {
  let byteLength: number;
  try {
    byteLength = statSync(absolutePath).size;
  } catch (error) {
    walker.problems.push({
      file: relativePath,
      detail: detailOf(error, 'the file could not be inspected'),
    });
    return;
  }
  if (byteLength > MAX_SCENARIO_BYTES) {
    walker.problems.push({
      file: relativePath,
      detail: `${byteLength} bytes exceeds the ${MAX_SCENARIO_BYTES} byte scenario limit`,
    });
    return;
  }
  let text: string;
  try {
    text = readFileSync(absolutePath, 'utf8');
  } catch (error) {
    walker.problems.push({
      file: relativePath,
      detail: detailOf(error, 'the file could not be read'),
    });
    return;
  }
  const parsed = parseScenario(text, relativePath);
  if (parsed.ok) walker.scenarios.push({ scenario: parsed.value, path: relativePath });
  else walker.problems.push({ file: relativePath, detail: formatIssues(parsed.issues) });
};

const readEntries = (root: string, directory: string, walker: Walker): readonly Dirent[] => {
  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return entries;
  } catch (error) {
    // An absent scenario directory is not a problem: a project simply has no scenarios there yet.
    if ((error as { code?: string }).code !== 'ENOENT') {
      walker.problems.push({
        file: toPosix(relative(root, directory)) || '.',
        detail: detailOf(error, 'the directory could not be read'),
      });
    }
    return [];
  }
};

/** Handles one directory entry and returns a subdirectory to descend into, when there is one. */
const visitEntry = (
  root: string,
  directory: string,
  entry: Dirent,
  walker: Walker,
): string | undefined => {
  const absolutePath = join(directory, entry.name);
  const relativePath = toPosix(relative(root, absolutePath));
  if (!insideRoot(root, absolutePath)) {
    walker.problems.push({ file: relativePath, detail: 'the path escapes the repository root' });
    return undefined;
  }
  if (entry.isSymbolicLink()) {
    walker.problems.push({ file: relativePath, detail: 'symbolic links are not followed' });
    return undefined;
  }
  if (entry.isDirectory()) return absolutePath;
  if (!entry.isFile() || !isYamlFile(entry.name)) return undefined;
  if (walker.seen.has(absolutePath)) return undefined;
  walker.seen.add(absolutePath);
  readScenarioFile(absolutePath, relativePath, walker);
  return undefined;
};

/** Breadth first traversal with an explicit queue, so depth is bounded by data rather than by the stack. */
const walkTree = (root: string, start: string, walker: Walker): void => {
  const queue: { readonly path: string; readonly depth: number }[] = [{ path: start, depth: 0 }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    if (next.depth > MAX_DEPTH || walker.seen.size >= MAX_FILES) continue;
    for (const entry of readEntries(root, next.path, walker)) {
      const child = visitEntry(root, next.path, entry, walker);
      if (child !== undefined) queue.push({ path: child, depth: next.depth + 1 });
    }
  }
};

/**
 * Loads every scenario under the given repository relative directories. Callers pass directories such as
 * `scenarios`; an absolute entry or one that climbs out of the root is refused as a problem rather than
 * silently resolved somewhere else.
 */
export const loadScenarios = (root: string, patterns: readonly string[]): LoadedScenarios => {
  const walker: Walker = { scenarios: [], problems: [], seen: new Set() };
  for (const pattern of patterns) {
    const directory = join(root, pattern);
    if (pattern.startsWith('/') || !insideRoot(root, directory)) {
      walker.problems.push({
        file: pattern,
        detail: 'scenario directories must be repository relative and inside the root',
      });
      continue;
    }
    walkTree(root, directory, walker);
  }
  return { scenarios: walker.scenarios, problems: walker.problems };
};
