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
 *   node scripts/corpus.mjs --check --exercise   also run the entries that can produce spans, and join the delta
 *   node scripts/corpus.mjs --record <name>...   rewrite expectations, to be read before committing
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRepository, clearStoredState } from './corpus/audit.mjs';
import { cacheDirectory, checkout } from './corpus/checkout.mjs';
import { claimDifference, differences } from './corpus/comparison.mjs';
import { isOffline, readCorpus } from './corpus/definition.mjs';
import { exerciseRepository, prepareEnvironment } from './corpus/exercise.mjs';
import { observationOf } from './corpus/observation.mjs';
import { describe } from './corpus/summary.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { stableJson } = await import(join(root, 'packages/domain/src/index.ts'));

const argv = process.argv.slice(2);
const record = argv.includes('--record');
const offline = argv.includes('--offline');
const exercise = argv.includes('--exercise');
const selected = argv.filter((argument) => !argument.startsWith('--'));

if (record && argv.includes('--check')) {
  console.error('--check and --record ask for opposite things. Pass one.');
  process.exit(2);
}

const expectationPath = (name) => join(root, 'corpus/expected', `${name}.json`);

const readExpectation = (name) => {
  try {
    return JSON.parse(readFileSync(expectationPath(name), 'utf8'));
  } catch {
    return undefined;
  }
};

const entries = readCorpus(root).filter(
  (entry) =>
    (!offline || isOffline(entry)) && (selected.length === 0 || selected.includes(entry.name)),
);
if (entries.length === 0) {
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
  try {
    const directory = checkout(root, entry, !offline);
    clearStoredState(directory);
    const exercised =
      entry.exercise === undefined
        ? undefined
        : exerciseRepository(root, entry, directory, prepareEnvironment(root, entry, directory));
    const { audit, bundle } = auditRepository(root, entry.name, directory);
    const observation = observationOf(entry, audit, bundle, exercised);
    const expected = readExpectation(entry.name);
    const found = [
      ...(expected === undefined
        ? [{ path: '', expected: 'a recorded expectation', observed: 'no file' }]
        : differences(expected, observation)),
      ...[claimDifference(entry, observation)].filter(Boolean),
    ];
    results.push({ entry, observation, differences: found });
  } catch (error) {
    results.push({ entry, error: error instanceof Error ? error.message : String(error) });
  }
}

let differing = 0;
let failed = 0;
let skipped = 0;
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
        ? { observation: result.observation, differences: result.differences ?? [] }
        : {}),
      ...(result.error === undefined ? {} : { error: result.error }),
    })),
  })}\n`,
  { mode: 0o644 },
);

console.log('');
console.log(
  `${results.length} repositor${results.length === 1 ? 'y' : 'ies'}${offline ? ' (offline subset)' : ''}: ` +
    `${results.length - differing - failed - skipped} ${record ? 'recorded' : 'matched'}, ${differing} differing, ` +
    `${failed} not measured, ${skipped} skipped`,
);
console.log(`summary written to ${summaryPath.slice(root.length + 1)}`);

if (record) {
  console.log('');
  console.log('Read the diff before committing it. A number that moved is a fix or a regression,');
  console.log('and this script cannot tell you which.');
}

process.exit(differing + failed > 0 && !record ? 1 : failed > 0 ? 1 : 0);
