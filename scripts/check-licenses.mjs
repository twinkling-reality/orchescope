/**
 * Dependency licence check.
 *
 * Orchescope is Apache-2.0, so every runtime dependency has to be a licence that can be redistributed inside a
 * permissively licensed bundle. A copyleft licence in the runtime graph is a failure rather than a warning, because
 * discovering it after publication is expensive.
 *
 * Development dependencies are reported but not enforced: they are not redistributed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'Python-2.0',
]);

const REFUSED_PATTERNS = [
  /GPL/i,
  /AGPL/i,
  /EPL/i,
  /MPL/i,
  /SSPL/i,
  /Elastic/i,
  /BUSL/i,
  /CC-BY-NC/i,
];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const productionTree = () => {
  const output = execFileSync(
    'pnpm',
    ['--filter', 'orchescope', 'list', '--prod', '--depth', 'Infinity', '--json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(output);
};

const collect = (node, into) => {
  for (const [name, entry] of Object.entries(node ?? {})) {
    if (entry.path === undefined) continue;
    into.set(`${name}@${entry.version ?? 'unknown'}`, entry.path);
    collect(entry.dependencies, into);
  }
};

const packages = new Map();
for (const project of productionTree()) {
  collect(project.dependencies, packages);
  collect(project.optionalDependencies, packages);
}

const findings = [];
const notInstalled = [];
for (const [identifier, path] of packages) {
  if (identifier.startsWith('@orchescope/')) continue;
  // Platform specific optional packages for other operating systems are listed in the tree and are not on disk.
  // What is not here cannot be checked here, so it is counted and left to the check that runs on that platform.
  if (!existsSync(join(path, 'package.json'))) {
    notInstalled.push(identifier);
    continue;
  }
  let license = 'UNKNOWN';
  try {
    const manifest = readJson(join(path, 'package.json'));
    license =
      typeof manifest.license === 'string'
        ? manifest.license
        : typeof manifest.license?.type === 'string'
          ? manifest.license.type
          : Array.isArray(manifest.licenses)
            ? manifest.licenses.map((entry) => entry.type).join(' OR ')
            : 'UNKNOWN';
  } catch {
    license = 'UNREADABLE';
  }
  const refused = REFUSED_PATTERNS.some((pattern) => pattern.test(license));
  const allowed =
    ALLOWED.has(license) || license.split(' OR ').every((part) => ALLOWED.has(part.trim()));
  findings.push({ identifier, license, refused, allowed });
}

findings.sort((left, right) => left.identifier.localeCompare(right.identifier));

const problems = findings.filter((entry) => entry.refused || !entry.allowed);
const counts = new Map();
for (const entry of findings) counts.set(entry.license, (counts.get(entry.license) ?? 0) + 1);

console.log(`checked ${findings.length} runtime package(s) present on this platform`);
if (notInstalled.length > 0) {
  console.log(
    `  ${notInstalled.length} platform specific package(s) for other operating systems are not installed here and were not checked`,
  );
}
for (const [license, count] of [...counts].sort((left, right) => right[1] - left[1])) {
  console.log(`  ${String(count).padStart(3)}  ${license}`);
}

if (problems.length > 0) {
  console.error('');
  console.error('these runtime dependencies are not acceptable for an Apache-2.0 distribution:');
  for (const entry of problems) {
    console.error(`  ${entry.identifier}: ${entry.license}`);
  }
  process.exitCode = 1;
} else {
  console.log('');
  console.log('every runtime dependency carries a permissive licence that can be redistributed');
}
