import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A source file git reads as binary produces no diff, and a change nobody can read is a change nobody
 * reviewed.
 *
 * One literal NUL byte does it. Three files held seven between them, all of them the separator in a
 * composite key, where a NUL is the right value precisely because no identity can contain one: the
 * component identity key, the edge identifier and the grouping key. Written as raw bytes they made
 * `packages/domain/src/identity.ts`, `packages/graph/src/graph-builder.ts` and
 * `packages/findings/src/grouping.ts` binary to git, which is the identity of every component, the
 * identifier of every relation and how findings are grouped, none of them reviewable. Written as `\\u0000`
 * the value is identical and the file is text.
 *
 * The index is the list, so this covers a file that does not exist yet rather than the ones that did.
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TEXT_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.json', '.jsonc', '.yaml', '.yml', '.md'];
const MAX_BYTES = 4 * 1024 * 1024;

const trackedTextFiles = (): readonly string[] =>
  execFileSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((path) => path.length > 0 && TEXT_EXTENSIONS.some((suffix) => path.endsWith(suffix)));

describe('every tracked source file', () => {
  const files = trackedTextFiles();

  it('is a list this check actually reads', () => {
    assert.ok(
      files.length > 100,
      `git lists ${files.length} text files, which is not this repository`,
    );
  });

  it('is text, so a reviewer gets a diff of it', () => {
    const binary: string[] = [];
    for (const file of files) {
      const path = join(repositoryRoot, file);
      if (statSync(path).size > MAX_BYTES) continue;
      if (readFileSync(path).includes(0)) binary.push(file);
    }
    assert.deepEqual(
      binary,
      [],
      'these hold a literal NUL byte, so git treats them as binary and shows no diff. Write it as \\u0000',
    );
  });
});
