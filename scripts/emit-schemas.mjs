/**
 * Emits the JSON Schema files under `schemas/` from the TypeBox definitions.
 *
 * The schemas are generated rather than hand written, so the contract an external consumer validates against is the
 * same object Orchescope validates with. Run with `--check` in CI: it fails when the committed files drift from the
 * source, which is what stops a schema change from shipping without its documentation.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'schemas');

const { documentDescriptors } = await import(join(root, 'packages/schema/src/index.ts'));
const { stableJson } = await import(join(root, 'packages/domain/src/index.ts'));

const check = process.argv.includes('--check');
mkdirSync(outputDirectory, { recursive: true });

let drifted = 0;
const written = [];

for (const descriptor of documentDescriptors()) {
  const target = join(outputDirectory, descriptor.fileName);
  const contents = `${stableJson({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...JSON.parse(JSON.stringify(descriptor.schema)),
  })}\n`;

  if (check) {
    let existing = '';
    try {
      existing = readFileSync(target, 'utf8');
    } catch {
      existing = '';
    }
    if (existing !== contents) {
      drifted += 1;
      console.error(`schema drift: ${descriptor.fileName} differs from packages/schema`);
    }
    continue;
  }
  writeFileSync(target, contents);
  written.push(`${descriptor.fileName} (version ${descriptor.version})`);
}

const index = documentDescriptors()
  .map(
    (descriptor) =>
      `- \`${descriptor.fileName}\`: ${descriptor.name}, version ${descriptor.version}, readable from version ${descriptor.minReadableVersion}`,
  )
  .join('\n');
const readme = `# Generated JSON Schema

These files are emitted from \`packages/schema\` by \`pnpm schemas\`. Do not edit them by hand: the TypeBox
definitions are the source of truth and CI fails when these files drift from them.

${index}

Every document carries a \`schemaVersion\`. A reader must refuse a version it does not understand rather than
guessing, and the minimum readable version above is what this build accepts.
`;

if (check) {
  let existingReadme = '';
  try {
    existingReadme = readFileSync(join(outputDirectory, 'README.md'), 'utf8');
  } catch {
    existingReadme = '';
  }
  if (existingReadme !== readme) {
    drifted += 1;
    console.error('schema drift: schemas/README.md differs from the generator output');
  }
  if (drifted > 0) {
    console.error(`\n${drifted} generated file(s) are out of date. Run: pnpm schemas`);
    process.exitCode = 1;
  } else {
    console.log(`schemas are up to date (${documentDescriptors().length} documents)`);
  }
} else {
  writeFileSync(join(outputDirectory, 'README.md'), readme);
  console.log(`wrote ${written.length} schema file(s) and an index into schemas/`);
  for (const entry of written) console.log(`  ${entry}`);
}
