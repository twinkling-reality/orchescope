import type { BenchmarkReport, ChaosReport, Comparison } from '@orchescope/schema';
import type { ArtifactStore } from '../artifacts.ts';
import { asNullable, type Database } from '../database.ts';
import { text } from '../rows.ts';

/**
 * Benchmarks, chaos reports and comparisons.
 *
 * These are the documents that carry measurements, and each is stored whole: a measurement without its environment and
 * sample sizes cannot be interpreted later.
 */

export const createExperimentsRepository = (input: {
  readonly database: Database;
  readonly artifacts: ArtifactStore;
}) => {
  const { database, artifacts } = input;

  const saveBenchmark = (report: BenchmarkReport, projectId: string): void =>
    database.transaction(() => {
      const digest = artifacts.putJson(report);
      database.run(
        `INSERT INTO benchmark (id, project_id, scenario_id, dimension, started_at, digest)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET digest = excluded.digest`,
        report.id,
        projectId,
        report.scenarioId,
        report.dimension,
        report.startedAt,
        digest,
      );
    });

  const listBenchmarks = (projectId: string, limit = 20): readonly BenchmarkReport[] =>
    database
      .all(
        'SELECT digest FROM benchmark WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
        projectId,
        limit,
      )
      .map((row) => artifacts.getJson<BenchmarkReport>(text(row, 'digest')));

  const saveChaosReport = (report: ChaosReport, projectId: string): void =>
    database.transaction(() => {
      const digest = artifacts.putJson(report);
      database.run(
        `INSERT INTO chaos_report (id, project_id, scenario_id, environment, started_at, digest)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET digest = excluded.digest`,
        report.id,
        projectId,
        report.scenarioId,
        report.environment,
        report.startedAt,
        digest,
      );
    });

  const listChaosReports = (projectId: string, limit = 20): readonly ChaosReport[] =>
    database
      .all(
        'SELECT digest FROM chaos_report WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
        projectId,
        limit,
      )
      .map((row) => artifacts.getJson<ChaosReport>(text(row, 'digest')));

  const saveComparison = (comparison: Comparison, projectId: string): void =>
    database.transaction(() => {
      const digest = artifacts.putJson(comparison);
      database.run(
        `INSERT INTO comparison (id, project_id, goal_id, baseline_reference, candidate_reference, verdict,
                                 created_at, digest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET digest = excluded.digest, verdict = excluded.verdict`,
        comparison.id,
        projectId,
        asNullable(comparison.goalId),
        comparison.baseline.reference,
        comparison.candidate.reference,
        comparison.verdict,
        comparison.createdAt,
        digest,
      );
    });

  const comparisonById = (comparisonId: string): Comparison | undefined => {
    const row = database.get('SELECT digest FROM comparison WHERE id = ?', comparisonId);
    return row === undefined ? undefined : artifacts.getJson<Comparison>(text(row, 'digest'));
  };

  const listComparisons = (projectId: string, limit = 20): readonly Comparison[] =>
    database
      .all(
        'SELECT digest FROM comparison WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
        projectId,
        limit,
      )
      .map((row) => artifacts.getJson<Comparison>(text(row, 'digest')));

  return {
    saveBenchmark,
    listBenchmarks,
    saveChaosReport,
    listChaosReports,
    saveComparison,
    comparisonById,
    listComparisons,
  };
};
