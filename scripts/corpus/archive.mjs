/**
 * Reads and materialises a bounded GitHub commit archive.
 *
 * GitHub guarantees the extracted file contents of a full commit archive, not the byte layout of its gzip
 * container. The security pin is therefore a normalized digest of every regular file path, executable bit and
 * byte. This reader parses the tar itself so an unverified archive is never handed to a general extractor.
 */

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const BLOCK_BYTES = 512;
const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2_048;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const SHA256 = /^[0-9a-f]{64}$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

const fail = (detail) => {
  throw new Error(`required archive ${detail}`);
};

const allZero = (bytes) => bytes.every((byte) => byte === 0);

const fieldText = (bytes, label) => {
  const zero = bytes.indexOf(0);
  const value = zero === -1 ? bytes : bytes.subarray(0, zero);
  try {
    return decoder.decode(value);
  } catch {
    fail(`${label} is not UTF-8`);
  }
};

const octal = (bytes, label) => {
  if ((bytes[0] ?? 0) >= 0x80) fail(`${label} uses an unsupported base-256 number`);
  const value = fieldText(bytes, label).trim();
  if (value.length === 0) return 0;
  if (!/^[0-7]+$/.test(value)) fail(`${label} is not an octal number`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed)) fail(`${label} exceeds the safe integer range`);
  return parsed;
};

const checksumOf = (header) => {
  let sum = 0;
  for (let index = 0; index < header.length; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  return sum;
};

const pathOf = (header) => {
  const name = fieldText(header.subarray(0, 100), 'entry path');
  const prefix = fieldText(header.subarray(345, 500), 'entry path prefix');
  return prefix.length === 0 ? name : `${prefix}/${name}`;
};

const normalizedPath = (raw, directory) => {
  const path = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || isAbsolute(path)) {
    fail(`path ${JSON.stringify(raw)} is not a relative POSIX path`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    fail(`path ${JSON.stringify(raw)} is not normalized`);
  }
  return segments;
};

const paxRecords = (bytes) => {
  const records = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const separator = bytes.indexOf(0x20, offset);
    if (separator === -1) fail('global metadata has no record length');
    const lengthText = bytes.subarray(offset, separator).toString('ascii');
    if (!/^[1-9][0-9]*$/.test(lengthText)) fail('global metadata has an invalid record length');
    const length = Number.parseInt(lengthText, 10);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > bytes.length || bytes[end - 1] !== 0x0a) {
      fail('global metadata record exceeds its body');
    }
    let record;
    try {
      record = decoder.decode(bytes.subarray(separator + 1, end - 1));
    } catch {
      fail('global metadata is not UTF-8');
    }
    const equals = record.indexOf('=');
    if (equals < 1) fail('global metadata record has no key');
    const key = record.slice(0, equals);
    if (records.has(key)) fail(`global metadata repeats ${key}`);
    records.set(key, record.slice(equals + 1));
    offset = end;
  }
  return records;
};

const treeDigest = (files) => {
  const hash = createHash('sha256');
  hash.update('orchescope-corpus-source-tree-v1\0');
  for (const file of [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    const path = Buffer.from(file.path, 'utf8');
    const pathLength = Buffer.alloc(8);
    pathLength.writeBigUInt64BE(BigInt(path.length));
    const contentLength = Buffer.alloc(8);
    contentLength.writeBigUInt64BE(BigInt(file.bytes.length));
    hash.update(pathLength);
    hash.update(path);
    hash.update(Buffer.from([file.executable ? 1 : 0]));
    hash.update(contentLength);
    hash.update(file.bytes);
  }
  return hash.digest('hex');
};

const expand = (compressed) => {
  if (!Buffer.isBuffer(compressed) && !(compressed instanceof Uint8Array)) {
    fail('input is not bytes');
  }
  if (compressed.length > MAX_COMPRESSED_BYTES) {
    fail(`has ${compressed.length} compressed bytes, above the ${MAX_COMPRESSED_BYTES} byte limit`);
  }
  let archive;
  try {
    archive = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED_BYTES });
  } catch {
    fail(`is not gzip data bounded to ${MAX_EXPANDED_BYTES} expanded bytes`);
  }
  if (archive.length === 0 || archive.length % BLOCK_BYTES !== 0) {
    fail('tar body is not block aligned');
  }
  return archive;
};

const entryAt = (archive, offset) => {
  const header = archive.subarray(offset, offset + BLOCK_BYTES);
  const magic = header.subarray(257, 263).toString('ascii');
  if (magic !== 'ustar\0' && magic !== 'ustar ') fail('entry is not a USTAR header');
  const expectedChecksum = octal(header.subarray(148, 156), 'header checksum');
  if (checksumOf(header) !== expectedChecksum) fail('entry header checksum does not match');
  const size = octal(header.subarray(124, 136), 'entry size');
  const bodyStart = offset + BLOCK_BYTES;
  const next = bodyStart + Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
  if (next > archive.length) fail('entry body exceeds the tar body');
  return {
    header,
    size,
    mode: octal(header.subarray(100, 108), 'entry mode'),
    body: archive.subarray(bodyStart, bodyStart + size),
    type: String.fromCharCode(header[156] ?? 0),
    next,
  };
};

const requireEnd = (archive, offset) => {
  const second = archive.subarray(offset + BLOCK_BYTES, offset + BLOCK_BYTES * 2);
  if (second.length !== BLOCK_BYTES || !allZero(second)) fail('tar body has only one end block');
  if (!allZero(archive.subarray(offset + BLOCK_BYTES * 2))) {
    fail('tar body has data after its end blocks');
  }
};

const commentFrom = (entry, entryCount, previous) => {
  if (entryCount !== 1 || previous !== undefined || entry.size > BLOCK_BYTES) {
    fail('global metadata is not one bounded first entry');
  }
  const records = paxRecords(entry.body);
  if (records.size !== 1 || !records.has('comment')) {
    fail('global metadata contains fields other than the commit comment');
  }
  return records.get('comment');
};

const sourceFrom = (entry, expectedRoot, seen) => {
  const directory = entry.type === '5';
  if (!directory && entry.type !== '0' && entry.type !== '\0') {
    fail(`entry type ${JSON.stringify(entry.type)} is not a regular file or directory`);
  }
  if (directory && entry.size !== 0) fail('directory entry has a body');
  if (!directory && entry.size > MAX_FILE_BYTES) {
    fail(
      `file ${JSON.stringify(pathOf(entry.header))} has ${entry.size} bytes, above the ${MAX_FILE_BYTES} byte limit`,
    );
  }
  const segments = normalizedPath(pathOf(entry.header), directory);
  const root = segments[0];
  if (expectedRoot !== undefined && root !== expectedRoot) {
    fail('entries do not share one archive root');
  }
  const path = segments.slice(1).join('/');
  if (path.length === 0) {
    if (!directory) fail('archive root is a regular file');
    return { root };
  }
  if (seen.has(path)) fail(`path ${JSON.stringify(path)} is repeated`);
  seen.add(path);
  return {
    root,
    file: directory
      ? undefined
      : { path, executable: (entry.mode & 0o111) !== 0, bytes: Buffer.from(entry.body) },
  };
};

const sourceFiles = (archive) => {
  const files = [];
  const seen = new Set();
  let root;
  let globalComment;
  let entryCount = 0;
  let offset = 0;

  while (offset + BLOCK_BYTES <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_BYTES);
    if (allZero(header)) {
      requireEnd(archive, offset);
      return { files, root, globalComment };
    }

    entryCount += 1;
    if (entryCount > MAX_ARCHIVE_ENTRIES) fail(`has more than ${MAX_ARCHIVE_ENTRIES} entries`);
    const entry = entryAt(archive, offset);
    offset = entry.next;
    if (entry.type === 'g') {
      globalComment = commentFrom(entry, entryCount, globalComment);
      continue;
    }
    const source = sourceFrom(entry, root, seen);
    root = source.root;
    if (source.file !== undefined) files.push(source.file);
  }
  fail('tar body has no two-block end marker');
};

/** Parses a compressed archive without writing any of its untrusted contents. */
export const inspectSourceArchive = (compressed, commit) => {
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('commit is not a full revision');
  const { files, root, globalComment } = sourceFiles(expand(compressed));
  if (globalComment !== commit) fail('global commit comment does not match the pinned revision');
  if (root === undefined || files.length === 0) fail('contains no source files');
  return {
    files,
    fileCount: files.length,
    sourceBytes: files.reduce((sum, file) => sum + file.bytes.length, 0),
    treeSha256: treeDigest(files),
  };
};

const download = async (entry) => {
  let lastError;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(entry.requiredArchive.url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'orchescope-corpus',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok || response.body === null) {
        throw new Error(`HTTP ${response.status}`);
      }
      const resolved = new URL(response.url);
      if (
        resolved.protocol !== 'https:' ||
        (resolved.hostname !== 'api.github.com' && resolved.hostname !== 'codeload.github.com')
      ) {
        throw new Error('redirected outside the GitHub HTTPS archive service');
      }
      const declaredLength = response.headers.get('content-length');
      if (declaredLength !== null) {
        const parsed = Number.parseInt(declaredLength, 10);
        if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_COMPRESSED_BYTES) {
          throw new Error(`declared ${declaredLength} compressed bytes`);
        }
      }
      const chunks = [];
      let received = 0;
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > MAX_COMPRESSED_BYTES) {
          throw new Error(`exceeded ${MAX_COMPRESSED_BYTES} compressed bytes`);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, received);
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${entry.name}: required archive could not be downloaded after ${MAX_DOWNLOAD_ATTEMPTS} attempts: ${detail}`,
  );
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Verifies one archive against the source and licence pins on its corpus entry. */
export const verifyRequiredArchive = (entry, compressed) => {
  const inspected = inspectSourceArchive(compressed, entry.commit);
  if (!SHA256.test(entry.requiredArchive.treeSha256)) {
    throw new Error(`${entry.name}: required archive tree digest is not SHA-256`);
  }
  if (inspected.treeSha256 !== entry.requiredArchive.treeSha256) {
    throw new Error(
      `${entry.name}: required archive source tree expected ${entry.requiredArchive.treeSha256}, observed ${inspected.treeSha256}`,
    );
  }
  const licence = inspected.files.find((file) => file.path === entry.requiredArchive.licensePath);
  if (licence === undefined) {
    throw new Error(
      `${entry.name}: required archive has no ${entry.requiredArchive.licensePath} licence file`,
    );
  }
  const licenceDigest = sha256(licence.bytes);
  if (licenceDigest !== entry.requiredArchive.licenseSha256) {
    throw new Error(
      `${entry.name}: required archive licence expected ${entry.requiredArchive.licenseSha256}, observed ${licenceDigest}`,
    );
  }
  return inspected;
};

/** Downloads, verifies and atomically materialises one required archive in the ignored corpus cache. */
export const materializeRequiredArchive = async (entry, destination) => {
  const compressed = await download(entry);
  const inspected = verifyRequiredArchive(entry, compressed);

  const preparing = `${destination}.preparing-${process.pid}`;
  rmSync(preparing, { recursive: true, force: true });
  mkdirSync(preparing, { recursive: true });
  try {
    for (const file of inspected.files) {
      const target = resolve(preparing, file.path);
      const inside = relative(preparing, target);
      if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) {
        throw new Error(`${entry.name}: verified archive path resolves outside its checkout`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.bytes, { mode: file.executable ? 0o755 : 0o644 });
      chmodSync(target, file.executable ? 0o755 : 0o644);
    }
    rmSync(destination, { recursive: true, force: true });
    renameSync(preparing, destination);
  } catch (error) {
    rmSync(preparing, { recursive: true, force: true });
    throw error;
  }
  return destination;
};

export const requiredArchiveBounds = Object.freeze({
  compressedBytes: MAX_COMPRESSED_BYTES,
  expandedBytes: MAX_EXPANDED_BYTES,
  entries: MAX_ARCHIVE_ENTRIES,
  fileBytes: MAX_FILE_BYTES,
  downloadAttempts: MAX_DOWNLOAD_ATTEMPTS,
  downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS,
});
