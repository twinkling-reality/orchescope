import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRedactor } from '@orchescope/redaction';

/**
 * Commands a repository already declares for starting itself.
 *
 * `orchescope trace -- '<the command that starts your system>'` is the one argv in the loop a caller cannot
 * execute, and a scenario is where that command is meant to be written down once. Nothing here invents one:
 * these are read out of files the repository wrote, offered as comments beside the placeholder, and each
 * carries the file and the line it came from so a reader can check it rather than trust it.
 *
 * **None of them is ever run.** A `start` script is often a server that never exits, which is why a scenario
 * carries a timeout and a stop signal at all, and the difference between offering a command and executing a
 * guess is the whole of the refusal this replaces.
 *
 * The line number is found rather than counted: a candidate whose declaring line cannot be located is left
 * out, because a citation that points at the wrong line is worse than no citation.
 */

export type StartCommandCandidate = {
  /** As the repository wrote it, redacted, and never split into an argv here. */
  readonly command: string;
  readonly file: string;
  readonly line: number;
};

/**
 * Enough to show a reader the shapes their repository declares, and few enough to read at a glance. A
 * repository that declares more than this has more than one way to start and none of them is more true than
 * the others, so the list stops rather than guessing which to keep.
 */
const MAX_CANDIDATES = 8;

const readText = (root: string, relativePath: string): string | undefined => {
  try {
    return readFileSync(join(root, relativePath), 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * The 1 based line a JSON key is declared on, from the raw text, so the citation points where a reader looks.
 *
 * Matched anywhere in the line rather than at the start of one, because a manifest is free to write its
 * whole `scripts` object inline and an anchored search finds nothing there. The quote before the name is
 * what keeps it a key: `"restart": "npm run start"` contains neither `"start":` nor a false citation.
 */
const lineOfJsonKey = (text: string, key: string): number | undefined => {
  const declared = `"${key}"`;
  for (const [index, line] of text.split('\n').entries()) {
    const at = line.indexOf(declared);
    if (at >= 0 && /^\s*:/.test(line.slice(at + declared.length))) return index + 1;
  }
  return undefined;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const NODE_SCRIPTS = ['start', 'dev'] as const;

const fromPackageJson = (root: string): readonly StartCommandCandidate[] => {
  const text = readText(root, 'package.json');
  if (text === undefined) return [];
  let scripts: Record<string, unknown> | undefined;
  try {
    scripts = asRecord(asRecord(JSON.parse(text))?.['scripts']);
  } catch {
    // A manifest this build cannot parse declares nothing it can offer, and the audit reports it elsewhere.
    return [];
  }
  if (scripts === undefined) return [];
  const found: StartCommandCandidate[] = [];
  for (const name of NODE_SCRIPTS) {
    const script = scripts[name];
    if (typeof script !== 'string' || script.trim().length === 0) continue;
    const line = lineOfJsonKey(text, name);
    if (line === undefined) continue;
    found.push({ command: `npm run ${name}`, file: 'package.json', line });
  }
  return found;
};

/**
 * `[project.scripts]` names console entry points a wheel installs, so the command is the name rather than
 * the module path beside it. Read from the raw text rather than a TOML parser, because this package reads no
 * TOML anywhere else and one key of one table does not earn a dependency.
 */
const fromPyProject = (root: string): readonly StartCommandCandidate[] => {
  const text = readText(root, 'pyproject.toml');
  if (text === undefined) return [];
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === '[project.scripts]');
  if (start < 0) return [];
  const found: StartCommandCandidate[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().startsWith('[')) break;
    const name = /^\s*"?([A-Za-z0-9_.-]+)"?\s*=/.exec(line)?.[1];
    if (name === undefined) continue;
    found.push({ command: name, file: 'pyproject.toml', line: index + 1 });
  }
  return found;
};

/** A Procfile declares one process type per line, and the whole of the line after the colon is the command. */
const fromProcfile = (root: string): readonly StartCommandCandidate[] => {
  const text = readText(root, 'Procfile');
  if (text === undefined) return [];
  const found: StartCommandCandidate[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    const parsed = /^\s*([A-Za-z0-9_-]+)\s*:\s*(\S.*)$/.exec(line);
    if (parsed?.[2] === undefined) continue;
    found.push({ command: parsed[2].trim(), file: 'Procfile', line: index + 1 });
  }
  return found;
};

/**
 * A declared command is repository text and may carry a credential inline, so it is redacted before it is
 * written back out. Redaction is never described as a guarantee: a pattern set cannot prove the absence of
 * a secret, which is one more reason these arrive as comments a person reads rather than as an argv.
 */
export const startCommandCandidates = (root: string): readonly StartCommandCandidate[] => {
  const redactor = createRedactor();
  return [...fromPackageJson(root), ...fromPyProject(root), ...fromProcfile(root)]
    .slice(0, MAX_CANDIDATES)
    .map((candidate) => ({
      ...candidate,
      command: redactor.text(candidate.command).slice(0, 200),
    }));
};
