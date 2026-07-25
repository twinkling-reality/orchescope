import { OrchescopeError, parseGoalSequence } from '@orchescope/domain';
import type {
  BenchmarkReport,
  ChaosReport,
  Comparison,
  ComponentRunMetrics,
  Evidence,
  Finding,
  Goal,
  ReportBundle,
  RunRecord,
  Scenario,
  ScenarioResult,
  SideEffectRecord,
  SystemGraph,
  TraceBundle,
} from '@orchescope/schema';
import type { ArtifactStore } from './artifacts.ts';
import { type Database, asBoolean, asInteger, asNullable } from './database.ts';

/**
 * The store.
 *
 * One object, composed of focused methods grouped by the document they manage. It is not a god service: it
 * holds no orchestration logic and makes no decisions. Its only job is to put documents in and take them
 * out, with the queries the product actually performs.
 *
 * Large documents go to the artifact store and the database keeps the columns worth querying, which is why
 * a scan row carries a component count but the graph itself lives behind a digest.
 */

export type Store = ReturnType<typeof createStore>;

export type ScanSummary = {
  readonly scanId: string;
  readonly graphId: string;
  readonly createdAt: string;
  readonly componentCount: number;
  readonly edgeCount: number;
  readonly gitCommit: string | undefined;
  readonly gitRef: string | undefined;
  readonly gitDirty: boolean;
  readonly digest: string;
};

export type RunSummary = {
  readonly runId: string;
  readonly kind: string;
  readonly label: string;
  readonly status: string;
  readonly startedAt: string;
  readonly scenarioId: string | undefined;
  readonly variantId: string | undefined;
  readonly experimentId: string | undefined;
};

const text = (row: Record<string, unknown>, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new OrchescopeError('STORE_CORRUPT', `Column ${column} was not text.`, {
      detail: { column, type: typeof value },
    });
  }
  return value;
};

const optionalText = (row: Record<string, unknown>, column: string): string | undefined => {
  const value = row[column];
  return typeof value === 'string' ? value : undefined;
};

const integer = (row: Record<string, unknown>, column: string): number => {
  const value = row[column];
  return typeof value === 'number' ? value : 0;
};

export const createStore = (input: {
  readonly database: Database;
  readonly artifacts: ArtifactStore;
  readonly now: () => string;
}) => {
  const { database, artifacts, now } = input;

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

  const saveScan = (graph: SystemGraph, evidence: readonly Evidence[]): ScanSummary =>
    database.transaction(() => {
      ensureProject(graph.provenance.projectId, graph.provenance.projectName, graph.provenance.projectPathHash);
      const digest = artifacts.putJson(graph);
      database.run(
        `INSERT INTO scan (id, project_id, graph_id, graph_digest, created_at, component_count, edge_count,
                           git_commit, git_ref, git_dirty, orchescope_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET graph_digest = excluded.graph_digest,
                                       component_count = excluded.component_count,
                                       edge_count = excluded.edge_count`,
        graph.provenance.scanId,
        graph.provenance.projectId,
        graph.graphId,
        digest,
        graph.provenance.generatedAt,
        graph.components.length,
        graph.edges.length,
        asNullable(graph.provenance.git?.commit),
        asNullable(graph.provenance.git?.ref),
        asInteger(graph.provenance.git?.dirty ?? false),
        graph.provenance.orchescopeVersion,
      );
      database.run('DELETE FROM component WHERE scan_id = ?', graph.provenance.scanId);
      database.run('DELETE FROM edge WHERE scan_id = ?', graph.provenance.scanId);
      for (const component of graph.components) {
        database.run(
          `INSERT INTO component (scan_id, id, kind, display_name, fingerprint, namespace, local_name,
                                  present_static, present_runtime, present_manifest, basis, confidence,
                                  side_effect, json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          graph.provenance.scanId,
          component.id,
          component.kind,
          component.displayName,
          component.fingerprint,
          component.identity.namespace,
          component.identity.localName,
          asInteger(component.presence.static),
          asInteger(component.presence.runtime),
          asInteger(component.presence.manifest),
          component.basis,
          component.confidence,
          asNullable(component.sideEffect),
          JSON.stringify(component),
        );
      }
      for (const edge of graph.edges) {
        database.run(
          `INSERT INTO edge (scan_id, id, kind, from_id, to_id, runtime_only, basis, json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          graph.provenance.scanId,
          edge.id,
          edge.kind,
          edge.from,
          edge.to,
          asInteger(edge.runtimeOnly),
          edge.basis,
          JSON.stringify(edge),
        );
      }
      saveEvidence(evidence);
      return {
        scanId: graph.provenance.scanId,
        graphId: graph.graphId,
        createdAt: graph.provenance.generatedAt,
        componentCount: graph.components.length,
        edgeCount: graph.edges.length,
        gitCommit: graph.provenance.git?.commit,
        gitRef: graph.provenance.git?.ref,
        gitDirty: graph.provenance.git?.dirty ?? false,
        digest,
      };
    });

  const scanSummary = (row: Record<string, unknown>): ScanSummary => ({
    scanId: text(row, 'id'),
    graphId: text(row, 'graph_id'),
    createdAt: text(row, 'created_at'),
    componentCount: integer(row, 'component_count'),
    edgeCount: integer(row, 'edge_count'),
    gitCommit: optionalText(row, 'git_commit'),
    gitRef: optionalText(row, 'git_ref'),
    gitDirty: asBoolean(row['git_dirty']),
    digest: text(row, 'graph_digest'),
  });

  const latestScan = (projectId: string): ScanSummary | undefined => {
    const row = database.get(
      'SELECT * FROM scan WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      projectId,
    );
    return row === undefined ? undefined : scanSummary(row);
  };

  const scanById = (scanId: string): ScanSummary | undefined => {
    const row = database.get('SELECT * FROM scan WHERE id = ?', scanId);
    return row === undefined ? undefined : scanSummary(row);
  };

  const graphForScan = (scanId: string): SystemGraph => {
    const summary = scanById(scanId);
    if (summary === undefined) {
      throw new OrchescopeError('NOT_FOUND', `No scan with identifier ${scanId}.`);
    }
    return artifacts.getJson<SystemGraph>(summary.digest);
  };

  const saveRun = (input: {
    readonly run: RunRecord;
    readonly projectId: string;
    readonly bundle?: TraceBundle;
    readonly componentMetrics?: readonly ComponentRunMetrics[];
    readonly sideEffects?: readonly SideEffectRecord[];
  }): void =>
    database.transaction(() => {
      const traceDigest = input.bundle === undefined ? null : artifacts.putJson(input.bundle);
      database.run(
        `INSERT INTO run (id, project_id, kind, label, status, started_at, finished_at, scenario_id,
                          variant_id, experiment_id, fault_plan_id, repetition, exit_code, trace_digest, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status,
                                       finished_at = excluded.finished_at,
                                       exit_code = excluded.exit_code,
                                       trace_digest = excluded.trace_digest,
                                       json = excluded.json`,
        input.run.id,
        input.projectId,
        input.run.kind,
        input.run.label,
        input.run.status,
        input.run.startedAt,
        asNullable(input.run.finishedAt),
        asNullable(input.run.scenarioId),
        asNullable(input.run.variantId),
        asNullable(input.run.experimentId),
        asNullable(input.run.faultPlanId),
        input.run.repetition ?? null,
        input.run.exitCode ?? null,
        traceDigest,
        JSON.stringify(input.run),
      );

      if (input.bundle !== undefined) {
        database.run('DELETE FROM span WHERE run_id = ?', input.run.id);
        for (const span of input.bundle.spans) {
          database.run(
            `INSERT INTO span (run_id, trace_id, span_id, parent_span_id, name, kind, operation, start_ns,
                               end_ns, duration_ms, status, service_name, component_id, json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            input.run.id,
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
      }

      const effects = input.sideEffects ?? input.bundle?.sideEffects ?? [];
      if (effects.length > 0) {
        database.run('DELETE FROM side_effect WHERE run_id = ?', input.run.id);
        for (const effect of effects) {
          database.run(
            `INSERT INTO side_effect (run_id, span_id, trace_id, kind, target, idempotency_key, outcome,
                                      retry_attempt, time_ns)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT DO NOTHING`,
            input.run.id,
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
      }

      for (const metric of input.componentMetrics ?? input.run.componentMetrics) {
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
          input.run.id,
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
      `SELECT id, kind, label, status, started_at, scenario_id, variant_id, experiment_id
       FROM run WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      ...parameters,
    );
    return rows.map((row) => ({
      runId: text(row, 'id'),
      kind: text(row, 'kind'),
      label: text(row, 'label'),
      status: text(row, 'status'),
      startedAt: text(row, 'started_at'),
      scenarioId: optionalText(row, 'scenario_id'),
      variantId: optionalText(row, 'variant_id'),
      experimentId: optionalText(row, 'experiment_id'),
    }));
  };

  const traceForRun = (runId: string): TraceBundle | undefined => {
    const row = database.get('SELECT trace_digest FROM run WHERE id = ?', runId);
    const digest = row === undefined ? undefined : optionalText(row, 'trace_digest');
    return digest === undefined ? undefined : artifacts.getJson<TraceBundle>(digest);
  };

  const saveFindings = (scanId: string, findings: readonly Finding[]): void =>
    database.transaction(() => {
      database.run('DELETE FROM finding WHERE scan_id = ?', scanId);
      database.run('DELETE FROM finding_component WHERE scan_id = ?', scanId);
      for (const finding of findings) {
        database.run(
          `INSERT INTO finding (id, scan_id, rule_id, category, polarity, severity, confidence, basis,
                                title, goal_eligible, created_at, json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          finding.id,
          scanId,
          finding.ruleId,
          finding.category,
          finding.polarity,
          finding.severity,
          finding.confidence,
          finding.basis,
          finding.title,
          asInteger(finding.goalReadiness.eligible),
          finding.createdAt,
          JSON.stringify(finding),
        );
        for (const componentId of finding.components) {
          database.run(
            `INSERT INTO finding_component (scan_id, finding_id, component_id) VALUES (?, ?, ?)
             ON CONFLICT DO NOTHING`,
            scanId,
            finding.id,
            componentId,
          );
        }
      }
    });

  const listFindings = (input: {
    readonly scanId: string;
    readonly severity?: readonly string[];
    readonly category?: readonly string[];
    readonly polarity?: string;
    readonly componentId?: string;
    readonly limit?: number;
  }): readonly Finding[] => {
    const clauses = ['finding.scan_id = ?'];
    const parameters: (string | number)[] = [input.scanId];
    if (input.severity !== undefined && input.severity.length > 0) {
      clauses.push(`finding.severity IN (${input.severity.map(() => '?').join(', ')})`);
      parameters.push(...input.severity);
    }
    if (input.category !== undefined && input.category.length > 0) {
      clauses.push(`finding.category IN (${input.category.map(() => '?').join(', ')})`);
      parameters.push(...input.category);
    }
    if (input.polarity !== undefined) {
      clauses.push('finding.polarity = ?');
      parameters.push(input.polarity);
    }
    const join =
      input.componentId === undefined
        ? ''
        : 'JOIN finding_component ON finding_component.scan_id = finding.scan_id AND finding_component.finding_id = finding.id';
    if (input.componentId !== undefined) {
      clauses.push('finding_component.component_id = ?');
      parameters.push(input.componentId);
    }
    parameters.push(input.limit ?? 500);
    const rows = database.all(
      `SELECT DISTINCT finding.json AS json, finding.severity AS severity, finding.id AS id
       FROM finding ${join}
       WHERE ${clauses.join(' AND ')}
       ORDER BY CASE finding.severity
                  WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2
                  WHEN 'low' THEN 3 ELSE 4 END, finding.id
       LIMIT ?`,
      ...parameters,
    );
    return rows.map((row) => JSON.parse(text(row, 'json')) as Finding);
  };

  const findingById = (scanId: string, findingId: string): Finding | undefined => {
    const row = database.get('SELECT json FROM finding WHERE scan_id = ? AND id = ?', scanId, findingId);
    return row === undefined ? undefined : (JSON.parse(text(row, 'json')) as Finding);
  };

  const nextGoalSequence = (projectId: string): number => {
    const rows = database.all('SELECT id FROM goal WHERE project_id = ?', projectId);
    let highest = 0;
    for (const row of rows) {
      const sequence = parseGoalSequence(text(row, 'id'));
      if (sequence !== undefined && sequence > highest) highest = sequence;
    }
    return highest + 1;
  };

  const saveGoal = (goal: Goal, projectId: string): void => {
    database.run(
      `INSERT INTO goal (id, project_id, finding_id, title, status, risk, created_at, updated_at, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status,
                                     updated_at = excluded.updated_at,
                                     json = excluded.json`,
      goal.id,
      projectId,
      goal.findingId,
      goal.title,
      goal.status,
      goal.risk,
      goal.createdAt,
      goal.updatedAt,
      JSON.stringify(goal),
    );
  };

  const goalById = (goalId: string): Goal | undefined => {
    const row = database.get('SELECT json FROM goal WHERE id = ?', goalId);
    return row === undefined ? undefined : (JSON.parse(text(row, 'json')) as Goal);
  };

  const listGoals = (projectId: string, status?: string): readonly Goal[] => {
    const rows =
      status === undefined
        ? database.all('SELECT json FROM goal WHERE project_id = ? ORDER BY id', projectId)
        : database.all(
            'SELECT json FROM goal WHERE project_id = ? AND status = ? ORDER BY id',
            projectId,
            status,
          );
    return rows.map((row) => JSON.parse(text(row, 'json')) as Goal);
  };

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

  const evidenceByIds = (ids: readonly string[]): readonly Evidence[] => {
    if (ids.length === 0) return [];
    const rows = database.all(
      `SELECT json FROM evidence WHERE id IN (${ids.map(() => '?').join(', ')})`,
      ...ids,
    );
    return rows.map((row) => JSON.parse(text(row, 'json')) as Evidence);
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

  return {
    database,
    artifacts,
    ensureProject,
    saveEvidence,
    evidenceByIds,
    saveScan,
    latestScan,
    scanById,
    graphForScan,
    saveRun,
    runById,
    listRuns,
    traceForRun,
    sideEffectsForRun,
    componentMetricsForRun,
    saveFindings,
    listFindings,
    findingById,
    nextGoalSequence,
    saveGoal,
    goalById,
    listGoals,
    saveScenario,
    scenarioById,
    listScenarios,
    saveScenarioResult,
    scenarioResults,
    saveBenchmark,
    listBenchmarks,
    saveChaosReport,
    listChaosReports,
    saveComparison,
    comparisonById,
    listComparisons,
    saveReport,
    latestReport,
    reportById,
  };
};
