import type { Scenario, ScenarioResult } from '@orchescope/schema';
import type { ArtifactStore } from '../artifacts.ts';
import { asInteger, asNullable, type Database } from '../database.ts';
import { optionalText, text } from '../rows.ts';

/**
 * Scenarios and their results.
 *
 * A scenario is stored with the path it came from, so a run can be reproduced from the file its author edits.
 *
 * **Every read here is scoped to a project, and the identifier alone is not one.** A scenario name is chosen
 * by an author rather than minted from content, and `example` is the name this product's own template hands
 * out, so it is the identifier most likely to be shared between two repositories. A store holds two projects
 * whenever a repository is copied together with its `.orchescope` directory, and an unscoped read there
 * answered one repository with another repository's scenario: a project with no scenario file could load,
 * and spawn, an argv it had never declared.
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
       ON CONFLICT(project_id, id) DO UPDATE SET json = excluded.json,
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

  const scenarioById = (projectId: string, scenarioId: string): Scenario | undefined => {
    const row = database.get(
      'SELECT json FROM scenario WHERE project_id = ? AND id = ?',
      projectId,
      scenarioId,
    );
    return row === undefined ? undefined : (JSON.parse(text(row, 'json')) as Scenario);
  };

  /**
   * The file a stored scenario was read from, so an edit to it can be honoured.
   *
   * The path was recorded from the first save and read by nothing, which is why editing a scenario on disk
   * did nothing: the stored copy answered every lookup and the file was consulted only when the caller
   * named it directly. A scenario is a file its author edits, so the store has to be able to say which one.
   *
   * The path is repository relative, which is why scoping this one matters as much as scoping the document:
   * two repositories both holding `scenarios/example.yaml` are two different files under one string.
   */
  const scenarioSourceById = (projectId: string, scenarioId: string): string | undefined => {
    const row = database.get(
      'SELECT source_path FROM scenario WHERE project_id = ? AND id = ?',
      projectId,
      scenarioId,
    );
    return row === undefined ? undefined : optionalText(row, 'source_path');
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

  /**
   * The recorded results of one scenario, newest first.
   *
   * Scoped by project for the reason the scenario itself is: a goal is judged from the newest result of the
   * scenario its plan reruns, so a result read across projects would decide a goal in one repository from a
   * run recorded in another. The column was already stamped on every row and the query was not using it.
   */
  const scenarioResults = (
    projectId: string,
    scenarioId: string,
    limit = 20,
  ): readonly ScenarioResult[] =>
    database
      .all(
        `SELECT digest FROM scenario_result WHERE project_id = ? AND scenario_id = ?
         ORDER BY started_at DESC LIMIT ?`,
        projectId,
        scenarioId,
        limit,
      )
      .map((row) => artifacts.getJson<ScenarioResult>(text(row, 'digest')));

  return {
    saveScenario,
    scenarioById,
    scenarioSourceById,
    listScenarios,
    saveScenarioResult,
    scenarioResults,
  };
};
