import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ORCHESCOPE_VERSION } from '../src/context.ts';

/**
 * The version is stated twice: once in the manifest that gets published, and once as a constant the bundle can
 * read without a filesystem lookup. It reaches a user as `orchescope --version`, as the `version` field of every
 * JSON document, and as `provenance.orchescopeVersion` on every stored scan, so a drift between the two would
 * label results with a build that was never released.
 */

const cliDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('the reported version', () => {
  it('matches the version that gets published', () => {
    const manifest = JSON.parse(readFileSync(join(cliDirectory, 'package.json'), 'utf8')) as {
      version: string;
    };
    assert.equal(
      ORCHESCOPE_VERSION,
      manifest.version,
      'the constant the CLI reports and the version in apps/cli/package.json disagree',
    );
  });

  it('is a plain semantic version, because the schema records it as one', () => {
    assert.match(ORCHESCOPE_VERSION, /^\d+\.\d+\.\d+$/);
  });
});
