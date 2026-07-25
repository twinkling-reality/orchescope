/**
 * Schema migrations.
 *
 * The database version lives in `PRAGMA user_version`. Each migration is applied inside a transaction in
 * order, and a database whose version is newer than this build understands is refused rather than opened,
 * because reading a future schema with old code is how data gets corrupted.
 *
 * Rules for adding a migration: append, never edit a released one, and keep every statement forward only.
 * Tables are `STRICT` so a type mismatch is an error at write time rather than a surprise at read time.
 */

export type Migration = {
  readonly version: number;
  readonly description: string;
  readonly statements: readonly string[];
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description:
      'initial schema for projects, scans, graphs, runs, spans, findings, goals and artifacts',
    statements: [
      `CREATE TABLE project (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT`,

      `CREATE TABLE artifact (
        digest TEXT PRIMARY KEY,
        media_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT`,

      `CREATE TABLE scan (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        graph_id TEXT NOT NULL,
        graph_digest TEXT NOT NULL REFERENCES artifact(digest),
        created_at TEXT NOT NULL,
        component_count INTEGER NOT NULL,
        edge_count INTEGER NOT NULL,
        git_commit TEXT,
        git_ref TEXT,
        git_dirty INTEGER NOT NULL,
        orchescope_version TEXT NOT NULL
      ) STRICT`,
      'CREATE INDEX scan_project ON scan(project_id, created_at DESC)',

      `CREATE TABLE component (
        scan_id TEXT NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        namespace TEXT NOT NULL,
        local_name TEXT NOT NULL,
        present_static INTEGER NOT NULL,
        present_runtime INTEGER NOT NULL,
        present_manifest INTEGER NOT NULL,
        basis TEXT NOT NULL,
        confidence REAL NOT NULL,
        side_effect TEXT,
        json TEXT NOT NULL,
        PRIMARY KEY (scan_id, id)
      ) STRICT`,
      'CREATE INDEX component_kind ON component(scan_id, kind)',
      'CREATE INDEX component_fingerprint ON component(fingerprint)',

      `CREATE TABLE edge (
        scan_id TEXT NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        runtime_only INTEGER NOT NULL,
        basis TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (scan_id, id)
      ) STRICT`,
      'CREATE INDEX edge_from ON edge(scan_id, from_id)',
      'CREATE INDEX edge_to ON edge(scan_id, to_id)',

      `CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        basis TEXT NOT NULL,
        producer TEXT NOT NULL,
        json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT`,
      'CREATE INDEX evidence_kind ON evidence(kind)',

      `CREATE TABLE run (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        scenario_id TEXT,
        variant_id TEXT,
        experiment_id TEXT,
        fault_plan_id TEXT,
        repetition INTEGER,
        exit_code INTEGER,
        trace_digest TEXT REFERENCES artifact(digest),
        json TEXT NOT NULL
      ) STRICT`,
      'CREATE INDEX run_project ON run(project_id, started_at DESC)',
      'CREATE INDEX run_scenario ON run(scenario_id, started_at DESC)',
      'CREATE INDEX run_experiment ON run(experiment_id)',

      `CREATE TABLE span (
        run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
        trace_id TEXT NOT NULL,
        span_id TEXT NOT NULL,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        operation TEXT NOT NULL,
        start_ns TEXT NOT NULL,
        end_ns TEXT NOT NULL,
        duration_ms REAL NOT NULL,
        status TEXT NOT NULL,
        service_name TEXT NOT NULL,
        component_id TEXT,
        json TEXT NOT NULL,
        PRIMARY KEY (run_id, span_id)
      ) STRICT`,
      'CREATE INDEX span_trace ON span(run_id, trace_id)',
      'CREATE INDEX span_component ON span(run_id, component_id)',
      'CREATE INDEX span_operation ON span(run_id, operation)',

      `CREATE TABLE side_effect (
        run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
        span_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        idempotency_key TEXT,
        outcome TEXT NOT NULL,
        retry_attempt INTEGER,
        time_ns TEXT NOT NULL,
        PRIMARY KEY (run_id, span_id, kind, target, time_ns)
      ) STRICT`,
      'CREATE INDEX side_effect_key ON side_effect(run_id, kind, target)',

      `CREATE TABLE component_metric (
        run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
        component_id TEXT NOT NULL,
        execution_count INTEGER NOT NULL,
        self_duration_ms REAL NOT NULL,
        total_duration_ms REAL NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        error_count INTEGER NOT NULL,
        retry_count INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (run_id, component_id)
      ) STRICT`,

      `CREATE TABLE finding (
        id TEXT NOT NULL,
        scan_id TEXT NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
        rule_id TEXT NOT NULL,
        category TEXT NOT NULL,
        polarity TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence REAL NOT NULL,
        basis TEXT NOT NULL,
        title TEXT NOT NULL,
        goal_eligible INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (scan_id, id)
      ) STRICT`,
      'CREATE INDEX finding_severity ON finding(scan_id, severity)',
      'CREATE INDEX finding_category ON finding(scan_id, category)',

      `CREATE TABLE finding_component (
        scan_id TEXT NOT NULL,
        finding_id TEXT NOT NULL,
        component_id TEXT NOT NULL,
        PRIMARY KEY (scan_id, finding_id, component_id)
      ) STRICT`,
      'CREATE INDEX finding_component_by_component ON finding_component(scan_id, component_id)',

      `CREATE TABLE goal (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        finding_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        risk TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        json TEXT NOT NULL
      ) STRICT`,
      'CREATE INDEX goal_status ON goal(project_id, status)',

      `CREATE TABLE scenario (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        source_path TEXT,
        schema_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        json TEXT NOT NULL
      ) STRICT`,

      `CREATE TABLE scenario_result (
        id TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES project(id),
        started_at TEXT NOT NULL,
        passed INTEGER NOT NULL,
        digest TEXT NOT NULL REFERENCES artifact(digest)
      ) STRICT`,
      'CREATE INDEX scenario_result_scenario ON scenario_result(scenario_id, started_at DESC)',

      `CREATE TABLE benchmark (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        scenario_id TEXT NOT NULL,
        dimension TEXT NOT NULL,
        started_at TEXT NOT NULL,
        digest TEXT NOT NULL REFERENCES artifact(digest)
      ) STRICT`,

      `CREATE TABLE chaos_report (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        scenario_id TEXT NOT NULL,
        environment TEXT NOT NULL,
        started_at TEXT NOT NULL,
        digest TEXT NOT NULL REFERENCES artifact(digest)
      ) STRICT`,

      `CREATE TABLE comparison (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        goal_id TEXT,
        baseline_reference TEXT NOT NULL,
        candidate_reference TEXT NOT NULL,
        verdict TEXT NOT NULL,
        created_at TEXT NOT NULL,
        digest TEXT NOT NULL REFERENCES artifact(digest)
      ) STRICT`,
      'CREATE INDEX comparison_goal ON comparison(goal_id, created_at DESC)',

      `CREATE TABLE report (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        scan_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        digest TEXT NOT NULL REFERENCES artifact(digest)
      ) STRICT`,
      'CREATE INDEX report_project ON report(project_id, created_at DESC)',
    ],
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);
