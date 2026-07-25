import type { ArtifactStore } from './artifacts.ts';
import type { Database } from './database.ts';
import { createExperimentsRepository } from './repositories/experiments.ts';
import { createFindingsRepository } from './repositories/findings.ts';
import { createGoalsRepository } from './repositories/goals.ts';
import { createProjectsRepository } from './repositories/projects.ts';
import { createReportsRepository } from './repositories/reports.ts';
import { createRunsRepository } from './repositories/runs.ts';
import { createScansRepository } from './repositories/scans.ts';
import { createScenariosRepository } from './repositories/scenarios.ts';

/**
 * The store.
 *
 * One surface for callers, composed from repositories that each own the documents of one kind. It holds no orchestration
 * logic and makes no decisions: its only job is to put documents in and take them out, with the queries the product
 * actually performs.
 *
 * Large documents go to the artifact store and the database keeps the columns worth querying, which is why a scan row
 * carries a component count while the graph itself lives behind a digest.
 */

export type { RunSummary, ScanSummary } from './rows.ts';

export type Store = ReturnType<typeof createStore>;

export const createStore = (input: {
  readonly database: Database;
  readonly artifacts: ArtifactStore;
  readonly now: () => string;
}) => {
  const { database, artifacts } = input;
  const projects = createProjectsRepository(input);
  return {
    database,
    artifacts,
    ...projects,
    ...createScansRepository({ ...input, projects }),
    ...createRunsRepository(input),
    ...createFindingsRepository(input),
    ...createGoalsRepository(input),
    ...createScenariosRepository(input),
    ...createExperimentsRepository(input),
    ...createReportsRepository(input),
  };
};
