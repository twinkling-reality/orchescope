import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, OrchescopeError, sha256Hex } from '@orchescope/domain';
import type { Database } from './database.ts';

/**
 * A content addressed artifact store.
 *
 * Large documents (system graphs, trace bundles, benchmark reports, rendered reports) live on disk keyed by
 * the digest of their bytes, and the database keeps only the metadata it needs to query. Writing the same
 * content twice is free, an artifact reference in a finding or a goal cannot rot, and a corrupted file is
 * detectable because the name is the hash.
 *
 * Writes are atomic: content goes to a temporary file in the same directory and is renamed into place, so a
 * crash cannot leave a half written artifact under a digest that claims to describe it.
 */

export type ArtifactStore = {
  readonly putJson: (value: unknown) => string;
  readonly putText: (text: string, mediaType: string) => string;
  readonly getText: (digest: string) => string;
  readonly getJson: <T>(digest: string) => T;
  readonly has: (digest: string) => boolean;
  readonly pathFor: (digest: string) => string;
  readonly verify: (digest: string) => boolean;
  readonly remove: (digest: string) => void;
};

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

const assertDigest = (digest: string): void => {
  if (!DIGEST_PATTERN.test(digest)) {
    throw new OrchescopeError(
      'ARTIFACT_INVALID',
      'An artifact digest must be 64 lowercase hex characters.',
      {
        detail: { digest: digest.slice(0, 80) },
      },
    );
  }
};

export const createArtifactStore = (
  root: string,
  database: Database,
  now: () => string,
): ArtifactStore => {
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const pathFor = (digest: string): string => {
    assertDigest(digest);
    return join(root, digest.slice(0, 2), digest);
  };

  const write = (content: string, mediaType: string): string => {
    const digest = sha256Hex(content);
    const target = pathFor(digest);
    if (!existsSync(target)) {
      mkdirSync(join(root, digest.slice(0, 2)), { recursive: true, mode: 0o700 });
      const temporary = `${target}.${process.pid}.partial`;
      writeFileSync(temporary, content, { mode: 0o600 });
      renameSync(temporary, target);
    }
    database.run(
      `INSERT INTO artifact (digest, media_type, byte_length, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(digest) DO NOTHING`,
      digest,
      mediaType,
      Buffer.byteLength(content, 'utf8'),
      now(),
    );
    return digest;
  };

  const readText = (digest: string): string => {
    const target = pathFor(digest);
    try {
      return readFileSync(target, 'utf8');
    } catch (error) {
      throw new OrchescopeError(
        'ARTIFACT_MISSING',
        `Artifact ${digest.slice(0, 12)} is not in the store.`,
        {
          cause: error,
          detail: { digest },
          remediation: 'Rerun the command that produced it, or import the artifact again.',
        },
      );
    }
  };

  return {
    putJson: (value) => write(canonicalJson(value), 'application/json'),
    putText: (text, mediaType) => write(text, mediaType),
    getText: readText,
    getJson: <T>(digest: string): T => JSON.parse(readText(digest)) as T,
    has: (digest) => existsSync(pathFor(digest)),
    pathFor,
    verify: (digest) => {
      if (!existsSync(pathFor(digest))) return false;
      return sha256Hex(readFileSync(pathFor(digest))) === digest;
    },
    remove: (digest) => {
      rmSync(pathFor(digest), { force: true });
      database.run('DELETE FROM artifact WHERE digest = ?', digest);
    },
  };
};
