import type { Scenario, ScenarioResult } from '@orchescope/schema';
import type { ArtifactStore } from '../artifacts.ts';
import { asInteger, asNullable, type Database } from '../database.ts';
import { text } from '../rows.ts';

/**
 * Scenarios and their results.
 *
 * A scenario is stored with the path it came from, so a run can be reproduced from the file its author edits.
 */

export const createScenariosRepository = (input: {
  readonly database: Database;
  readonly artifacts: ArtifactStore;
  readonly now: () => string;
}) => {
  const { database, artifacts, now } = input;

  const saveScenario = (scenario: Scenario, projectId: string, sourcePath?: string): void => {
    database.run(
      `INSERT INTO scenario (id, project_id, source_path, schema_version, updated_at, json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json,
                                     source_path = excluded.source_path,
                                     updated_at = excluded.updated_at`,
      scenario.id,
      projectId,
      asNullable(sourcePath),
      scenario.schemaVersion,
      now(),
      JSON.stringify(scenario),
    );
  };

  const scenarioById = (scenarioId: string): Scenario | undefined => {
    const row = database.get('SELECT json FROM scenario WHERE id = ?', scenarioId);
    return row === undefined ? undefined : (JSON.parse(text(row, 'json')) as Scenario);
  };

  const listScenarios = (projectId: string): readonly Scenario[] =>
    database
      .all('SELECT json FROM scenario WHERE project_id = ? ORDER BY id', projectId)
      .map((row) => JSON.parse(text(row, 'json')) as Scenario);

  const saveScenarioResult = (result: ScenarioResult, projectId: string): string =>
    database.transaction(() => {
      const digest = artifacts.putJson(result);
      database.run(
        `INSERT INTO scenario_result (id, scenario_id, project_id, started_at, passed, digest)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET digest = excluded.digest, passed = excluded.passed`,
        result.id,
        result.scenarioId,
        projectId,
        result.startedAt,
        asInteger(result.passed),
        digest,
      );
      return digest;
    });

  const scenarioResults = (scenarioId: string, limit = 20): readonly ScenarioResult[] =>
    database
      .all(
        'SELECT digest FROM scenario_result WHERE scenario_id = ? ORDER BY started_at DESC LIMIT ?',
        scenarioId,
        limit,
      )
      .map((row) => artifacts.getJson<ScenarioResult>(text(row, 'digest')));

  return {
    saveScenario,
    scenarioById,
    listScenarios,
    saveScenarioResult,
    scenarioResults,
  };
};
