import type { ReportBundle } from '@orchescope/schema';
import type { ArtifactStore } from '../artifacts.ts';
import type { Database } from '../database.ts';
import { text } from '../rows.ts';

/**
 * Report bundles.
 *
 * A bundle is a large document, so it lives in the artifact store and the row keeps only what a listing needs.
 */

export const createReportsRepository = (input: {
  readonly database: Database;
  readonly artifacts: ArtifactStore;
}) => {
  const { database, artifacts } = input;

  const saveReport = (bundle: ReportBundle, projectId: string): string =>
    database.transaction(() => {
      const digest = artifacts.putJson(bundle);
      database.run(
        `INSERT INTO report (id, project_id, scan_id, created_at, digest) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET digest = excluded.digest`,
        bundle.reportId,
        projectId,
        bundle.graph.provenance.scanId,
        bundle.generatedAt,
        digest,
      );
      return digest;
    });

  const latestReport = (projectId: string): ReportBundle | undefined => {
    const row = database.get(
      'SELECT digest FROM report WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      projectId,
    );
    return row === undefined ? undefined : artifacts.getJson<ReportBundle>(text(row, 'digest'));
  };

  const reportById = (reportId: string): ReportBundle | undefined => {
    const row = database.get('SELECT digest FROM report WHERE id = ?', reportId);
    return row === undefined ? undefined : artifacts.getJson<ReportBundle>(text(row, 'digest'));
  };

  return {
    saveReport,
    latestReport,
    reportById,
  };
};
