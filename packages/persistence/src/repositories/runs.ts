import type {
  ComponentRunMetrics,
  RunRecord,
  SideEffectRecord,
  TraceBundle,
} from '@orchescope/schema';
import type { ArtifactStore } from '../artifacts.ts';
import { asNullable, type Database } from '../database.ts';
import type { ExercisingRun, RunSummary } from '../rows.ts';
import { integer, optionalText, text } from '../rows.ts';

/**
 * Runs, traces and per component metrics.
 *
 * A run row carries the columns a listing needs; the spans and the side effects live behind digests, because a trace is
 * large and is read only when a run is examined.
 */

export type SaveRunRequest = {
  readonly run: RunRecord;
  readonly projectId: string;
  readonly bundle?: TraceBundle;
  readonly componentMetrics?: readonly ComponentRunMetrics[];
  readonly sideEffects?: readonly SideEffectRecord[];
};

const writeRunRow = (
  database: Database,
  request: SaveRunRequest,
  traceDigest: string | null,
): void => {
  const { run } = request;
  database.run(
    `INSERT INTO run (id, project_id, kind, label, status, started_at, finished_at, scenario_id,
                      variant_id, experiment_id, fault_plan_id, repetition, exit_code, trace_digest, json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status,
                                   finished_at = excluded.finished_at,
                                   exit_code = excluded.exit_code,
                                   trace_digest = excluded.trace_digest,
                                   json = excluded.json`,
    run.id,
    request.projectId,
    run.kind,
    run.label,
    run.status,
    run.startedAt,
    asNullable(run.finishedAt),
    asNullable(run.scenarioId),
    asNullable(run.variantId),
    asNullable(run.experimentId),
    asNullable(run.faultPlanId),
    run.repetition ?? null,
    run.exitCode ?? null,
    traceDigest,
    JSON.stringify(run),
  );
};

/** Spans are replaced rather than merged: a rerun of the same identifier describes a different execution. */
const writeSpans = (database: Database, runId: string, bundle: TraceBundle): void => {
  database.run('DELETE FROM span WHERE run_id = ?', runId);
  for (const span of bundle.spans) {
    database.run(
      `INSERT INTO span (run_id, trace_id, span_id, parent_span_id, name, kind, operation, start_ns,
                         end_ns, duration_ms, status, service_name, component_id, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      runId,
      span.traceId,
      span.spanId,
      asNullable(span.parentSpanId),
      span.name,
      span.kind,
      span.operation,
      span.startTimeUnixNano,
      span.endTimeUnixNano,
      span.durationMs,
      span.status,
      span.serviceName,
      asNullable(span.componentId),
      JSON.stringify(span),
    );
  }
};

const writeSideEffects = (
  database: Database,
  runId: string,
  effects: readonly SideEffectRecord[],
): void => {
  if (effects.length === 0) return;
  database.run('DELETE FROM side_effect WHERE run_id = ?', runId);
  for (const effect of effects) {
    database.run(
      `INSERT INTO side_effect (run_id, span_id, trace_id, kind, target, idempotency_key, outcome,
                                retry_attempt, time_ns)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      runId,
      effect.spanId,
      effect.traceId,
      effect.kind,
      effect.target,
      asNullable(effect.idempotencyKey),
      effect.outcome,
      effect.retryAttempt ?? null,
      effect.timeUnixNano,
    );
  }
};

const writeComponentMetrics = (
  database: Database,
  runId: string,
  metrics: readonly ComponentRunMetrics[],
): void => {
  for (const metric of metrics) {
    database.run(
      `INSERT INTO component_metric (run_id, component_id, execution_count, self_duration_ms,
                                     total_duration_ms, input_tokens, output_tokens, error_count,
                                     retry_count, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, component_id) DO UPDATE SET
         execution_count = excluded.execution_count,
         self_duration_ms = excluded.self_duration_ms,
         total_duration_ms = excluded.total_duration_ms,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         error_count = excluded.error_count,
         retry_count = excluded.retry_count,
         json = excluded.json`,
      runId,
      metric.componentId,
      metric.executionCount,
      metric.selfDurationMs,
      metric.totalDurationMs,
      metric.inputTokens,
      metric.outputTokens,
      metric.errorCount,
      metric.retryCount,
      JSON.stringify(metric),
    );
  }
};

const summaryFrom = (row: Record<string, unknown>): RunSummary => ({
  runId: text(row, 'id'),
  kind: text(row, 'kind'),
  label: text(row, 'label'),
  status: text(row, 'status'),
  startedAt: text(row, 'started_at'),
  scenarioId: optionalText(row, 'scenario_id'),
  variantId: optionalText(row, 'variant_id'),
  faultPlanId: optionalText(row, 'fault_plan_id'),
  experimentId: optionalText(row, 'experiment_id'),
});

export const createRunsRepository = (input: {
  readonly database: Database;
  readonly artifacts: ArtifactStore;
}) => {
  const { database, artifacts } = input;

  const saveRun = (request: SaveRunRequest): void =>
    database.transaction(() => {
      const traceDigest = request.bundle === undefined ? null : artifacts.putJson(request.bundle);
      writeRunRow(database, request, traceDigest);
      if (request.bundle !== undefined) writeSpans(database, request.run.id, request.bundle);
      writeSideEffects(
        database,
        request.run.id,
        request.sideEffects ?? request.bundle?.sideEffects ?? [],
      );
      writeComponentMetrics(
        database,
        request.run.id,
        request.componentMetrics ?? request.run.componentMetrics,
      );
    });

  const runById = (runId: string): RunRecord | undefined => {
    const row = database.get('SELECT json FROM run WHERE id = ?', runId);
    return row === undefined ? undefined : (JSON.parse(text(row, 'json')) as RunRecord);
  };

  const listRuns = (input: {
    readonly projectId: string;
    readonly scenarioId?: string;
    readonly experimentId?: string;
    readonly limit?: number;
  }): readonly RunSummary[] => {
    const clauses = ['project_id = ?'];
    const parameters: (string | number)[] = [input.projectId];
    if (input.scenarioId !== undefined) {
      clauses.push('scenario_id = ?');
      parameters.push(input.scenarioId);
    }
    if (input.experimentId !== undefined) {
      clauses.push('experiment_id = ?');
      parameters.push(input.experimentId);
    }
    parameters.push(input.limit ?? 100);
    const rows = database.all(
      `SELECT id, kind, label, status, started_at, scenario_id, variant_id, fault_plan_id, experiment_id
       FROM run WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      ...parameters,
    );
    return rows.map(summaryFrom);
  };

  /**
   * The runs that executed at least one of these components, newest first.
   *
   * This is the declared against exercised join asked backwards, and it is the only honest way to decide
   * which recorded work a goal is about. The alternative it replaces was a fixed window of the newest
   * runs in the project, which relates a baseline to the finding by nothing at all, and a match between
   * a scenario's tags and a component's name, which the corpus measures wrong in a fifth of the matches
   * it makes inside one repository.
   *
   * A component identifier is a graph identifier and never a framework name, so nothing here is a
   * catalogue. The limit is a ceiling on work rather than a selection rule: the `WHERE` clause is what
   * selects, and it is answered from an index on the component.
   */
  const runsExercising = (input: {
    readonly projectId: string;
    readonly componentIds: readonly string[];
    readonly limit?: number;
  }): readonly ExercisingRun[] => {
    if (input.componentIds.length === 0) return [];
    const placeholders = input.componentIds.map(() => '?').join(', ');
    const rows = database.all(
      `SELECT run.id, run.kind, run.label, run.status, run.started_at, run.scenario_id,
              run.variant_id, run.fault_plan_id, run.experiment_id,
              COUNT(cm.component_id) AS exercised
       FROM run
       JOIN component_metric cm ON cm.run_id = run.id AND cm.component_id IN (${placeholders})
       WHERE run.project_id = ? AND run.status = 'completed'
       GROUP BY run.id
       ORDER BY run.started_at DESC, run.rowid DESC LIMIT ?`,
      ...input.componentIds,
      input.projectId,
      input.limit ?? 100,
    );
    return rows.map((row) => ({
      ...summaryFrom(row),
      exercisedComponents: integer(row, 'exercised'),
    }));
  };

  /**
   * How many spans one run produced, without reading the bundle back.
   *
   * The bundle is large and lives behind a digest, and the question "did this run measure anything" is
   * asked of every run a comparison touches. The span rows carry the answer already.
   */
  const spanCountForRun = (runId: string): number => {
    const row = database.get('SELECT COUNT(*) AS spans FROM span WHERE run_id = ?', runId);
    const value = row === undefined ? 0 : row['spans'];
    return typeof value === 'number' ? value : 0;
  };

  const traceForRun = (runId: string): TraceBundle | undefined => {
    const row = database.get('SELECT trace_digest FROM run WHERE id = ?', runId);
    const digest = row === undefined ? undefined : optionalText(row, 'trace_digest');
    return digest === undefined ? undefined : artifacts.getJson<TraceBundle>(digest);
  };

  const sideEffectsForRun = (runId: string): readonly SideEffectRecord[] =>
    database
      .all('SELECT * FROM side_effect WHERE run_id = ? ORDER BY time_ns', runId)
      .map((row) => ({
        kind: text(row, 'kind'),
        target: text(row, 'target'),
        ...(optionalText(row, 'idempotency_key') === undefined
          ? {}
          : { idempotencyKey: text(row, 'idempotency_key') }),
        traceId: text(row, 'trace_id'),
        spanId: text(row, 'span_id'),
        spanName: 'stored',
        outcome: text(row, 'outcome') as SideEffectRecord['outcome'],
        ...(typeof row['retry_attempt'] === 'number' ? { retryAttempt: row['retry_attempt'] } : {}),
        timeUnixNano: text(row, 'time_ns'),
      }));

  const componentMetricsForRun = (runId: string): readonly ComponentRunMetrics[] =>
    database
      .all('SELECT json FROM component_metric WHERE run_id = ?', runId)
      .map((row) => JSON.parse(text(row, 'json')) as ComponentRunMetrics);

  /**
   * Replaces the per component metrics for one run.
   *
   * A trace knows the name a component reported and nothing about component identity, because identity comes from a
   * graph and a graph only exists once a scan has run. The audit that resolved those names is therefore what writes
   * these rows, and it replaces them rather than merging: a later scan can resolve the same observed name to a
   * different component, and two answers for one run would be a contradiction with no way to tell which is current.
   */
  const saveComponentMetrics = (runId: string, metrics: readonly ComponentRunMetrics[]): void =>
    database.transaction(() => {
      database.run('DELETE FROM component_metric WHERE run_id = ?', runId);
      writeComponentMetrics(database, runId, metrics);
    });

  return {
    saveRun,
    saveComponentMetrics,
    runById,
    listRuns,
    runsExercising,
    spanCountForRun,
    traceForRun,
    sideEffectsForRun,
    componentMetricsForRun,
  };
};
