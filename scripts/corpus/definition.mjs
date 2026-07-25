/**
 * Reads and validates `corpus/corpus.yaml`.
 *
 * The corpus file is the pinned list of repositories the harness measures, so a mistake in it is a mistake in the
 * measurement. Every field is checked here and every problem is collected before anything is reported, because a
 * reader fixing the file wants the whole list rather than the first line that failed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const SUPPORTED_SCHEMA_VERSION = 1;
const NAME = /^[a-z][a-z0-9-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const KINDS = ['agent_system', 'not_agent_system'];

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const checkIdentity = (entry, names, problem) => {
  if (typeof entry.name !== 'string' || !NAME.test(entry.name)) {
    problem('name has to be lower case letters, digits and hyphens');
  } else if (names.has(entry.name)) {
    problem('name is already used by another entry');
  } else {
    names.add(entry.name);
  }
  if (!KINDS.includes(entry.kind)) problem(`kind has to be one of ${KINDS.join(', ')}`);
  if (typeof entry.why !== 'string' || entry.why.trim().length === 0) {
    problem('why has to say what this entry is here to catch');
  }
};

const checkGitSource = (entry, problem) => {
  if (typeof entry.url !== 'string' || !entry.url.startsWith('https://')) {
    problem('url has to be an https clone URL');
  }
  if (typeof entry.commit !== 'string' || !COMMIT.test(entry.commit)) {
    problem('commit has to be a full forty character revision, because a branch is not a pin');
  }
  if (entry.path !== undefined) problem('path belongs to a local entry');
};

const checkLocalSource = (entry, problem) => {
  if (typeof entry.path !== 'string' || entry.path.length === 0) {
    problem('path has to name a directory of this repository');
  } else if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
    problem('path has to be relative and inside this repository');
  }
  if (entry.url !== undefined || entry.commit !== undefined) {
    problem('url and commit belong to a git entry');
  }
};

const checkEntry = (entry, index, names, problems) => {
  const where =
    isRecord(entry) && typeof entry.name === 'string' ? entry.name : `entry ${index + 1}`;
  const problem = (detail) => {
    problems.push(`${where}: ${detail}`);
  };

  if (!isRecord(entry)) {
    problem('is not a mapping');
    return;
  }
  checkIdentity(entry, names, problem);
  if (entry.source === 'git') checkGitSource(entry, problem);
  else if (entry.source === 'local') checkLocalSource(entry, problem);
  else problem('source has to be git or local');
};

/** Entries are returned in file order, which is the order a reader sees them in the summary. */
export const readCorpus = (root) => {
  const path = join(root, 'corpus/corpus.yaml');
  const document = parse(readFileSync(path, 'utf8'));
  if (!isRecord(document)) throw new Error(`${path} is not a mapping`);
  if (document.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `${path} declares schemaVersion ${document.schemaVersion}, and this build reads ${SUPPORTED_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(document.repositories) || document.repositories.length === 0) {
    throw new Error(`${path} has no repositories`);
  }

  const problems = [];
  const names = new Set();
  for (const [index, entry] of document.repositories.entries()) {
    checkEntry(entry, index, names, problems);
  }
  if (problems.length > 0) {
    throw new Error(`${path} is not usable:\n  ${problems.join('\n  ')}`);
  }
  return document.repositories;
};

/** The subset that needs no network, which is what the required gate runs. */
export const isOffline = (entry) => entry.source === 'local';
