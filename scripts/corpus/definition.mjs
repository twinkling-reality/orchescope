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

const SUPPORTED_SCHEMA_VERSION = 2;
const NAME = /^[a-z][a-z0-9-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
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
  if (entry.subpath !== undefined) {
    if (
      typeof entry.subpath !== 'string' ||
      entry.subpath.length === 0 ||
      entry.subpath.startsWith('/') ||
      entry.subpath.endsWith('/') ||
      entry.subpath
        .split('/')
        .some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      problem('subpath has to name a normalized directory inside the pinned repository');
    }
  }
};

const checkRequiredArchive = (entry, problem) => {
  const archive = entry.requiredArchive;
  if (archive === undefined) return;
  if (!isRecord(archive)) {
    problem('requiredArchive has to be a mapping');
    return;
  }
  if (entry.exercise !== undefined) {
    problem('requiredArchive belongs to a static entry');
  }
  const clone =
    typeof entry.url === 'string'
      ? entry.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\.git$/)
      : undefined;
  const expectedUrl =
    clone === null || clone === undefined || typeof entry.commit !== 'string'
      ? undefined
      : `https://api.github.com/repos/${clone[1]}/${clone[2]}/tarball/${entry.commit}`;
  if (archive.url !== expectedUrl) {
    problem(
      'requiredArchive.url has to be the GitHub archive API URL for the exact clone and commit',
    );
  }
  if (typeof archive.treeSha256 !== 'string' || !SHA256.test(archive.treeSha256)) {
    problem('requiredArchive.treeSha256 has to be a lowercase SHA-256');
  }
  if (
    typeof archive.licensePath !== 'string' ||
    archive.licensePath.length === 0 ||
    archive.licensePath.startsWith('/') ||
    archive.licensePath.endsWith('/') ||
    archive.licensePath.includes('\\') ||
    archive.licensePath
      .split('/')
      .some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    problem('requiredArchive.licensePath has to name a normalized repository-relative file');
  }
  if (typeof archive.licenseSha256 !== 'string' || !SHA256.test(archive.licenseSha256)) {
    problem('requiredArchive.licenseSha256 has to be a lowercase SHA-256');
  }
};

const checkLocalSource = (entry, problem) => {
  if (typeof entry.path !== 'string' || entry.path.length === 0) {
    problem('path has to name a directory of this repository');
  } else if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
    problem('path has to be relative and inside this repository');
  }
  if (
    entry.url !== undefined ||
    entry.commit !== undefined ||
    entry.requiredArchive !== undefined
  ) {
    problem('url, commit and requiredArchive belong to a git entry');
  }
  if (entry.subpath !== undefined) problem('subpath belongs to a git entry');
};

const checkMultiRepositorySystem = (system, index, repositories, names, problems) => {
  const where =
    isRecord(system) && typeof system.name === 'string'
      ? system.name
      : `multi-repository system ${index + 1}`;
  const problem = (detail) => problems.push(`${where}: ${detail}`);
  if (!isRecord(system)) {
    problem('is not a mapping');
    return;
  }
  if (typeof system.name !== 'string' || !NAME.test(system.name)) {
    problem('name has to be lower case letters, digits and hyphens');
  } else if (names.has(system.name)) {
    problem('name is already used by another multi-repository system');
  } else {
    names.add(system.name);
  }
  for (const field of ['why', 'crossingEvidence', 'falsifier']) {
    if (typeof system[field] !== 'string' || system[field].trim().length === 0) {
      problem(`${field} has to state the evidence boundary`);
    }
  }
  if (!Array.isArray(system.repositories) || system.repositories.length < 2) {
    problem('repositories has to pin at least two repositories');
    return;
  }
  const referenced = new Set();
  for (const coordinate of system.repositories) {
    if (!isRecord(coordinate) || typeof coordinate.name !== 'string') {
      problem('every repository coordinate has to name a corpus entry');
      continue;
    }
    if (referenced.has(coordinate.name)) {
      problem(`repository ${coordinate.name} is repeated`);
      continue;
    }
    referenced.add(coordinate.name);
    const repository = repositories.get(coordinate.name);
    if (repository === undefined || repository.source !== 'git') {
      problem(`repository ${coordinate.name} is not a pinned git corpus entry`);
      continue;
    }
    if (coordinate.url !== repository.url || coordinate.commit !== repository.commit) {
      problem(`repository ${coordinate.name} does not repeat its exact corpus URL and commit`);
    }
  }
  checkMultiRepositoryExercise(system.exercise, referenced, problem);
};

/**
 * An exercise names a script and the environment that script needs.
 *
 * The two languages this build reads both have an agent framework with first class OpenTelemetry support, and a join
 * shown in one of them says nothing about the other, so an exercise is either a Python one or a Node one and declares
 * exactly one package list. A driver with no packages could not import the checkout it is meant to exercise.
 */
const checkExercise = (exercise, problem) => {
  if (exercise === undefined) return;
  if (!isRecord(exercise)) {
    problem('exercise has to be a mapping');
    return;
  }
  const python = exercise.pythonPackages !== undefined;
  const node = exercise.nodePackages !== undefined;
  if (python === node) {
    problem('exercise has to declare either pythonPackages or nodePackages, and not both');
  }
  const extension = python ? '.py' : '.mjs';
  if (typeof exercise.script !== 'string' || !exercise.script.endsWith(extension)) {
    problem(`exercise.script has to name a ${extension} file in this repository`);
  }
  const packages = python ? exercise.pythonPackages : exercise.nodePackages;
  if (
    !Array.isArray(packages) ||
    packages.length === 0 ||
    packages.some((name) => typeof name !== 'string')
  ) {
    problem(
      `exercise.${python ? 'pythonPackages' : 'nodePackages'} has to list what the environment needs, in install order`,
    );
  }
  if (typeof exercise.why !== 'string' || exercise.why.trim().length === 0) {
    problem('exercise.why has to say what this run is meant to show');
  }
  /*
   * The interpreter a checkout's framework will install under, where the machine's own `python3` is not one.
   *
   * CrewAI and its instrumentor both declare `requires-python <3.14`, and on a machine whose `python3` is 3.14 pip
   * resolves `crewai` down to 0.11.2 and then fails building a tiktoken that has no wheel for it. An environment
   * built from the wrong interpreter is worse than no environment: it installs a version four years older than the
   * one the entry is measuring and says nothing about it. Naming the interpreter is how the entry states the
   * constraint its framework declares, and a machine without that interpreter skips the entry with the reason
   * printed, the same way a missing credential does.
   */
  if (exercise.pythonInterpreter !== undefined) {
    if (!python) problem('exercise.pythonInterpreter belongs to a python entry');
    else if (
      typeof exercise.pythonInterpreter !== 'string' ||
      !/^python3(\.\d{1,2})?$/.test(exercise.pythonInterpreter)
    ) {
      problem('exercise.pythonInterpreter has to name a python3 executable, such as python3.12');
    }
  }
  /*
   * A credential the run needs is declared rather than discovered when the run fails without it.
   *
   * Two of these entries are hermetic: they drive their library's own offline model, so they need nothing and cost
   * nothing. An entry that reaches a provider cannot be either, and the difference has to be visible before the run
   * rather than in a stack trace after it, so the variables are named here and a run without them is skipped with
   * the reason printed.
   */
  if (exercise.requiresEnvironment !== undefined) {
    const names = exercise.requiresEnvironment;
    if (
      !Array.isArray(names) ||
      names.length === 0 ||
      names.some((name) => typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name))
    ) {
      problem(
        'exercise.requiresEnvironment has to name the environment variables the run cannot start without',
      );
    }
  }
};

const checkMultiRepositoryExercise = (exercise, referenced, problem) => {
  if (exercise === undefined) return;
  checkExercise(exercise, problem);
  if (exercise.pythonPackages !== undefined) {
    problem('a multi-repository exercise has to use a Node environment');
  }
  if (
    typeof exercise.runtimeRepository !== 'string' ||
    !referenced.has(exercise.runtimeRepository)
  ) {
    problem('exercise.runtimeRepository has to name one participating repository');
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
  checkExercise(entry.exercise, problem);
  if (entry.source === 'git') {
    checkGitSource(entry, problem);
    checkRequiredArchive(entry, problem);
  } else if (entry.source === 'local') checkLocalSource(entry, problem);
  else problem('source has to be git or local');
};

/** The validated definition, retaining composite systems separately from the repositories the runner scans. */
export const readCorpusDocument = (root) => {
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
  const multiRepositorySystems = document.multiRepositorySystems ?? [];
  if (!Array.isArray(multiRepositorySystems)) {
    problems.push('multiRepositorySystems has to be a list');
  } else {
    const repositories = new Map(
      document.repositories
        .filter((entry) => isRecord(entry) && typeof entry.name === 'string')
        .map((entry) => [entry.name, entry]),
    );
    const systemNames = new Set();
    for (const [index, system] of multiRepositorySystems.entries()) {
      checkMultiRepositorySystem(system, index, repositories, systemNames, problems);
    }
  }
  if (problems.length > 0) {
    throw new Error(`${path} is not usable:\n  ${problems.join('\n  ')}`);
  }
  return { repositories: document.repositories, multiRepositorySystems };
};

/** Entries are returned in file order, which is the order a reader sees them in the summary. */
export const readCorpus = (root) => readCorpusDocument(root).repositories;

export const readMultiRepositorySystems = (root) => readCorpusDocument(root).multiRepositorySystems;

/** The subset that needs no network. */
export const isOffline = (entry) => entry.source === 'local';

/** Local entries plus the bounded archive-backed third-party entries selected for required CI. */
export const isRequired = (entry) => isOffline(entry) || entry.requiredArchive !== undefined;
