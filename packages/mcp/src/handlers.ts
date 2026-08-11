import { writeFileSync } from 'node:fs';
import { formatCount, OrchescopeError, stableJson } from '@orchescope/domain';
import { renderAgentPrompt } from '@orchescope/goals';
import { loopProgress, resolveNextAction, toMermaid, toSarif } from '@orchescope/report';
import type { Component, Edge, Finding } from '@orchescope/schema';
import { formatIssues, validate } from '@orchescope/schema';
import {
  compareUseCase,
  createGoalFromFinding,
  discoverScenarios,
  importTrace,
  loadScenario,
  runAudit,
  runBenchmarkUseCase,
  runChaosUseCase,
  runScenarioUseCase,
  runTrace,
  validateGoalOutcome,
} from '@orchescope/usecases';
import type { Workspace } from '@orchescope/workspace';
import { resolveInsideRoot } from '@orchescope/workspace';
import { toAgentNextAction } from './loop-action.ts';
import { type ToolDefinition, toolByName } from './tools.ts';

/**
 * Tool handlers.
 *
 * Every handler validates its arguments against the same TypeBox schema the tool advertises, refuses an effectful
 * operation the project policy has not granted, and returns bounded output. A handler never returns a whole graph
 * or a whole report: it returns counts, a page of items and identifiers the caller can follow up on.
 */

export type ToolOutcome = {
  readonly text: string;
  readonly data: Record<string, unknown>;
  readonly isError?: boolean;
};

export type HandlerContext = {
  readonly workspace: Workspace;
  readonly orchescopeVersion: string;
};

const DEFAULT_LIMIT = 20;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const number = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const string = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const stringArray = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;

const requireScan = (workspace: Workspace) => {
  const scan = workspace.store.latestScan(workspace.projectId);
  if (scan === undefined) {
    throw new OrchescopeError('NOT_FOUND', 'No scan is stored for this project yet.', {
      remediation: 'Call scan_agent_system or audit_agent_system first.',
    });
  }
  return scan;
};

const componentLine = (component: Component): Record<string, unknown> => ({
  id: component.id,
  kind: component.kind,
  name: component.displayName,
  presence: component.presence,
  basis: component.basis,
  confidence: component.confidence,
  sourceLocation:
    component.sourceLocations[0] === undefined
      ? undefined
      : `${component.sourceLocations[0].file}:${component.sourceLocations[0].startLine}`,
  sideEffect: component.sideEffect,
});

const edgeLine = (edge: Edge): Record<string, unknown> => ({
  id: edge.id,
  kind: edge.kind,
  from: edge.from,
  to: edge.to,
  runtimeOnly: edge.runtimeOnly,
  executions: edge.observation?.executionCount ?? 0,
});

const findingLine = (finding: Finding): Record<string, unknown> => ({
  id: finding.id,
  severity: finding.severity,
  polarity: finding.polarity,
  category: finding.category,
  basis: finding.basis,
  confidence: finding.confidence,
  title: finding.title,
  components: finding.components,
  goalEligible: finding.goalReadiness.eligible,
});

const assertExecutionAllowed = (context: HandlerContext, tool: ToolDefinition): void => {
  if (!tool.executes) return;
  if (!context.workspace.config.policy.allowProcessSpawn) {
    throw new OrchescopeError(
      'POLICY_DENIED',
      `${tool.name} runs the audited system and policy.allowProcessSpawn is false.`,
      {
        remediation: 'Set policy.allowProcessSpawn to true in .orchescope/config.json to allow it.',
      },
    );
  }
};

const scanAgentSystem = async (
  context: HandlerContext,
  args: Record<string, unknown>,
): Promise<ToolOutcome> => {
  const { workspace } = context;
  const result = await runAudit({
    workspace,
    orchescopeVersion: context.orchescopeVersion,
    runLimit: number(args['runLimit'], 0),
  });
  const byKind = new Map<string, number>();
  for (const component of result.graph.components) {
    byKind.set(component.kind, (byKind.get(component.kind) ?? 0) + 1);
  }
  return {
    text: `${formatCount(result.graph.components.length, 'component')} and ${formatCount(result.graph.edges.length, 'edge')} discovered across ${formatCount(result.graph.coverage.filesParsed, 'parsed file')}. Agent system detected: ${result.agentSystemDetected}.`,
    data: {
      scanId: result.scanId,
      agentSystemDetected: result.agentSystemDetected,
      componentsByKind: Object.fromEntries(byKind),
      edgeCount: result.graph.edges.length,
      coverage: {
        filesDiscovered: result.graph.coverage.filesDiscovered,
        filesParsed: result.graph.coverage.filesParsed,
        truncated: result.graph.coverage.truncated,
        skippedCount: result.graph.coverage.skipped.length,
        unsupported: result.graph.coverage.unsupported,
        adapters: result.graph.coverage.adapters.map((adapter) => ({
          id: adapter.adapterId,
          status: adapter.status,
          components: adapter.componentsFound,
          edges: adapter.edgesFound,
          detail: adapter.detail,
        })),
      },
    },
  };
};

const auditAgentSystem = async (
  context: HandlerContext,
  args: Record<string, unknown>,
): Promise<ToolOutcome> => {
  const { workspace } = context;
  const result = await runAudit({
    workspace,
    orchescopeVersion: context.orchescopeVersion,
    runLimit: number(args['runLimit'], 10),
  });
  const maxFindings = number(args['maxFindings'], 10);
  const risks = result.bundle.findings.filter((finding) => finding.polarity === 'risk');
  const progress = loopProgress(result.bundle, result.findingSet.rulesEvaluated);
  const next = toAgentNextAction(
    resolveNextAction({
      progress,
      agentSystemDetected: result.agentSystemDetected,
      adapters: result.graph.coverage.adapters,
    }),
  );
  const standing = progress.standingAt;
  return {
    text: `Audit ${result.scanId}: ${formatCount(risks.length, 'risk')}, ${formatCount(result.bundle.summary.strengthCount, 'strength')}, ${formatCount(result.runsConsidered.length, 'run')} reconciled. Standing at ${standing?.title ?? 'closed loop'}.`,
    data: {
      scanId: result.scanId,
      reportId: result.bundle.reportId,
      agentSystemDetected: result.agentSystemDetected,
      summary: result.bundle.summary,
      reconciliation: result.reconciliation,
      topFindings: risks.slice(0, maxFindings).map(findingLine),
      truncated: risks.length > maxFindings,
      rulesEvaluated: result.findingSet.rulesEvaluated.length,
      runsReconciled: result.runsConsidered.map((run) => run.id),
      loop: {
        standingAt: standing?.id ?? null,
        checkCoverage: progress.coverage,
        steps: progress.steps.map((step) => ({
          id: step.id,
          ordinal: step.ordinal,
          title: step.title,
          state: step.state,
          summary: step.summary,
          command: step.command,
        })),
        next,
      },
      capabilities: result.bundle.capabilities,
    },
  };
};

const getSystemMap = (context: HandlerContext, args: Record<string, unknown>): ToolOutcome => {
  const { workspace } = context;
  const scan = requireScan(workspace);
  const graph = workspace.store.graphForScan(scan.scanId);
  const kinds = stringArray(args['kinds']);
  const limit = number(args['limit'], DEFAULT_LIMIT);
  const offset = number(args['offset'], 0);
  let components = graph.components;
  if (kinds !== undefined && kinds.length > 0) {
    components = components.filter((component) => kinds.includes(component.kind));
  }
  if (args['onlyUnexercised'] === true) {
    components = components.filter(
      (component) => component.presence.static && !component.presence.runtime,
    );
  }
  if (args['onlyUndeclared'] === true) {
    components = components.filter(
      (component) => component.presence.runtime && !component.presence.static,
    );
  }
  const page = components.slice(offset, offset + limit);
  const includeEdges = args['includeEdges'] !== false;
  const pageIds = new Set(page.map((component) => component.id));
  const edges = includeEdges
    ? graph.edges
        .filter((edge) => pageIds.has(edge.from) || pageIds.has(edge.to))
        .slice(0, limit * 4)
    : [];
  return {
    text: `${page.length} of ${formatCount(components.length, 'matching component')}${includeEdges ? ` and ${formatCount(edges.length, 'adjacent edge')}` : ''}.`,
    data: {
      scanId: scan.scanId,
      total: components.length,
      offset,
      limit,
      truncated: offset + limit < components.length,
      components: page.map(componentLine),
      edges: edges.map(edgeLine),
    },
  };
};

const getReconciliationDelta = (
  context: HandlerContext,
  _args: Record<string, unknown>,
): ToolOutcome => {
  const { workspace } = context;
  const bundle = workspace.store.latestReport(workspace.projectId);
  if (bundle === undefined) {
    throw new OrchescopeError('NOT_FOUND', 'No report exists yet.', {
      remediation: 'Call audit_agent_system first.',
    });
  }
  if (bundle.reconciliation === undefined) {
    return {
      text: 'No runtime evidence has been recorded, so there is no delta to report. Record a run first.',
      data: { hasRuns: false },
    };
  }
  const delta = bundle.reconciliation;
  return {
    text: `${delta.declaredNotExercised.components.length} declared and never exercised, ${delta.exercisedNotDeclared.components.length} exercised and never declared, ${formatCount(delta.contradictions.length, 'contradiction')}, ${formatCount(delta.duplicateSideEffects.length, 'duplicated side effect')}.`,
    data: { hasRuns: true, delta },
  };
};

const getFindings = (context: HandlerContext, args: Record<string, unknown>): ToolOutcome => {
  const { workspace } = context;
  const scan = requireScan(workspace);
  const limit = number(args['limit'], DEFAULT_LIMIT);
  const offset = number(args['offset'], 0);
  const all = workspace.store.listFindings({
    scanId: scan.scanId,
    ...(stringArray(args['severity']) === undefined
      ? {}
      : { severity: stringArray(args['severity']) as readonly string[] }),
    ...(stringArray(args['category']) === undefined
      ? {}
      : { category: stringArray(args['category']) as readonly string[] }),
    ...(string(args['polarity']) === undefined
      ? {}
      : { polarity: string(args['polarity']) as string }),
    ...(string(args['componentId']) === undefined
      ? {}
      : { componentId: string(args['componentId']) as string }),
  });
  const filtered =
    args['goalEligibleOnly'] === true
      ? all.filter((finding) => finding.goalReadiness.eligible)
      : all;
  const page = filtered.slice(offset, offset + limit);
  return {
    text: `${page.length} of ${formatCount(filtered.length, 'finding')}.`,
    data: {
      scanId: scan.scanId,
      total: filtered.length,
      truncated: offset + limit < filtered.length,
      findings: page.map(findingLine),
    },
  };
};

const getFinding = (context: HandlerContext, args: Record<string, unknown>): ToolOutcome => {
  const { workspace } = context;
  const scan = requireScan(workspace);
  const findingId = string(args['findingId']) ?? '';
  const finding = workspace.store.findingById(scan.scanId, findingId);
  if (finding === undefined) {
    throw new OrchescopeError('NOT_FOUND', `No finding ${findingId} in the latest scan.`);
  }
  const evidence = workspace.store.evidenceByIds(finding.evidence.slice(0, 12));
  return {
    text: `${finding.id} ${finding.severity} ${finding.category}: ${finding.title}`,
    data: {
      finding,
      evidence: evidence.map((record) => ({
        id: record.id,
        kind: record.kind,
        basis: record.basis,
        producer: record.producer,
      })),
      evidenceTruncated: finding.evidence.length > 12,
    },
  };
};

const createImprovementGoal = (
  context: HandlerContext,
  args: Record<string, unknown>,
): ToolOutcome => {
  const { workspace } = context;
  const goal = createGoalFromFinding({
    workspace,
    findingId: string(args['findingId']) ?? '',
    ...(args['repetitions'] === undefined ? {} : { repetitions: number(args['repetitions'], 3) }),
  });
  return {
    text: `Created ${goal.id} from ${goal.findingId}. It names ${formatCount(goal.acceptanceCriteria.length, 'acceptance criterion', 'acceptance criteria')} and ${formatCount(goal.validation.commands.length, 'validation command')}.`,
    data: { goal, agentPrompt: renderAgentPrompt(goal) },
  };
};

const getImprovementGoal = (
  context: HandlerContext,
  args: Record<string, unknown>,
): ToolOutcome => {
  const { workspace } = context;
  const goal = workspace.store.goalById(string(args['goalId']) ?? '');
  if (goal === undefined) throw new OrchescopeError('NOT_FOUND', 'No such goal.');
  return {
    text: `${goal.id} (${goal.status}): ${goal.title}`,
    data: { goal, agentPrompt: renderAgentPrompt(goal) },
  };
};

const listScenarios = (context: HandlerContext, _args: Record<string, unknown>): ToolOutcome => {
  const { workspace } = context;
  const scenarios = discoverScenarios(workspace);
  return {
    text: `${formatCount(scenarios.length, 'scenario')} defined.`,
    data: {
      scenarios: scenarios.map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        requiredPermissions: scenario.requiredPermissions,
        faults: scenario.faults.length,
        evaluators: scenario.evaluators.length,
        repetitions: scenario.repetitions ?? 1,
      })),
    },
  };
};

const importTraceTool = (context: HandlerContext, args: Record<string, unknown>): ToolOutcome => {
  const path = string(args['path']);
  if (path === undefined || path.length === 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'import_trace needs a path inside the repository.',
    );
  }
  const label = string(args['label']);
  const result = importTrace({
    workspace: context.workspace,
    file: path,
    orchescopeVersion: context.orchescopeVersion,
    ...(label === undefined ? {} : { label }),
  });
  return {
    text: `Imported run ${result.run.id}: ${formatCount(result.spanCount, 'span')} from ${formatCount(result.serviceNames.length, 'service')}.`,
    data: {
      runId: result.run.id,
      status: result.run.status,
      spanCount: result.spanCount,
      services: result.serviceNames,
      label: result.run.label,
    },
  };
};

const runTracedTool = async (
  context: HandlerContext,
  args: Record<string, unknown>,
): Promise<ToolOutcome> => {
  const command = stringArray(args['command']);
  if (command === undefined || command.length === 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'run_traced needs the argv that starts the audited system.',
      {
        remediation:
          'Pass command as an argument array, for example ["node", "apps/demo/src/main.ts"]. A shell string is refused.',
      },
    );
  }
  if (command.some((part) => part.startsWith('<') && part.endsWith('>'))) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'run_traced was given a placeholder instead of a real command.',
      {
        remediation:
          'Replace the placeholder with the argv that starts your system. Orchescope will not invent one.',
      },
    );
  }
  const label = string(args['label']);
  const result = await runTrace({
    workspace: context.workspace,
    command,
    orchescopeVersion: context.orchescopeVersion,
    ...(label === undefined ? {} : { label }),
    ...(args['timeoutMs'] === undefined ? {} : { timeoutMs: number(args['timeoutMs'], 0) }),
  });
  return {
    text: `Traced run ${result.run.id}: ${formatCount(result.spanCount, 'span')} from ${formatCount(result.serviceNames.length, 'service')}, exit ${result.exitCode ?? 'unknown'}.`,
    data: {
      runId: result.run.id,
      status: result.run.status,
      spanCount: result.spanCount,
      services: result.serviceNames,
      exitCode: result.exitCode,
      receiverUrl: result.receiverUrl,
      otlpVariables: result.otlpVariables,
    },
  };
};

const runScenario = async (
  context: HandlerContext,
  args: Record<string, unknown>,
): Promise<ToolOutcome> => {
  const { workspace } = context;
  const scenario = loadScenario({ workspace, reference: string(args['scenarioId']) ?? '' });
  const outcome = await runScenarioUseCase({
    workspace,
    scenario,
    orchescopeVersion: context.orchescopeVersion,
    ...(args['repetitions'] === undefined ? {} : { repetitions: number(args['repetitions'], 1) }),
  });
  return {
    text: `${scenario.id} ${outcome.result.passed ? 'passed' : 'failed'} over ${formatCount(outcome.result.repetitions.length, 'repetition')}.`,
    data: {
      passed: outcome.result.passed,
      runIds: outcome.runIds,
      reliability: outcome.result.reliability,
      duration: outcome.result.aggregate.durationMs,
      evaluators: outcome.result.aggregate.evaluators,
      limitations: outcome.result.limitations,
    },
  };
};

const benchmarkVariants = async (
  context: HandlerContext,
  args: Record<string, unknown>,
): Promise<ToolOutcome> => {
  const { workspace } = context;
  const scenario = loadScenario({ workspace, reference: string(args['scenarioId']) ?? '' });
  const values = (args['values'] as readonly number[] | undefined) ?? [1, 2];
  const report = await runBenchmarkUseCase({
    workspace,
    scenario,
    dimension: (string(args['dimension']) ?? 'agent_count') as 'agent_count',
    values,
    repetitions: number(args['repetitions'], 3),
    orchescopeVersion: context.orchescopeVersion,
  });
  return {
    text: `Benchmark ${report.id} measured ${formatCount(report.variants.length, 'variant')} of ${report.dimension}.`,
    data: {
      benchmarkId: report.id,
      dimension: report.dimension,
      environment: report.environment,
      variants: report.variants.map((variant) => ({
        variantId: variant.variantId,
        variant: variant.variant,
        completedRuns: variant.completedRuns,
        successRate: variant.successRate,
        p50DurationMs: variant.durationMs.p50,
        p95DurationMs: variant.durationMs.p95,
        withheldQuantiles: variant.durationMs.withheld,
        totalTokens: variant.aggregateMetrics.inputTokens + variant.aggregateMetrics.outputTokens,
      })),
      limitations: report.limitations,
    },
  };
};

const injectFaults = async (
  context: HandlerContext,
  args: Record<string, unknown>,
): Promise<ToolOutcome> => {
  const { workspace } = context;
  const scenario = loadScenario({ workspace, reference: string(args['scenarioId']) ?? '' });
  const report = await runChaosUseCase({
    workspace,
    scenario,
    orchescopeVersion: context.orchescopeVersion,
    ...(args['seed'] === undefined ? {} : { seed: number(args['seed'], 1) }),
    ...(args['repetitions'] === undefined ? {} : { repetitions: number(args['repetitions'], 1) }),
  });
  return {
    text: `Chaos ${report.id}: ${report.outcomes.filter((outcome) => outcome.taskCompleted).length} of ${formatCount(report.outcomes.length, 'fault')} absorbed.`,
    data: {
      chaosReportId: report.id,
      environment: report.environment,
      outcomes: report.outcomes.map((outcome) => ({
        faultKind: outcome.faultKind,
        target: outcome.target,
        appliedCount: outcome.appliedCount,
        taskCompleted: outcome.taskCompleted,
        recovered: outcome.recovered,
        duplicateSideEffects: outcome.duplicateSideEffects,
        costAmplification: outcome.costAmplification,
      })),
      notApplied: report.notApplied,
    },
  };
};

const compareRuns = (context: HandlerContext, args: Record<string, unknown>): ToolOutcome => {
  const { workspace } = context;
  const comparison = compareUseCase({
    workspace,
    baseline: string(args['baseline']) ?? '',
    candidate: string(args['candidate']) ?? '',
    ...(string(args['goalId']) === undefined ? {} : { goalId: string(args['goalId']) as string }),
  });
  return {
    text: `${comparison.verdict}: ${comparison.verdictReason}`,
    data: {
      comparisonId: comparison.id,
      verdict: comparison.verdict,
      verdictReason: comparison.verdictReason,
      metricDeltas: comparison.metricDeltas,
      limitations: comparison.limitations,
    },
  };
};

const validateImprovementGoal = (
  context: HandlerContext,
  args: Record<string, unknown>,
): ToolOutcome => {
  const { workspace } = context;
  const comparisonId = string(args['comparisonId']);
  const comparison =
    comparisonId === undefined ? undefined : workspace.store.comparisonById(comparisonId);
  const outcome = validateGoalOutcome({
    workspace,
    goalId: string(args['goalId']) ?? '',
    ...(comparison === undefined ? {} : { comparison }),
  });
  return {
    text: `${outcome.goal.id}: ${outcome.validation.summary}`,
    data: {
      validated: outcome.validation.validated,
      summary: outcome.validation.summary,
      outcomes: outcome.validation.outcomes.map((entry) => ({
        criterion: entry.criterion.id,
        statement: entry.criterion.statement,
        satisfied: entry.satisfied,
        decided: entry.decided,
        detail: entry.detail,
      })),
      status: outcome.goal.status,
    },
  };
};

const exportReport = (context: HandlerContext, args: Record<string, unknown>): ToolOutcome => {
  const { workspace } = context;
  const bundle = workspace.store.latestReport(workspace.projectId);
  if (bundle === undefined) {
    throw new OrchescopeError('NOT_FOUND', 'No report exists yet.', {
      remediation: 'Call audit_agent_system first.',
    });
  }
  const format = string(args['format']) ?? 'json';
  const relative =
    string(args['path']) ??
    `.orchescope/state/reports/report-${bundle.reportId}.${format === 'mermaid' ? 'mmd' : format}`;
  const absolute = resolveInsideRoot(workspace.paths, relative);
  const contents =
    format === 'mermaid'
      ? toMermaid(bundle.graph)
      : format === 'sarif'
        ? `${stableJson(toSarif(bundle.findings, { toolVersion: context.orchescopeVersion }))}\n`
        : format === 'json'
          ? `${stableJson(bundle)}\n`
          : undefined;
  if (contents === undefined) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'The html format needs the built interface, so export it with the command line: orchescope export --format html --out <path>.',
    );
  }
  writeFileSync(absolute, contents, { mode: 0o600 });
  return {
    text: `Wrote ${relative}. The content is on disk rather than in this response so a large report does not fill the conversation.`,
    data: { path: relative, format, bytes: Buffer.byteLength(contents) },
  };
};

/**
 * One handler per tool, keyed by the name the tool advertises. A tool with no entry here is refused rather than
 * silently ignored, and the registry and this table are checked against each other by the contract test.
 */
const HANDLERS: Readonly<
  Record<
    string,
    (context: HandlerContext, args: Record<string, unknown>) => ToolOutcome | Promise<ToolOutcome>
  >
> = {
  scan_agent_system: scanAgentSystem,
  audit_agent_system: auditAgentSystem,
  get_system_map: getSystemMap,
  get_reconciliation_delta: getReconciliationDelta,
  get_findings: getFindings,
  get_finding: getFinding,
  create_improvement_goal: createImprovementGoal,
  get_improvement_goal: getImprovementGoal,
  list_scenarios: listScenarios,
  import_trace: importTraceTool,
  run_traced: runTracedTool,
  run_scenario: runScenario,
  benchmark_variants: benchmarkVariants,
  inject_faults: injectFaults,
  compare_runs: compareRuns,
  validate_improvement_goal: validateImprovementGoal,
  export_report: exportReport,
};

/** The tools this module implements, so the contract test can hold the registry and the handlers together. */
export const HANDLER_NAMES: readonly string[] = Object.keys(HANDLERS);

export const callTool = (
  context: HandlerContext,
  name: string,
  rawArguments: unknown,
): Promise<ToolOutcome> | ToolOutcome => {
  const tool = toolByName(name);
  if (tool === undefined) {
    throw new OrchescopeError('INVALID_ARGUMENT', `There is no tool named ${name}.`);
  }
  const validated = validate(tool.input, asRecord(rawArguments));
  if (!validated.ok) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `${name} arguments are invalid: ${formatIssues(validated.issues)}`,
    );
  }
  assertExecutionAllowed(context, tool);
  const handler = HANDLERS[name];
  if (handler === undefined) {
    throw new OrchescopeError('INVALID_ARGUMENT', `The tool ${name} has no handler.`);
  }
  return handler(context, asRecord(validated.value));
};
