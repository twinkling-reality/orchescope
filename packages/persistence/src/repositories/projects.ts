import type { Evidence } from '@orchescope/schema';
import type { Database } from '../database.ts';
import { text } from '../rows.ts';

/**
 * Projects and evidence.
 *
 * Evidence is written once and never updated: a record describes what was observed at a moment, and changing it later
 * would make an old finding cite something that no longer says what it said.
 */

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>;

export const createProjectsRepository = (input: {
  readonly database: Database;
  readonly now: () => string;
}) => {
  const { database, now } = input;

  const ensureProject = (projectId: string, name: string, pathHash: string): void => {
    database.run(
      `INSERT INTO project (id, name, path_hash, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
      projectId,
      name,
      pathHash,
      now(),
    );
  };

  const saveEvidence = (records: readonly Evidence[]): void => {
    const timestamp = now();
    for (const record of records) {
      database.run(
        `INSERT INTO evidence (id, kind, basis, producer, json, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        record.id,
        record.kind,
        record.basis,
        record.producer,
        JSON.stringify(record),
        timestamp,
      );
    }
  };

  const evidenceByIds = (ids: readonly string[]): readonly Evidence[] => {
    if (ids.length === 0) return [];
    const rows = database.all(
      `SELECT json FROM evidence WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ...ids,
    );
    return rows.map((row) => JSON.parse(text(row, 'json')) as Evidence);
  };

  return {
    ensureProject,
    saveEvidence,
    evidenceByIds,
  };
};
