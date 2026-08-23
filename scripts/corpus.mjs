/**
 * Runs discovery across the pinned corpus and holds the numbers.
 *
 * Every adapter in this repository was validated against a fixture written by whoever wrote the adapter, which is
 * circular. This is the other half: real repositories, pinned at a commit, with what a scan produces committed
 * beside them. The expectation is never rewritten by a check. A difference is printed and the run fails, so that
 * changing one is a reviewed diff, and that diff is the drift alarm: when a framework moves and an adapter goes
 * quiet, this is what says so.
 *
 *   node scripts/corpus.mjs --check              every entry, cloning what the cache is missing
 *   node scripts/corpus.mjs --check --offline    only the entries that need no network
 *   node scripts/corpus.mjs --check --required   local entries plus bounded digest-pinned archives
 *   node scripts/corpus.mjs --check --exercise   also run the entries that can produce spans, and join the delta
 *   node scripts/corpus.mjs --record <name>...   rewrite expectations, to be read before committing
 */

import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceVerdict } from './corpus/acceptance.mjs';
import { auditRepository, clearStoredState } from './corpus/audit.mjs';
import { cacheDirectory, checkout } from './corpus/checkout.mjs';
import { claimDifference, differences } from './corpus/comparison.mjs';
import { isOffline, isRequired, readCorpusDocument } from './corpus/definition.mjs';
import { exerciseRepository, missingInterpreter, prepareEnvironment } from './corpus/exercise.mjs';
import { describeFederation, exerciseFederatedSystem } from './corpus/federation.mjs';
import { injectionVerdicts } from './corpus/negatives.mjs';
import { observationOf } from './corpus/observation.mjs';
import { describe } from './corpus/summary.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { stableJson } = await import(join(root, 'packages/domain/src/index.ts'));

const argv = process.argv.slice(2);
const record = argv.includes('--record');
const offline = argv.includes('--offline');
const required = argv.includes('--required');
const exercise = argv.includes('--exercise');
const selected = argv.filter((argument) => !argument.startsWith('--'));

if (record && argv.includes('--check')) {
  console.error('--check and --record ask for opposite things. Pass one.');
  process.exit(2);
}
if (offline && required) {
  console.error('--offline and --required select different acquisition boundaries. Pass one.');
  process.exit(2);
}

/**
 * One run at a time, because two runs share the checkouts they measure.
 *
 * Every entry is scanned in place: stored state is cleared inside the checkout before the audit, and the
 * shapes crossed with a repository that is not an agent system are written into it and removed after. Two
 * runs at once therefore measure each other. It is not theoretical, and it does not fail loudly on its own:
 * a full run overlapping the offline one the gate performs reported `mcp_server:docs` declared by an
 * injection that declares no server, because the other run's `.mcp.json` was on disk at the time, and
 * reported a second shape as never reaching a reader because the other run had already removed it. Both
 * read as this build being wrong about a repository.
 *
 * A held lock names the process holding it, and a lock whose process is gone is taken over rather than left
 * to be deleted by hand after a run is interrupted.
 */
const lockPath = join(cacheDirectory(root), 'run.lock');

const takeLock = () => {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (const attempt of [1, 2]) {
    try {
      const handle = openSync(lockPath, 'wx');
      writeFileSync(handle, `${process.pid}\n`);
      return () => {
        rmSync(lockPath, { force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt === 2) throw error;
      const holder = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
      try {
        process.kill(holder, 0);
        console.error(
          `another corpus run is in progress as process ${holder}. Two runs measure each other, because both scan the pinned checkouts in place.`,
        );
        process.exit(2);
      } catch {
        rmSync(lockPath, { force: true });
      }
    }
  }
  throw new Error('the corpus lock could not be taken');
};

const releaseLock = takeLock();
process.once('exit', releaseLock);

const expectationPath = (name) => join(root, 'corpus/expected', `${name}.json`);
const federationExpectationPath = (name) =>
  join(root, 'corpus/expected', `${name}.federation.json`);

const readExpectationAt = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

const corpus = readCorpusDocument(root);
const allEntries = corpus.repositories;
const entries = allEntries.filter(
  (entry) =>
    (!offline || isOffline(entry)) &&
    (!required || isRequired(entry)) &&
    (selected.length === 0 || selected.includes(entry.name)),
);
const systems =
  offline || required
    ? []
    : corpus.multiRepositorySystems.filter(
        (system) => selected.length === 0 || selected.includes(system.name),
      );
if (entries.length === 0 && systems.length === 0) {
  console.error('no corpus entry matched');
  process.exit(2);
}

const results = [];
for (const entry of entries) {
  /*
   * An entry that exercises itself is measured with its run in the graph, so it cannot also be measured without one:
   * a stored run adds components and relations, and one expectation cannot describe both. It is skipped with the
   * reason printed rather than compared against half of what it records.
   */
  if (entry.exercise !== undefined && !exercise) {
    results.push({
      entry,
      skipped: 'needs --exercise, which installs an environment and runs the repository',
    });
    continue;
  }
  /*
   * A credential this machine does not have is a skip and not a failure. Two of these entries are hermetic and one
   * reaches a provider, so a contributor running the full corpus without a key has to be told which entry went
   * unmeasured and why, rather than reading a stack trace out of somebody else's SDK.
   */
  const missing = (entry.exercise?.requiresEnvironment ?? []).filter(
    (name) => (process.env[name] ?? '') === '',
  );
  if (missing.length > 0) {
    results.push({
      entry,
      skipped: `needs ${missing.join(' and ')} in the environment, which this run reaches a provider with`,
    });
    continue;
  }
  /*
   * An interpreter this machine does not have is a skip for the same reason. The framework a checkout pins declares
   * which Python versions it installs under, and building the environment from a newer one resolves the framework
   * back to a release that predates everything the entry measures rather than failing.
   */
  const absent = exercise ? missingInterpreter(entry) : undefined;
  if (absent !== undefined) {
    results.push({
      entry,
      skipped: `needs ${absent} on the path, which is the interpreter the framework this entry pins installs under`,
    });
    continue;
  }
  try {
    const acquisition = offline ? 'offline' : required ? 'required_archive' : 'git';
    const directory = await checkout(root, entry, acquisition);
    clearStoredState(directory);
    const exercised =
      entry.exercise === undefined
        ? undefined
        : exerciseRepository(root, entry, directory, prepareEnvironment(root, entry, directory));
    const { audit, bundle } = auditRepository(root, entry.name, directory);
    const observation = observationOf(entry, audit, bundle, exercised);
    const acceptance = acceptanceVerdict(entry, bundle);
    const expected = readExpectationAt(expectationPath(entry.name));
    const found = [
      ...(expected === undefined
        ? [{ path: '', expected: 'a recorded expectation', observed: 'no file' }]
        : differences(expected, observation)),
      ...[claimDifference(entry, observation)].filter(Boolean),
    ];
    /*
     * The injection table runs on every entry pinned as not an agent system, in both modes. It holds an
     * invariant rather than a number, so there is nothing for `--record` to write and no reason to skip it
     * while recording: a recording run that stopped checking precision would be the one run where a shape
     * could get through.
     */
    const injections =
      entry.kind === 'not_agent_system'
        ? injectionVerdicts(root, entry, directory, observation)
        : [];
    results.push({ entry, observation, differences: found, injections, acceptance });
  } catch (error) {
    results.push({ entry, error: error instanceof Error ? error.message : String(error) });
  }
}

const entryByName = new Map(allEntries.map((entry) => [entry.name, entry]));
const federationResults = [];
for (const system of systems) {
  if (system.exercise === undefined) {
    federationResults.push({
      system,
      error: 'has no exercise that can test its crossing evidence',
    });
    continue;
  }
  if (!exercise) {
    federationResults.push({
      system,
      skipped: 'needs --exercise, which runs both pinned repositories and their protocol crossing',
    });
    continue;
  }
  const missing = (system.exercise.requiresEnvironment ?? []).filter(
    (name) => (process.env[name] ?? '') === '',
  );
  if (missing.length > 0) {
    federationResults.push({
      system,
      skipped: `needs ${missing.join(' and ')} in the environment, which this run reaches a provider with`,
    });
    continue;
  }
  try {
    const repositoryDirectories = [];
    for (const coordinate of system.repositories) {
      const entry = entryByName.get(coordinate.name);
      if (entry === undefined)
        throw new Error(`repository ${coordinate.name} is not a corpus entry`);
      repositoryDirectories.push(await checkout(root, entry, 'git'));
    }
    const runtimeIndex = system.repositories.findIndex(
      (coordinate) => coordinate.name === system.exercise.runtimeRepository,
    );
    const runtimeDirectory = repositoryDirectories[runtimeIndex];
    if (runtimeDirectory === undefined) throw new Error('the runtime repository has no checkout');
    clearStoredState(runtimeDirectory);
    const environment = prepareEnvironment(root, system, runtimeDirectory);
    const observation = exerciseFederatedSystem(root, system, repositoryDirectories, environment);
    const expected = readExpectationAt(federationExpectationPath(system.name));
    const found =
      expected === undefined
        ? [{ path: '', expected: 'a recorded expectation', observed: 'no file' }]
        : differences(expected, observation);
    federationResults.push({ system, observation, differences: found });
  } catch (error) {
    federationResults.push({
      system,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let differing = 0;
let failed = 0;
let skipped = 0;
let broken = 0;
let acceptanceBroken = 0;

/**
 * An injection that broke an invariant is printed with the shape, the file and the sentence, and one that
 * held is printed as a count. A row is a failure log entry, so a reader who sees the count go up wants to
 * know which shapes are being held rather than reading six lines saying nothing happened.
 */
const describeInjections = (injections) => {
  const failures = injections.filter((injection) => injection.broken.length > 0);
  const lines = [
    `  injections    ${injections.length - failures.length}/${injections.length} shapes held`,
  ];
  for (const injection of failures) {
    for (const sentence of injection.broken) {
      lines.push(`    ${injection.injection} (${injection.file}): ${sentence}`);
    }
  }
  return lines;
};

for (const result of results) {
  console.log('');
  if (result.skipped !== undefined) {
    skipped += 1;
    console.log(`${result.entry.name}  not measured: ${result.skipped}`);
    continue;
  }
  if (result.error !== undefined) {
    failed += 1;
    console.log(`${result.entry.name}  could not be measured`);
    console.log(`  ${result.error.split('\n').join('\n  ')}`);
    continue;
  }
  for (const line of describe(result.observation)) console.log(line);
  if (result.injections.length > 0) {
    for (const line of describeInjections(result.injections)) console.log(line);
    if (result.injections.some((injection) => injection.broken.length > 0)) broken += 1;
  }
  if (result.acceptance.total > 0) {
    console.log(
      `  acceptance    ${result.acceptance.held}/${result.acceptance.total} semantic assertions held`,
    );
    for (const sentence of result.acceptance.broken) console.log(`    ${sentence}`);
    if (result.acceptance.broken.length > 0) acceptanceBroken += 1;
  }
  if (record) {
    mkdirSync(dirname(expectationPath(result.entry.name)), { recursive: true });
    writeFileSync(expectationPath(result.entry.name), `${stableJson(result.observation)}\n`, {
      mode: 0o644,
    });
    console.log(`  recorded      corpus/expected/${result.entry.name}.json`);
    continue;
  }
  if (result.differences.length === 0) {
    console.log('  expectation   matched');
    continue;
  }
  differing += 1;
  console.log(`  expectation   ${result.differences.length} difference(s)`);
  for (const difference of result.differences) {
    const where = difference.path === '' ? 'the expectation' : difference.path;
    console.log(`    ${where}: expected ${difference.expected}, observed ${difference.observed}`);
  }
}

let federationDiffering = 0;
let federationFailed = 0;
let federationSkipped = 0;
for (const result of federationResults) {
  console.log('');
  if (result.skipped !== undefined) {
    federationSkipped += 1;
    console.log(`${result.system.name}  not measured: ${result.skipped}`);
    continue;
  }
  if (result.error !== undefined) {
    federationFailed += 1;
    console.log(`${result.system.name}  could not be measured`);
    console.log(`  ${result.error.split('\n').join('\n  ')}`);
    continue;
  }
  for (const line of describeFederation(result.observation)) console.log(line);
  if (record) {
    const path = federationExpectationPath(result.system.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${stableJson(result.observation)}\n`, { mode: 0o644 });
    console.log(`  recorded      corpus/expected/${result.system.name}.federation.json`);
    continue;
  }
  if (result.differences.length === 0) {
    console.log('  expectation   matched');
    continue;
  }
  federationDiffering += 1;
  console.log(`  expectation   ${result.differences.length} difference(s)`);
  for (const difference of result.differences) {
    const where = difference.path === '' ? 'the expectation' : difference.path;
    console.log(`    ${where}: expected ${difference.expected}, observed ${difference.observed}`);
  }
}

const summaryPath = join(cacheDirectory(root), 'corpus-summary.json');
mkdirSync(dirname(summaryPath), { recursive: true });
writeFileSync(
  summaryPath,
  `${stableJson({
    offline,
    recorded: record,
    repositories: results.map((result) => ({
      name: result.entry.name,
      kind: result.entry.kind,
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
      ...(result.error === undefined && result.skipped === undefined
        ? {
            observation: result.observation,
            differences: result.differences ?? [],
            injections: result.injections ?? [],
            acceptance: result.acceptance,
          }
        : {}),
      ...(result.error === undefined ? {} : { error: result.error }),
    })),
    federatedSystems: federationResults.map((result) => ({
      name: result.system.name,
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
      ...(result.error === undefined && result.skipped === undefined
        ? { observation: result.observation, differences: result.differences ?? [] }
        : {}),
      ...(result.error === undefined ? {} : { error: result.error }),
    })),
  })}\n`,
  { mode: 0o644 },
);

console.log('');
const subset = offline ? ' (offline subset)' : required ? ' (required subset)' : '';
console.log(
  `${results.length} repositor${results.length === 1 ? 'y' : 'ies'}${subset}: ` +
    `${results.length - differing - failed - skipped} ${record ? 'recorded' : 'matched'}, ${differing} differing, ` +
    `${failed} not measured, ${skipped} skipped`,
);
const accepted = results.reduce((total, result) => total + (result.acceptance?.total ?? 0), 0);
if (accepted > 0) {
  const acceptanceFailures = results.reduce(
    (total, result) => total + (result.acceptance?.broken.length ?? 0),
    0,
  );
  console.log(
    `${accepted} semantic acceptance assertion(s): ${accepted - acceptanceFailures} held, ${acceptanceFailures} broke`,
  );
}
const injected = results.reduce((total, result) => total + (result.injections?.length ?? 0), 0);
console.log(
  `${injected} injected shape(s) across the repositories that are not agent systems: ${injected - results.reduce((total, result) => total + (result.injections ?? []).filter((injection) => injection.broken.length > 0).length, 0)} held, ${broken} repositor${broken === 1 ? 'y' : 'ies'} broke one`,
);
if (federationResults.length > 0) {
  console.log(
    `${federationResults.length} federated system${federationResults.length === 1 ? '' : 's'}: ` +
      `${federationResults.length - federationDiffering - federationFailed - federationSkipped} ${record ? 'recorded' : 'matched'}, ` +
      `${federationDiffering} differing, ${federationFailed} not measured, ${federationSkipped} skipped`,
  );
}
console.log(`summary written to ${summaryPath.slice(root.length + 1)}`);

if (record) {
  console.log('');
  console.log('Read the diff before committing it. A number that moved is a fix or a regression,');
  console.log('and this script cannot tell you which.');
}

/*
 * A broken invariant fails a recording run too. `--record` rewrites what a scan produced and cannot rewrite
 * this, which is the whole point of holding it here rather than in an expectation.
 */
const measurementFailed = failed > 0 || federationFailed > 0;
const expectationMoved = differing > 0 || federationDiffering > 0;
process.exit(
  broken > 0 || acceptanceBroken > 0 || measurementFailed ? 1 : expectationMoved && !record ? 1 : 0,
);
