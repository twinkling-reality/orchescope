/**
 * Builds a release candidate locally: pack the tarball, record its checksum, and verify it installs and runs.
 *
 * Nothing here publishes anything. Publication is a deliberate human action, so this script stops at producing the
 * artifact and the evidence that the artifact works.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

console.log('packing the tarball');
// `pnpm pack` resolves workspace protocol dependencies, which is required for a tarball that installs anywhere.
const packOutput = run('pnpm', ['pack', '--pack-destination', releaseDirectory], {
  cwd: cliDirectory,
});
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
const hasUi = listing.some((entry) => entry.startsWith('dist/ui/'));

console.log('installing the tarball into a temporary prefix and running it');
const sandbox = mkdtempSync(join(tmpdir(), 'orchescope-install-'));
let smoke = { ok: false, detail: 'not run' };
try {
  writeFileSync(
    join(sandbox, 'package.json'),
    '{"name":"orchescope-install-check","private":true}\n',
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', tarballPath], { cwd: sandbox });
  const version = run(join(sandbox, 'node_modules/.bin/orchescope'), ['--version'], {
    cwd: sandbox,
  }).trim();
  const help = run(join(sandbox, 'node_modules/.bin/orchescope'), ['--help'], { cwd: sandbox });
  smoke = {
    ok: version.length > 0 && help.includes('Map, test, and improve agent systems'),
    detail: `version ${version}`,
  };
} catch (error) {
  smoke = {
    ok: false,
    detail: error instanceof Error ? error.message.slice(0, 400) : 'unknown failure',
  };
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

const summary = {
  tarball: tarballName,
  bytes: bytes.length,
  sha256: digest,
  fileCount: listing.length,
  includesBrowserWorkspace: hasUi,
  missingRequiredFiles: missing,
  installSmokeTest: smoke,
  published: false,
};
writeFileSync(
  join(releaseDirectory, 'release-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);

console.log('');
console.log(`tarball          ${tarballName}`);
console.log(`size             ${(bytes.length / 1024).toFixed(0)} KiB`);
console.log(`sha256           ${digest}`);
console.log(`files            ${listing.length}`);
console.log(`browser workspace ${hasUi ? 'included' : 'MISSING, run pnpm build:web first'}`);
console.log(`install smoke    ${smoke.ok ? 'passed' : `FAILED: ${smoke.detail}`}`);
if (missing.length > 0) console.log(`missing files    ${missing.join(', ')}`);
console.log('');
console.log(
  'nothing was published. To publish, a maintainer runs npm publish from apps/cli deliberately.',
);

if (missing.length > 0 || !smoke.ok) process.exitCode = 1;
