import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  inspectSourceArchive,
  requiredArchiveBounds,
  verifyRequiredArchive,
} from '../../scripts/corpus/archive.mjs';

const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const ROOT = 'owner-repository-1234567';

type ArchiveEntry = {
  readonly path: string;
  readonly body?: string | Buffer;
  readonly executable?: boolean;
  readonly type?: string;
};

const writeOctal = (header: Buffer, offset: number, length: number, value: number) => {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
};

const headerOf = (path: string, size: number, type: string, executable = false) => {
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, 'utf8');
  writeOctal(header, 100, 8, executable ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
};

const paxRecord = (key: string, value: string) => {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (true) {
    const record = `${length} ${body}`;
    const measured = Buffer.byteLength(record);
    if (measured === length) return Buffer.from(record);
    length = measured;
  }
};

const blockEntry = (path: string, body: Buffer, type: string, executable = false) => {
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return Buffer.concat([headerOf(path, body.length, type, executable), body, padding]);
};

const tarOf = (
  entries: readonly ArchiveEntry[],
  options: {
    readonly root?: string;
    readonly comment?: string;
    readonly extraGlobal?: boolean;
  } = {},
) => {
  const root = options.root ?? ROOT;
  const globalBody = Buffer.concat([
    paxRecord('comment', options.comment ?? COMMIT),
    ...(options.extraGlobal === true ? [paxRecord('owner', 'untrusted')] : []),
  ]);
  const blocks = [
    blockEntry('pax_global_header', globalBody, 'g'),
    blockEntry(`${root}/`, Buffer.alloc(0), '5'),
  ];
  for (const entry of entries) {
    const body =
      typeof entry.body === 'string' ? Buffer.from(entry.body) : (entry.body ?? Buffer.alloc(0));
    blocks.push(blockEntry(entry.path, body, entry.type ?? '0', entry.executable === true));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
};

const gzipOf = (
  entries: readonly ArchiveEntry[],
  options: Parameters<typeof tarOf>[1] = {},
  level = 6,
) => gzipSync(tarOf(entries, options), { level });

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const sourceEntries = (root = ROOT): readonly ArchiveEntry[] => [
  { path: `${root}/LICENSE`, body: 'MIT License\n' },
  { path: `${root}/src/main.ts`, body: 'export const answer = 42;\n', executable: true },
];

describe('required corpus source archives', () => {
  it('pins the normalized source tree rather than compression or generated root metadata', () => {
    const first = inspectSourceArchive(gzipOf(sourceEntries(), {}, 1), COMMIT);
    const renamedRoot = 'renamed-repository-1234567';
    const second = inspectSourceArchive(
      gzipOf(sourceEntries(renamedRoot), { root: renamedRoot }, 9),
      COMMIT,
    );
    assert.equal(first.treeSha256, second.treeSha256);
    assert.equal(first.fileCount, 2);
    assert.equal(first.sourceBytes, 38);

    const changedContent = inspectSourceArchive(
      gzipOf([
        sourceEntries()[0]!,
        { path: `${ROOT}/src/main.ts`, body: 'export const answer = 43;\n', executable: true },
      ]),
      COMMIT,
    );
    const changedMode = inspectSourceArchive(
      gzipOf([
        sourceEntries()[0]!,
        { path: `${ROOT}/src/main.ts`, body: 'export const answer = 42;\n' },
      ]),
      COMMIT,
    );
    const changedPath = inspectSourceArchive(
      gzipOf([
        sourceEntries()[0]!,
        { path: `${ROOT}/src/other.ts`, body: 'export const answer = 42;\n', executable: true },
      ]),
      COMMIT,
    );
    assert.notEqual(first.treeSha256, changedContent.treeSha256);
    assert.notEqual(first.treeSha256, changedMode.treeSha256);
    assert.notEqual(first.treeSha256, changedPath.treeSha256);
  });

  it('verifies both the complete source tree and the licence bytes', () => {
    const archive = gzipOf(sourceEntries());
    const inspected = inspectSourceArchive(archive, COMMIT);
    const entry = {
      name: 'measured-repository',
      commit: COMMIT,
      requiredArchive: {
        treeSha256: inspected.treeSha256,
        licensePath: 'LICENSE',
        licenseSha256: sha256(Buffer.from('MIT License\n')),
      },
    };
    assert.equal(verifyRequiredArchive(entry, archive).treeSha256, inspected.treeSha256);
    assert.throws(
      () =>
        verifyRequiredArchive(
          {
            ...entry,
            requiredArchive: { ...entry.requiredArchive, treeSha256: '0'.repeat(64) },
          },
          archive,
        ),
      /source tree expected/,
    );
    assert.throws(
      () =>
        verifyRequiredArchive(
          {
            ...entry,
            requiredArchive: { ...entry.requiredArchive, licenseSha256: '0'.repeat(64) },
          },
          archive,
        ),
      /licence expected/,
    );
    assert.throws(
      () =>
        verifyRequiredArchive(
          {
            ...entry,
            requiredArchive: { ...entry.requiredArchive, licensePath: 'COPYING' },
          },
          archive,
        ),
      /has no COPYING licence file/,
    );
  });

  it('refuses paths and entry kinds that can escape or redirect extraction', () => {
    const unsafe = [
      { entry: { path: '/absolute', body: 'x' }, message: /not a relative POSIX path/ },
      { entry: { path: `${ROOT}/../escape`, body: 'x' }, message: /not normalized/ },
      { entry: { path: `${ROOT}/back\\slash`, body: 'x' }, message: /relative POSIX path/ },
      { entry: { path: `${ROOT}/link`, body: 'target', type: '2' }, message: /entry type/ },
      { entry: { path: `${ROOT}/device`, type: '3' }, message: /entry type/ },
    ] as const;
    for (const test of unsafe) {
      assert.throws(() => inspectSourceArchive(gzipOf([test.entry]), COMMIT), test.message);
    }
  });

  it('refuses duplicate paths, multiple roots and unsupported global metadata', () => {
    assert.throws(
      () =>
        inspectSourceArchive(
          gzipOf([
            { path: `${ROOT}/same`, body: 'one' },
            { path: `${ROOT}/same`, body: 'two' },
          ]),
          COMMIT,
        ),
      /is repeated/,
    );
    assert.throws(
      () =>
        inspectSourceArchive(
          gzipOf([
            { path: `${ROOT}/one`, body: 'one' },
            { path: 'another-root/two', body: 'two' },
          ]),
          COMMIT,
        ),
      /do not share one archive root/,
    );
    assert.throws(
      () => inspectSourceArchive(gzipOf(sourceEntries(), { extraGlobal: true }), COMMIT),
      /fields other than the commit comment/,
    );
    assert.throws(
      () => inspectSourceArchive(gzipOf(sourceEntries(), { comment: '0'.repeat(40) }), COMMIT),
      /commit comment does not match/,
    );
  });

  it('refuses corrupt tar headers and incomplete end markers', () => {
    const corrupt = tarOf(sourceEntries());
    corrupt[1024 + 10] = (corrupt[1024 + 10] ?? 0) ^ 0xff;
    assert.throws(
      () => inspectSourceArchive(gzipSync(corrupt), COMMIT),
      /header checksum does not match/,
    );

    const incomplete = tarOf(sourceEntries()).subarray(0, -512);
    assert.throws(() => inspectSourceArchive(gzipSync(incomplete), COMMIT), /only one end block/);
  });

  it('enforces compressed, expanded, entry and individual file bounds', () => {
    assert.throws(
      () => inspectSourceArchive(Buffer.alloc(requiredArchiveBounds.compressedBytes + 1), COMMIT),
      /above the .* byte limit/,
    );
    assert.throws(
      () =>
        inspectSourceArchive(
          gzipSync(Buffer.alloc(requiredArchiveBounds.expandedBytes + 512)),
          COMMIT,
        ),
      /bounded to/,
    );
    assert.throws(
      () =>
        inspectSourceArchive(
          gzipOf([
            {
              path: `${ROOT}/large`,
              body: Buffer.alloc(requiredArchiveBounds.fileBytes + 1),
            },
          ]),
          COMMIT,
        ),
      /above the .* byte limit/,
    );
    const many = Array.from(
      { length: requiredArchiveBounds.entries - 1 },
      (_, index): ArchiveEntry => ({ path: `${ROOT}/file-${index}`, body: '' }),
    );
    assert.throws(() => inspectSourceArchive(gzipOf(many), COMMIT), /more than .* entries/);
  });
});
