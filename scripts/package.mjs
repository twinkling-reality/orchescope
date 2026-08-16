/**
 * Builds a release candidate locally: stage the publishable unit, pack it, record its checksum, and verify it
 * installs and runs.
 *
 * The publishable unit is `release/stage`, not `apps/cli`. The workspace manifest depends on nine
 * `workspace:*` packages that are compiled into the bundle and never published, so publishing `apps/cli`
 * directly would put dependency names on the registry that nobody can install. The stage is left in place
 * after this script finishes, because it is the directory a maintainer publishes from.
 *
 * Nothing here publishes anything. Publication is a deliberate human action, so this script stops at producing
 * the artifact and the evidence that the artifact works.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDirectory = join(root, 'release');
const cliDirectory = join(root, 'apps/cli');

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });

rmSync(releaseDirectory, { recursive: true, force: true });
mkdirSync(releaseDirectory, { recursive: true });

console.log('building the publishable artifact');
run('node', [join(root, 'scripts/build.mjs')], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
});

console.log('staging the publishable manifest');
/**
 * The published package is a single bundled file, so its dependencies are only the packages the bundle keeps external.
 * The workspace packages are build inputs: they are compiled into the bundle and never published, and listing them
 * would make `npm install orchescope` try to fetch names that do not exist on the registry.
 */
const EXTERNAL_AT_RUNTIME = ['oxc-parser', 'tree-sitter-python', 'web-tree-sitter'];

const stage = join(releaseDirectory, 'stage');
mkdirSync(stage, { recursive: true });
const manifest = JSON.parse(readFileSync(join(cliDirectory, 'package.json'), 'utf8'));
const runtimeDependencies = {};
for (const name of EXTERNAL_AT_RUNTIME) {
  const version = manifest.dependencies?.[name];
  if (version === undefined) {
    throw new Error(`${name} is external at runtime but is not a dependency of apps/cli`);
  }
  runtimeDependencies[name] = version;
}
// Development dependencies and scripts describe how the artifact is built, not how it is used, so they are omitted
// rather than published.
const { devDependencies: _devDependencies, scripts: _scripts, ...rest } = manifest;
const published = { ...rest, dependencies: runtimeDependencies };
writeFileSync(join(stage, 'package.json'), `${JSON.stringify(published, null, 2)}\n`);
cpSync(join(cliDirectory, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
if (existsSync(join(root, 'README.md'))) cpSync(join(root, 'README.md'), join(stage, 'README.md'));

/**
 * The staged manifest is checked rather than trusted.
 *
 * A workspace range that survived staging is the failure this whole approach exists to prevent: it installs
 * from this repository and fails from the registry, which is the worst place to discover it.
 */
const stagedManifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'));
const stagingProblems = [];
for (const [name, range] of Object.entries(stagedManifest.dependencies ?? {})) {
  if (typeof range !== 'string' || range.startsWith('workspace:')) {
    stagingProblems.push(`${name} is declared as ${String(range)}, which no registry can resolve`);
  }
}
for (const field of ['devDependencies', 'scripts', 'peerDependencies', 'optionalDependencies']) {
  if (stagedManifest[field] !== undefined) {
    stagingProblems.push(`${field} should not reach the published manifest`);
  }
}
const binTarget = stagedManifest.bin?.orchescope;
if (typeof binTarget !== 'string') {
  stagingProblems.push('the published manifest declares no orchescope binary');
} else if (!existsSync(join(stage, binTarget))) {
  stagingProblems.push(`the declared binary ${binTarget} is not in the staged tree`);
}
for (const entry of stagedManifest.files ?? []) {
  if (!existsSync(join(stage, entry)))
    stagingProblems.push(`files lists ${entry}, which is absent`);
}
if (stagedManifest.engines?.node === undefined) {
  stagingProblems.push('the published manifest states no supported Node version');
}
if (stagingProblems.length > 0) {
  for (const problem of stagingProblems) console.error(`staging problem: ${problem}`);
  throw new Error('the staged manifest is not publishable');
}

console.log('packing the tarball');
const packOutput = run('npm', ['pack', '--pack-destination', releaseDirectory], { cwd: stage });
const tarballName = readdirSync(releaseDirectory).find((entry) => entry.endsWith('.tgz'));
if (tarballName === undefined) {
  console.error(packOutput);
  throw new Error('pnpm pack produced no tarball');
}
const tarballPath = join(releaseDirectory, tarballName);
const bytes = readFileSync(tarballPath);
const digest = createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(releaseDirectory, `${tarballName}.sha256`), `${digest}  ${tarballName}\n`);

console.log('inspecting the tarball contents');
const listing = run('tar', ['-tzf', tarballPath])
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => line.replace(/^package\//, ''));
const required = ['package.json', 'dist/orchescope.mjs', 'LICENSE'];
const missing = required.filter((entry) => !listing.includes(entry));

console.log('installing the tarball into a temporary prefix and auditing a project with it');
/**
 * The smoke test audits a real project rather than printing a version.
 *
 * The reason is the externals: the parsers resolve a native binding and a WebAssembly grammar relative to their own
 * package directories, and only an audit that actually parses a file proves those resolve from an installed tree. A
 * version string would pass even if every parser were unreachable.
 */
const sandbox = mkdtempSync(join(tmpdir(), 'orchescope-install-'));
let smoke = { ok: false, detail: 'not run' };
try {
  writeFileSync(
    join(sandbox, 'package.json'),
    `${JSON.stringify({ name: 'orchescope-install-check', private: true })}\n`,
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', tarballPath], { cwd: sandbox });

  // Declared after the install so that npm does not try to fetch it: the adapter only reads the declaration.
  writeFileSync(
    join(sandbox, 'package.json'),
    `${JSON.stringify({
      name: 'orchescope-install-check',
      private: true,
      dependencies: { '@openai/agents': '0.4.2' },
    })}\n`,
  );
  mkdirSync(join(sandbox, 'src'), { recursive: true });
  writeFileSync(
    join(sandbox, 'src/agent.ts'),
    [
      "import { Agent } from '@openai/agents';",
      '',
      "export const triage = new Agent({ name: 'triage', model: 'gpt-4.1-mini', instructions: 'Route the request to the right worker and answer briefly.' });",
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(sandbox, 'src/tool.py'),
    ['def issue_refund(order_id: str) -> str:', '    return f"refunded {order_id}"', ''].join('\n'),
  );

  const binary = join(sandbox, 'node_modules/.bin/orchescope');
  const version = run(binary, ['--version'], { cwd: sandbox }).trim();
  const audit = JSON.parse(run(binary, ['audit', '--json'], { cwd: sandbox }));
  const doctor = JSON.parse(run(binary, ['doctor', '--json'], { cwd: sandbox }));
  const failedChecks = doctor.data.checks.filter((check) => check.status === 'failed');
  const languages = audit.data.coverage.languages.map((entry) => entry.language ?? entry);

  smoke = {
    ok:
      version === published.version &&
      audit.ok === true &&
      audit.data.agentSystemDetected === true &&
      audit.data.summary.componentCount > 0 &&
      languages.includes('typescript') &&
      languages.includes('python') &&
      failedChecks.length === 0,
    detail:
      version !== published.version
        ? `the installed binary reports ${version}, and the manifest says ${published.version}`
        : failedChecks.length > 0
          ? `doctor reported a failed check: ${failedChecks.map((check) => check.name).join(', ')}`
          : `version ${version}, ${audit.data.summary.componentCount} component(s) discovered across ${languages.join(' and ')}`,
  };
} catch (error) {
  smoke = {
    ok: false,
    detail: error instanceof Error ? error.message.slice(0, 400) : 'unknown failure',
  };
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

const publishableUnit = relative(root, stage);

const summary = {
  tarball: tarballName,
  // The directory a maintainer publishes from. Publishing apps/cli would publish workspace ranges instead.
  publishableUnit,
  publishCommand: ['npm', 'publish'],
  publishedName: stagedManifest.name,
  publishedVersion: stagedManifest.version,
  publishedDependencies: Object.keys(runtimeDependencies),
  workspaceDependencies: Object.entries(stagedManifest.dependencies ?? {})
    .filter(([, range]) => String(range).startsWith('workspace:'))
    .map(([name]) => name),
  bytes: bytes.length,
  sha256: digest,
  fileCount: listing.length,
  missingRequiredFiles: missing,
  installSmokeTest: smoke,
  published: false,
};
writeFileSync(
  join(releaseDirectory, 'release-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);

console.log('');
console.log(`tarball           ${tarballName}`);
console.log(`size              ${(bytes.length / 1024).toFixed(0)} KiB`);
console.log(`sha256            ${digest}`);
console.log(`files             ${listing.length}`);
console.log(`dependencies      ${Object.keys(runtimeDependencies).join(', ')}`);
console.log(`install smoke     ${smoke.ok ? 'passed' : `FAILED: ${smoke.detail}`}`);
console.log(`publishable unit  ${publishableUnit}`);
if (missing.length > 0) console.log(`missing files     ${missing.join(', ')}`);
console.log('');
console.log(
  `nothing was published. To publish, a maintainer runs npm publish from ${publishableUnit}, never from apps/cli.`,
);
console.log('The checklist is in docs/guides/release.md.');

if (missing.length > 0 || !smoke.ok) process.exitCode = 1;
