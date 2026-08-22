import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Sha256Hex } from '@orchescope/schema';
import type { FileSet } from './file-set.ts';

/** One line a manifest asks discovery to verify against repository bytes. */
export type CitationRequest = {
  readonly path: string;
  readonly line: number;
};

export type CitationRefusal =
  | 'not_walked'
  | 'outside_root'
  | 'unreadable'
  | 'not_regular'
  | 'too_large'
  | 'binary'
  | 'invalid_utf8'
  | 'changed_during_scan';

/**
 * The bounded fact an adapter receives for a cited repository file.
 *
 * Only requested lines are retained. The whole byte sequence is read to establish its digest, then
 * released before an adapter runs.
 */
export type CitationSnapshot = {
  readonly path: string;
  readonly byteLength?: number;
  readonly contentHash?: Sha256Hex;
  readonly lineCount?: number;
  readonly lines: readonly { readonly line: number; readonly text: string }[];
  readonly refusal?: CitationRefusal;
};

export type CitationSnapshotOptions = {
  readonly maxFileBytes: number;
  readonly maxRequests: number;
};

const inside = (root: string, candidate: string): boolean => {
  const fromRoot = relative(root, candidate);
  return fromRoot.length > 0 && !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
};

const refused = (path: string, refusal: CitationRefusal): CitationSnapshot => ({
  path,
  lines: [],
  refusal,
});

const requestedLines = (
  requests: readonly CitationRequest[],
): ReadonlyMap<string, ReadonlySet<number>> => {
  const grouped = new Map<string, Set<number>>();
  for (const request of requests) {
    if (!Number.isSafeInteger(request.line) || request.line < 1) continue;
    const lines = grouped.get(request.path) ?? new Set<number>();
    lines.add(request.line);
    grouped.set(request.path, lines);
  }
  return grouped;
};

const readBytes = (
  path: string,
  maxFileBytes: number,
):
  | { readonly ok: true; readonly bytes: Buffer; readonly byteLength: number }
  | { readonly ok: false; readonly refusal: CitationRefusal; readonly byteLength?: number } => {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor);
    if (!before.isFile()) return { ok: false, refusal: 'not_regular' };
    if (before.size > maxFileBytes) {
      return { ok: false, refusal: 'too_large', byteLength: before.size };
    }
    const bytes = readFileSync(descriptor);
    return { ok: true, bytes, byteLength: bytes.byteLength };
  } catch {
    return { ok: false, refusal: 'unreadable' };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

/**
 * Reads only the unique files and lines requested by a versioned citation contract.
 *
 * A path first has to be one the bounded traversal walked. Its resolved target must remain inside the
 * canonical repository root, including when a symlink was introduced after traversal. The request count
 * and bytes per file are independently bounded.
 */
export const readCitationSnapshots = (
  fileSet: FileSet,
  requests: readonly CitationRequest[],
  options: CitationSnapshotOptions,
): readonly CitationSnapshot[] => {
  const bounded = requests.slice(0, options.maxRequests);
  const grouped = requestedLines(bounded);
  const walked = new Set(fileSet.walked);
  const canonicalRoot = realpathSync(fileSet.root);
  const snapshots: CitationSnapshot[] = [];

  for (const [path, lineNumbers] of grouped) {
    if (!walked.has(path)) {
      snapshots.push(refused(path, 'not_walked'));
      continue;
    }

    let canonicalTarget: string;
    try {
      canonicalTarget = realpathSync(resolve(canonicalRoot, path));
    } catch {
      snapshots.push(refused(path, 'unreadable'));
      continue;
    }
    if (!inside(canonicalRoot, canonicalTarget)) {
      snapshots.push(refused(path, 'outside_root'));
      continue;
    }

    const read = readBytes(canonicalTarget, options.maxFileBytes);
    if (!read.ok) {
      snapshots.push({
        ...refused(path, read.refusal),
        ...(read.byteLength === undefined ? {} : { byteLength: read.byteLength }),
      });
      continue;
    }
    if (read.bytes.subarray(0, 1024).includes(0)) {
      snapshots.push({ ...refused(path, 'binary'), byteLength: read.byteLength });
      continue;
    }
    if (!isUtf8(read.bytes)) {
      snapshots.push({ ...refused(path, 'invalid_utf8'), byteLength: read.byteLength });
      continue;
    }

    const text = read.bytes.toString('utf8');
    const lines = text.split(/\r\n|\n|\r/);
    snapshots.push({
      path,
      byteLength: read.byteLength,
      contentHash: createHash('sha256').update(read.bytes).digest('hex') as Sha256Hex,
      lineCount: lines.length,
      lines: [...lineNumbers]
        .sort((left, right) => left - right)
        .flatMap((line) => {
          const value = lines[line - 1];
          return value === undefined ? [] : [{ line, text: value }];
        }),
    });
  }

  return snapshots;
};
