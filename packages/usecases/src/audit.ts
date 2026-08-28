import { discover } from '@orchescope/discovery';
import {
  createDeadline,
  type Deadline,
  formatCount,
  OrchescopeError,
  runIsSilent,
} from '@orchescope/domain';
import { evaluateRules, linkConflicts } from '@orchescope/findings';
import { computeDelta, indexGraph, type RunSideEffects, reconcile } from '@orchescope/graph';
import { buildReportBundle, REPORT_EVIDENCE_CEILING } from '@orchescope/report';
import type {
  ComponentId,
  ComponentRunMetrics,
  EvaluatorResult,
  Evidence,
  Finding,
  FindingSet,
  Goal,
  GoalValidationSummary,
  ReconciliationDelta,
  ReportBundle,
  RunRecord,
  SystemGraph,
} from '@orchescope/schema';
import { DEFAULT_EXCLUDED_DIRECTORIES, type FactCache } from '@orchescope/source-analysis';
import { deriveTopology } from '@orchescope/traces';
import { readGitRepositoryPath, readTrackedPaths, type Workspace } from '@orchescope/workspace';
import { resolveCapabilities } from './capabilities.ts';
import { judgeGoal } from './goal.ts';
import { discoverScenarios } from './scenario.ts';
import {
  type ObservedMetrics,
  observedKeyToComponentId,
  resolveComponentMetrics,
} from './runtime-attribution.ts';

/**
 * The audit use case.
 *
 * The pipeline order is fixed and cheap first: manifests and configuration, then source facts, then adapters,
 * then runtime reconciliation against runs already in the store, then deterministic rules, then the report.
 * Nothing in it requires a model or a network, which is what makes the first run useful on a repository nobody
 * has instrumented yet.
 */

export type AuditRequest = {
  readonly workspace: Workspace;
  readonly orchescopeVersion: string;
  /** How many recent runs to reconcile against. Zero performs a static only audit. */
  readonly runLimit?: number;
  readonly deadline?: Deadline;
  readonly cache?: FactCache;
};

export type AuditResult = {
  readonly graph: SystemGraph;
  readonly findingSet: FindingSet;
  readonly reconciliation: ReconciliationDelta | undefined;
  readonly bundle: ReportBundle;
  readonly reportDigest: string;
  readonly agentSystemDetected: boolean;
  /** Runs that produced at least one span, which are the runs this report reconciled against. */
  readonly runsConsidered: readonly RunRecord[];
  /** Runs that were recorded and produced no span. Named so a caller can say so, never reasoned from. */
  readonly silentRuns: readonly RunRecord[];
  readonly scanId: string;
};

const MAX_AUDIT_RUNS = 100;

const validatedRunLimit = (value: number | undefined): number => {
  const limit = value ?? 10;
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_AUDIT_RUNS) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `The audit run limit must be an integer from 0 through ${MAX_AUDIT_RUNS}.`,
      { remediation: `Set --runs to a value from 0 through ${MAX_AUDIT_RUNS}.` },
    );
  }
  return limit;
};

/**
 * Only the newest experiment per subject is used.
 *
 * A stored history is valuable, and feeding all of it to the rules is not: an old chaos report describes behaviour that
 * a later change may have fixed, and reporting both would put two contradicting findings in front of a reader with no
 * way to tell which is current.
 */
const latestChaosReports = (workspace: Workspace) => {
  const bySubject = new Map<string, ReturnType<typeof workspace.store.listChaosReports>[number]>();
  for (const report of workspace.store.listChaosReports(workspace.projectId, 50)) {
    const key = `${report.scenarioId}|${report.environment}`;
    const current = bySubject.get(key);
    if (current === undefined || current.startedAt < report.startedAt) bySubject.set(key, report);
  }
  return [...bySubject.values()];
};

const latestBenchmarks = (workspace: Workspace) => {
  const bySubject = new Map<string, ReturnType<typeof workspace.store.listBenchmarks>[number]>();
  for (const report of workspace.store.listBenchmarks(workspace.projectId, 50)) {
    const key = `${report.scenarioId}|${report.dimension}`;
    const current = bySubject.get(key);
    if (current === undefined || current.startedAt < report.startedAt) bySubject.set(key, report);
  }
  return [...bySubject.values()];
};

type ReconcileStage = {
  readonly graph: SystemGraph;
  readonly evidence: readonly Evidence[];
  readonly reconciliation: ReconciliationDelta | undefined;
  /** Runs that produced at least one span. Everything runtime in this report rests on these. */
  readonly observedRuns: readonly RunRecord[];
  /** Runs that were recorded and produced no span. Reported, and never reasoned from. */
  readonly silentRuns: readonly RunRecord[];
};

/**
 * Joins the stored runs to the static graph.
 *
 * Attribution matters here: a span carries the observed component key, and reconciliation resolved that observed
 * component to a declared one. Joining the two is what lets a duplicated effect name the tool that produced it rather
 * than saying only that duplication happened.
 *
 * A run whose bundle holds no span is set aside before any of that. `importTrace` already refuses a file that yields
 * no span, on the grounds that an empty run would reconcile as though nothing ran; the same is true of a traced run
 * that exported nothing, and that one has to be stored because it happened. Feeding it to reconciliation produced a
 * delta in which every declared component was unexercised, which is the absence of a measurement wearing the shape of
 * one. Excluding it here rather than in each rule is what makes the guarantee hold for a rule written later.
 */
const reconcileStoredRuns = (input: {
  readonly workspace: Workspace;
  readonly graph: SystemGraph;
  readonly runLimit: number;
}): ReconcileStage => {
  const { workspace, runLimit } = input;
  const evidence: Evidence[] = [];
  const observedRuns: RunRecord[] = [];
  const silentRuns: RunRecord[] = [];
  if (runLimit <= 0) {
    return { graph: input.graph, evidence, reconciliation: undefined, observedRuns, silentRuns };
  }

  const ingestPhase = workspace.progress.phase('reconcile', 'Reconciling runtime evidence');
  const summaries = workspace.store.listRuns({ projectId: workspace.projectId, limit: runLimit });
  const topologies = [];
  const runSideEffects: RunSideEffects[] = [];
  const spanToComponentKey = new Map<string, string>();
  const metricsByRun: { readonly runId: string; readonly metrics: ObservedMetrics }[] = [];
  for (const summary of summaries) {
    const run = workspace.store.runById(summary.runId);
    const bundle = workspace.store.traceForRun(summary.runId);
    if (run === undefined || bundle === undefined) continue;
    if (runIsSilent(bundle.spans.length)) {
      silentRuns.push(run);
      continue;
    }
    const derived = deriveTopology(bundle);
    topologies.push(derived.topology);
    evidence.push(...derived.evidence);
    observedRuns.push(run);
    runSideEffects.push({ runId: summary.runId, sideEffects: bundle.sideEffects });
    metricsByRun.push({ runId: summary.runId, metrics: derived.componentMetricsByName });
    for (const [spanId, key] of derived.spanToComponentKey) spanToComponentKey.set(spanId, key);
  }

  if (topologies.length === 0) {
    ingestPhase.skip(
      silentRuns.length === 0
        ? 'no run with trace data is stored for this project'
        : `${formatCount(silentRuns.length, 'recorded run')} produced no span, so there is nothing to reconcile against`,
    );
    return { graph: input.graph, evidence, reconciliation: undefined, observedRuns, silentRuns };
  }

  const reconciled = reconcile(input.graph, topologies);
  evidence.push(...reconciled.evidence);

  const componentIdByKey = observedKeyToComponentId(reconciled);
  const spanToComponent = new Map<string, ComponentId>();
  for (const [spanId, key] of spanToComponentKey) {
    const componentId = componentIdByKey.get(key);
    if (componentId !== undefined) spanToComponent.set(spanId, componentId);
  }

  let attributed = 0;
  for (const entry of metricsByRun) {
    const resolved = resolveComponentMetrics(
      entry.metrics,
      componentIdByKey,
      workspace.config.pricing,
    );
    workspace.store.saveComponentMetrics(entry.runId, resolved);
    attributed += resolved.length;
  }

  const delta = computeDelta({
    graph: reconciled.graph,
    runs: runSideEffects,
    spanToComponent,
    matches: reconciled.matches,
    ambiguous: reconciled.ambiguous,
    missingSpanAttributes: reconciled.missingSpanAttributes,
    behavior: reconciled.behavior,
  });
  evidence.push(...delta.evidence);
  ingestPhase.finish(
    `${formatCount(topologies.length, 'run')} reconciled, ${formatCount(attributed, 'component metric')} attributed, ${formatCount(delta.delta.exercisedNotDeclared.components.length, 'component without an exact static identity match')}, ${formatCount(delta.delta.contradictions.length, 'contradiction')}`,
  );
  return {
    graph: reconciled.graph,
    evidence,
    reconciliation: delta.delta,
    observedRuns,
    silentRuns,
  };
};

/**
 * The evaluator outcomes a scenario run was judged by, keyed by run.
 *
 * A scenario result is stored per run of the scenario and holds one repetition per execution, and each repetition
 * carries the criteria it was judged against. The report shows those outcomes beside the run, so the join is by run
 * identifier: a reader looking at a scenario run should see what passed and what did not, not only that it finished.
 */
const evaluatorsByRun = (
  workspace: Workspace,
  runs: readonly RunRecord[],
): ReadonlyMap<string, readonly EvaluatorResult[]> => {
  const wanted = new Set(runs.map((run) => run.id));
  const scenarioIds = new Set(
    runs.map((run) => run.scenarioId).filter((id): id is string => id !== undefined),
  );
  const byRun = new Map<string, readonly EvaluatorResult[]>();
  for (const scenarioId of scenarioIds) {
    for (const result of workspace.store.scenarioResults(workspace.projectId, scenarioId)) {
      for (const repetition of result.repetitions) {
        if (!wanted.has(repetition.runId)) continue;
        byRun.set(repetition.runId, repetition.evaluators);
      }
    }
  }
  return byRun;
};

/**
 * What each goal's acceptance criteria decide against this scan.
 *
 * The audit is the moment every input a goal is judged on is in hand at once: the rescan has just
 * happened, the scenario results and the comparison the goal was attached to are in the store, and the
 * findings are the ones this report is about. Judging here is what lets the Goals screen say which
 * criteria were satisfied and which the evidence could not decide. Without it the screen has only the
 * comparison log to go on, and a goal that has been validated but has no comparison attached reads as a
 * goal nobody ever tried to verify, which is a stronger claim than the report can make.
 */
const judgementsForGoals = (
  workspace: Workspace,
  goals: readonly Goal[],
  findings: readonly Finding[],
): readonly GoalValidationSummary[] =>
  goals.map((goal) => {
    const validation = judgeGoal({ workspace, goal, findings, rescanned: true });
    const comparisonId = workspace.store.latestComparisonForGoal(goal.id, goal.createdAt)?.id;
    return {
      goalId: goal.id,
      validated: validation.validated,
      satisfiedCount: validation.satisfiedCount,
      undecidedCount: validation.undecidedCount,
      summary: validation.summary,
      ...(comparisonId === undefined ? {} : { comparisonId }),
      outcomes: validation.outcomes.map((outcome) => ({
        criterionId: outcome.criterion.id,
        satisfied: outcome.satisfied,
        decided: outcome.decided,
        detail: outcome.detail,
      })),
    };
  });

const evidenceDependencies = (record: Evidence): readonly string[] => {
  if (record.kind === 'derived') return record.inputs;
  if (record.kind === 'model_interpretation') return record.groundedIn;
  return [];
};

/** Loads a bounded, cycle-safe closure for citations retained by goals across rescans. */
const historicalGoalEvidence = (
  workspace: Workspace,
  goals: readonly Goal[],
): readonly Evidence[] => {
  const pending = [...new Set(goals.flatMap((goal) => goal.evidence))].sort();
  const requested = new Set<string>();
  const records = new Map<string, Evidence>();
  while (pending.length > 0 && records.size <= REPORT_EVIDENCE_CEILING) {
    const remaining = REPORT_EVIDENCE_CEILING + 1 - records.size;
    const batch: string[] = [];
    while (pending.length > 0 && batch.length < Math.min(100, remaining)) {
      const id = pending.shift();
      if (id === undefined || requested.has(id)) continue;
      requested.add(id);
      batch.push(id);
    }
    if (batch.length === 0) continue;
    const loaded = [...workspace.store.evidenceByIds(batch)].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    );
    for (const record of loaded) {
      records.set(record.id, record);
      for (const dependency of evidenceDependencies(record)) {
        if (!requested.has(dependency)) pending.push(dependency);
      }
    }
    pending.sort();
  }
  if (records.size > REPORT_EVIDENCE_CEILING) {
    throw new OrchescopeError(
      'LIMIT_EXCEEDED',
      `Retained goals require more than ${REPORT_EVIDENCE_CEILING} historical evidence records, above the report export ceiling.`,
      {
        detail: { required: records.size, ceiling: REPORT_EVIDENCE_CEILING },
        remediation:
          'Narrow the inspected repository with analysis.exclude; required goal evidence is never truncated.',
      },
    );
  }
  return [...records.values()];
};

const assembleReport = (input: {
  readonly workspace: Workspace;
  readonly graph: SystemGraph;
  readonly findings: readonly Finding[];
  readonly evidence: readonly Evidence[];
  readonly runsConsidered: readonly RunRecord[];
  readonly silentRuns: readonly RunRecord[];
  readonly componentMetrics: readonly ComponentRunMetrics[];
  readonly reconciliation: ReconciliationDelta | undefined;
}): ReportBundle => {
  const { workspace, graph, findings, runsConsidered } = input;
  const scenarios = workspace.store.listScenarios(workspace.projectId);
  const goals = workspace.store.listGoals(workspace.projectId);
  const retainedGoalEvidence = historicalGoalEvidence(workspace, goals);
  const reportEvidence = [
    ...new Map(
      [...input.evidence, ...retainedGoalEvidence].map((record) => [record.id, record]),
    ).values(),
  ];
  const evaluators = evaluatorsByRun(workspace, runsConsidered);
  const componentsByRun = new Map<string, readonly string[]>();
  for (const run of runsConsidered) {
    componentsByRun.set(
      run.id,
      workspace.store.componentMetricsForRun(run.id).map((metric) => metric.componentId),
    );
  }

  return buildReportBundle({
    graph,
    findings,
    evidence: reportEvidence,
    runs: runsConsidered,
    silentRuns: input.silentRuns,
    scenarios,
    scenarioRuns: runsConsidered
      .filter((run) => run.scenarioId !== undefined)
      .map((run) => ({
        runId: run.id,
        scenarioId: run.scenarioId as string,
        scenarioName:
          scenarios.find((scenario) => scenario.id === run.scenarioId)?.name ??
          (run.scenarioId as string),
        ...(run.variantId === undefined ? {} : { variantId: run.variantId }),
        status: run.status,
        ...(run.metrics.taskSuccess === undefined ? {} : { taskSuccess: run.metrics.taskSuccess }),
        durationMs: run.metrics.durationMs,
        evaluators: [...(evaluators.get(run.id) ?? [])],
        faultsApplied: run.faultPlanId === undefined ? [] : [run.faultPlanId],
      })),
    componentMetrics: input.componentMetrics,
    benchmarks: latestBenchmarks(workspace),
    chaosReports: latestChaosReports(workspace),
    comparisons: workspace.store.listComparisons(workspace.projectId),
    goals,
    goalValidations: judgementsForGoals(workspace, goals, findings),
    reconciliation: input.reconciliation,
    capabilities: resolveCapabilities({
      workspace,
      scenarioCount: scenarios.length,
      runCount: runsConsidered.length,
      hasEligibleFindings: findings.some((finding) => finding.goalReadiness.eligible),
      tokensObserved: input.componentMetrics.some(
        (metric) => metric.inputTokens + metric.outputTokens > 0,
      ),
    }),
    generatedAt: graph.provenance.generatedAt,
    redactor: workspace.redactor,
    componentsByRun,
  });
};

const gitForScan = (workspace: Workspace) => {
  if (workspace.git === undefined) return undefined;
  const repositoryPath = readGitRepositoryPath(workspace.paths.root);
  return { ...workspace.git, ...(repositoryPath === undefined ? {} : { repositoryPath }) };
};

export const runAudit = async (request: AuditRequest): Promise<AuditResult> => {
  const { workspace } = request;
  const { config } = workspace;
  const runLimit = validatedRunLimit(request.runLimit);
  const handle =
    request.deadline === undefined
      ? createDeadline(config.analysis.timeoutMs, workspace.clock.monotonicMs)
      : undefined;
  const deadline = request.deadline ?? (handle as Deadline);

  try {
    /*
     * The scenario files on disk are the truth; the store is a cache of them. Reading them here rather
     * than in each caller is what keeps the surfaces agreeing: the rules below and the bundle both ask
     * the store what scenarios exist, so a caller that forgot this step got an audit that reported no
     * scenario in a repository that has three, and a next action pointing at `trace` with a placeholder
     * command instead of at the scenario it could have rerun. The command line called it and the agent
     * interface did not, which made the two surfaces disagree about the same repository.
     */
    discoverScenarios(workspace);

    const discoverPhase = workspace.progress.phase('discover', 'Discovering components');
    /*
     * What git keeps, which decides any disagreement with the ignore rules. Read once per audit rather than
     * per directory, and absent when the root is not a checkout, in which case the rules are all there is.
     */
    const tracked = readTrackedPaths(workspace.paths.root);
    const git = gitForScan(workspace);
    const scan = await discover({
      /*
       * Parsing is the longest thing this command does and it is synchronous throughout, so without
       * this the phase reported nothing between starting and finishing and the spinner had no moment
       * to advance in. The total is known once the walk is done, so this is a real count rather than
       * an invented percentage.
       */
      onFileParsed: (completed, total) => {
        discoverPhase.step(completed, undefined, total);
      },
      root: workspace.paths.root,
      projectName: workspace.projectName,
      orchescopeVersion: request.orchescopeVersion,
      clock: workspace.clock,
      deadline,
      traversal: {
        maxFileBytes: config.analysis.maxFileBytes,
        maxFiles: config.analysis.maxFiles,
        followSymlinks: config.analysis.followSymlinks,
        excludeDirectories:
          config.analysis.exclude.length > 0
            ? config.analysis.exclude
            : DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
        /*
         * The repository's own statement about what is part of it, which is a better answer than the name
         * list beside it and is the author's rather than this build's. A file excluded this way is named
         * in coverage with the rule that excluded it, so a reader who disagrees can see what happened.
         */
        respectIgnoreFiles: true,
        ...(tracked === undefined ? {} : { trackedPaths: tracked.paths }),
      },
      ...(tracked === undefined ? {} : { trackedFileCount: tracked.fileCount }),
      concurrency: config.analysis.concurrency,
      ...(request.cache === undefined ? {} : { cache: request.cache }),
      ...(git === undefined ? {} : { git }),
    });
    discoverPhase.finish(
      `${formatCount(scan.graph.components.length, 'component')}, ${formatCount(scan.graph.edges.length, 'edge')}, ${formatCount(scan.graph.coverage.filesParsed, 'file')} parsed`,
    );

    const evidence: Evidence[] = [...scan.evidence];
    const reconciled = reconcileStoredRuns({
      workspace,
      graph: scan.graph,
      runLimit,
    });
    evidence.push(...reconciled.evidence);
    const graph = reconciled.graph;
    const reconciliation = reconciled.reconciliation;
    const runsConsidered = reconciled.observedRuns;
    const silentRuns = reconciled.silentRuns;

    const analysePhase = workspace.progress.phase('analyse', 'Reviewing findings');
    const indexed = indexGraph(graph);
    const evidenceById = new Map(evidence.map((record) => [record.id, record]));
    const componentMetrics = runsConsidered.flatMap((run) =>
      workspace.store.componentMetricsForRun(run.id),
    );
    const evaluated = evaluateRules({
      scanId: graph.provenance.scanId,
      generatedAt: graph.provenance.generatedAt,
      graph: indexed,
      context: {
        delta: reconciliation,
        observedRuns: runsConsidered.map((run) => ({
          run,
          componentMetrics: workspace.store.componentMetricsForRun(run.id),
        })),
        silentRuns,
        benchmarks: latestBenchmarks(workspace),
        chaosReports: latestChaosReports(workspace),
        scenarios: workspace.store.listScenarios(workspace.projectId),
        evidenceById,
      },
    });
    evidence.push(...evaluated.evidence);
    const findings: readonly Finding[] = linkConflicts(evaluated.findingSet.findings);
    const findingSet: FindingSet = { ...evaluated.findingSet, findings: [...findings] };
    analysePhase.finish(
      `${formatCount(findings.filter((finding) => finding.polarity === 'risk').length, 'finding')}, ${formatCount(findings.filter((finding) => finding.polarity === 'strength').length, 'strength')}`,
    );

    const reportPhase = workspace.progress.phase('report', 'Generating report');
    workspace.store.saveScan(graph, evidence);
    workspace.store.saveFindings(graph.provenance.scanId, findings);

    const componentsByRun = new Map<string, readonly string[]>();
    for (const run of runsConsidered) {
      componentsByRun.set(
        run.id,
        workspace.store.componentMetricsForRun(run.id).map((metric) => metric.componentId),
      );
    }

    const bundle = assembleReport({
      workspace,
      graph,
      findings,
      evidence,
      runsConsidered,
      silentRuns,
      componentMetrics,
      reconciliation,
    });
    const reportDigest = workspace.store.saveReport(bundle, workspace.projectId);
    reportPhase.finish(`report ${bundle.reportId}`);

    return {
      graph,
      findingSet,
      reconciliation,
      bundle,
      reportDigest,
      agentSystemDetected: scan.agentSystemDetected,
      runsConsidered,
      silentRuns,
      scanId: graph.provenance.scanId,
    };
  } finally {
    handle?.dispose();
  }
};
