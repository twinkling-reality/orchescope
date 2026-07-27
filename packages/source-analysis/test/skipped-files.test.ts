import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SkippedFile } from '@orchescope/schema';
import { boundSkipped } from '../src/file-set.ts';

/**
 * A coverage report has to stay readable on a repository that skips thousands of files, and it has to stay honest
 * while doing it. Those pull in opposite directions, and the rule that resolves them is that bounding changes what is
 * listed and never what is counted. Bounding before counting once took a repository from 596 of 600 files parsed to
 * 596 of 596, which reads as complete coverage and was a truncated list.
 */

const symlinks = (count: number): readonly SkippedFile[] =>
  Array.from({ length: count }, (_unused, index) => ({
    file: `Pods/Headers/Private/Header${index}.h`,
    reason: 'symlink' as const,
    detail: 'symbolic links are not followed',
  }));

describe('the skipped files a coverage report lists', () => {
  it('lists everything when there is little to list', () => {
    const skipped = symlinks(5);
    assert.deepEqual(boundSkipped(skipped), skipped);
  });

  it('stops listing at a bound and says how many it withheld', () => {
    const bounded = boundSkipped(symlinks(8_590));
    const listed = bounded.filter((entry) => entry.file !== '.');
    const summary = bounded.filter((entry) => entry.file === '.');
    assert.equal(listed.length, 20);
    assert.equal(summary.length, 1);
    assert.match(summary[0]?.detail ?? '', /8570 further file\(s\)/);
    assert.equal(summary[0]?.reason, 'symlink');
  });

  it('bounds each reason on its own, so one noisy reason cannot hide another', () => {
    const bounded = boundSkipped([
      ...symlinks(100),
      { file: 'package-lock.json', reason: 'too_large', detail: 'over the limit' },
      { file: 'src/broken.ts', reason: 'parse_error', detail: 'unexpected token' },
    ]);
    assert.ok(
      bounded.some((entry) => entry.file === 'package-lock.json'),
      'a single file skipped for its own reason was lost behind a noisy one',
    );
    assert.ok(bounded.some((entry) => entry.file === 'src/broken.ts'));
  });
});
