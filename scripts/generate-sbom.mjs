/**
 * Generates a CycloneDX 1.6 software bill of materials for the publishable package.
 *
 * Only the runtime graph is described, because that is what a consumer receives. Packages that are not installed on
 * this platform are listed with their declared version and a note that their metadata was not read here, rather than
 * being silently omitted: a bill of materials that quietly drops components is worse than one that says what it could
 * not see.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = process.argv[2] ?? join(root, 'release/sbom.cdx.json');

const cliManifest = JSON.parse(readFileSync(join(root, 'apps/cli/package.json'), 'utf8'));

const tree = JSON.parse(
  execFileSync(
    'pnpm',
    ['--filter', 'orchescope', 'list', '--prod', '--depth', 'Infinity', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  ),
);

const collected = new Map();
const walk = (node) => {
  for (const [name, entry] of Object.entries(node ?? {})) {
    const version = entry.version ?? 'unknown';
    const key = `${name}@${version}`;
    if (!collected.has(key)) collected.set(key, { name, version, path: entry.path });
    walk(entry.dependencies);
  }
};
for (const project of tree) {
  walk(project.dependencies);
  walk(project.optionalDependencies);
}

const purl = (name, version) => `pkg:npm/${name.replace('@', '%40')}@${version}`;

const components = [];
for (const { name, version, path } of [...collected.values()].sort((left, right) =>
  left.name.localeCompare(right.name),
)) {
  if (name.startsWith('@orchescope/')) continue;
  let license;
  let description;
  let installed = false;
  if (path !== undefined && existsSync(join(path, 'package.json'))) {
    installed = true;
    const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    license = typeof manifest.license === 'string' ? manifest.license : undefined;
    description =
      typeof manifest.description === 'string' ? manifest.description.slice(0, 200) : undefined;
  }
  components.push({
    type: 'library',
    'bom-ref': purl(name, version),
    name,
    version,
    purl: purl(name, version),
    ...(description === undefined ? {} : { description }),
    ...(license === undefined ? {} : { licenses: [{ license: { id: license } }] }),
    ...(installed
      ? {}
      : {
          properties: [
            {
              name: 'orchescope:metadata',
              value:
                'not installed on the machine that generated this document, so its manifest was not read',
            },
          ],
        }),
  });
}

const document = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    component: {
      type: 'application',
      'bom-ref': purl(cliManifest.name, cliManifest.version),
      name: cliManifest.name,
      version: cliManifest.version,
      purl: purl(cliManifest.name, cliManifest.version),
      licenses: [{ license: { id: cliManifest.license } }],
      description: cliManifest.description,
    },
    tools: {
      components: [
        { type: 'application', name: 'orchescope-sbom-script', version: cliManifest.version },
      ],
    },
    properties: [
      { name: 'orchescope:node', value: process.versions.node },
      { name: 'orchescope:scope', value: 'runtime dependencies of the published package' },
    ],
  },
  components,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote ${outputPath} with ${components.length} component(s)`);
