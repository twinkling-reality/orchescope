import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { collectFiles, DEFAULT_EXCLUDED_DIRECTORIES } from '../src/file-set.ts';
import { readCitationSnapshots } from '../src/citation-snapshot.ts';

const roots: string[] = [];

after(async () => {
  const { rm } = await import('node:fs/promises');
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const repository = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-citations-'));
  roots.push(root);
  return root;
};

const traversal = {
  maxFileBytes: 64,
  maxFiles: 20,
  followSymlinks: false,
  excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  excludePrefixes: [],
};

describe('manifest citation snapshots', () => {
  it('returns the raw byte digest and only the requested UTF-8 lines', () => {
    const root = repository();
    mkdirSync(join(root, 'src'));
    const bytes = Buffer.from('first\r\ntriage-agent\r\nthird\r\n');
    writeFileSync(join(root, 'src/agent.rb'), bytes);

    const snapshots = readCitationSnapshots(
      collectFiles(root, traversal),
      [
        { path: 'src/agent.rb', line: 2 },
        { path: 'src/agent.rb', line: 9 },
      ],
      { maxFileBytes: 64, maxRequests: 10 },
    );

    assert.deepEqual(snapshots, [
      {
        path: 'src/agent.rb',
        byteLength: bytes.byteLength,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        lineCount: 4,
        lines: [{ line: 2, text: 'triage-agent' }],
      },
    ]);
  });

  it('refuses a path the traversal did not walk and a symlink that escapes the root', () => {
    const root = repository();
    const outside = repository();
    writeFileSync(join(outside, 'agent.rb'), 'external-agent\n');
    symlinkSync(join(outside, 'agent.rb'), join(root, 'escaped.rb'));
    const fileSet = collectFiles(root, { ...traversal, followSymlinks: true });

    const snapshots = readCitationSnapshots(
      fileSet,
      [
        { path: 'missing.rb', line: 1 },
        { path: 'escaped.rb', line: 1 },
      ],
      { maxFileBytes: 64, maxRequests: 10 },
    );

    assert.deepEqual(
      snapshots.map(({ path, refusal }) => ({ path, refusal })),
      [
        { path: 'missing.rb', refusal: 'not_walked' },
        { path: 'escaped.rb', refusal: 'outside_root' },
      ],
    );
  });

  it('refuses oversized, binary and invalid UTF-8 files without retaining their contents', () => {
    const root = repository();
    writeFileSync(join(root, 'large.rb'), 'x'.repeat(65));
    writeFileSync(join(root, 'binary.rb'), Buffer.from([0, 1, 2]));
    writeFileSync(join(root, 'invalid.rb'), Buffer.from([0xc3, 0x28]));
    const fileSet = collectFiles(root, traversal);

    const snapshots = readCitationSnapshots(
      fileSet,
      [
        { path: 'large.rb', line: 1 },
        { path: 'binary.rb', line: 1 },
        { path: 'invalid.rb', line: 1 },
      ],
      { maxFileBytes: 64, maxRequests: 10 },
    );

    assert.deepEqual(
      snapshots.map(({ path, refusal, lines }) => ({ path, refusal, lines })),
      [
        { path: 'large.rb', refusal: 'too_large', lines: [] },
        { path: 'binary.rb', refusal: 'binary', lines: [] },
        { path: 'invalid.rb', refusal: 'invalid_utf8', lines: [] },
      ],
    );
  });

  it('reads no request beyond the declared request ceiling', () => {
    const root = repository();
    writeFileSync(join(root, 'first.rb'), 'first\n');
    writeFileSync(join(root, 'second.rb'), 'second\n');

    const snapshots = readCitationSnapshots(
      collectFiles(root, traversal),
      [
        { path: 'first.rb', line: 1 },
        { path: 'second.rb', line: 1 },
      ],
      { maxFileBytes: 64, maxRequests: 1 },
    );

    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.path),
      ['first.rb'],
    );
  });
});
