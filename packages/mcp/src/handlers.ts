import { writeFileSync } from 'node:fs';
import { formatCount, OrchescopeError, stableJson } from '@orchescope/domain';
import { renderAgentPrompt } from '@orchescope/goals';
import {
  improvementOutcome,
  loopProgress,
  resolveNextAction,
  toMermaid,
  toSarif,
} from '@orchescope/report';
import type { Component, Edge, Finding } from '@orchescope/schema';
import type { FactCache } from '@orchescope/source-analysis';
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
import {
  componentDigest,
  criterionDigest,
  edgeDigest,
  findingDigest,
  goalDigest,
  metricDeltaDigest,
  nextActionDigest,
  reconciliationDigest,
} from './digest.ts';
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
  /**
   * One line per record the answer holds, mirroring the structured payload.
   *
   * A tool whose whole substance is structured used to leave a client that renders text with a count and
   * nothing else. These lines go into the same text block as `text`, so both kinds of reader get the
   * answer. They are bounded by the page the payload already carries rather than by a limit of their own.
   */
  readonly digest?: readonly string[];
  readonly data: Record<string, unknown>;
  readonly isError?: boolean;
};

export type HandlerContext = {
  readonly workspace: Workspace;
  readonly orchescopeVersion: string;
  /**
   * Facts kept across tool calls, because this surface is the one that scans the same repository again.
   *
   * A command line process scans once and exits, so a cache there would be filled and thrown away. This is
   * a server a coding agent holds open while it works, and the loop this repository documents is to scan,
   * change something, and scan again. Parsing is what a repeat scan spends: a second scan of the pinned
   * `crewai` checkout in one process is 375ms where the first is 4.0s, and `pydantic-ai` is 352ms where the
   * first is 5.5s.
   *
   * Optional, so a caller that scans once does not have to hold one.
   */
  readonly cache?: FactCache;
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
  if (!context.workspace.config.execution.allowProcessSpawn) {
    throw new OrchescopeError(
      'POLICY_DENIED',
      `${tool.name} runs the audited system and execution.allowProcessSpawn is false.`,
      {
        remediation:
          'Set execution.allowProcessSpawn to true in .orchescope/config.json to allow it.',
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
    ...(context.cache === undefined ? {} : { cache: context.cache }),
  });
  const byKind = new Map<string, number>();
  for (const component of result.graph.components) {
    byKind.set(component.kind, (byKind.get(component.kind) ?? 0) + 1);
  }
  return {
    text: `${formatCount(result.graph.components.length, 'component')} and ${formatCount(result.graph.edges.length, 'edge')} discovered across ${formatCount(result.graph.coverage.filesParsed, 'parsed file')}. Agent system detected: ${result.agentSystemDetected}.`,
    /*
     * What was found and what could not be inspected, which is the pair this tool exists to report. An
     * adapter that ran and found nothing is as much of the answer as one that found something.
     */
    digest: [
      ...[...byKind.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => `${formatCount(count, kind)}.`),
      ...result.graph.coverage.adapters
        .filter((adapter) => adapter.status !== 'not_applicable')
        .map(
          (adapter) =>
            `${adapter.adapterId} ${adapter.status}: ${adapter.componentsFound} components, ${adapter.edgesFound} edges.${adapter.detail === undefined ? '' : ` ${adapter.detail}`}`,
        ),
      ...result.graph.coverage.unsupported.map(
        (area) => `Not inspected: ${area.area}. ${area.reason}`,
      ),
    ],
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
    ...(context.cache === undefined ? {} : { cache: context.cache }),
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
  /*
   * Whether the caller's own last change helped, in the same call that says what is wrong. Asking for
   * it used to require a goal identifier the agent had to have kept from an earlier turn, which is not
   * something a fresh session or a second agent has.
   */
  const outcome = improvementOutcome(result.bundle);
  return {
    /*
     * A silent run is named here rather than left to be inferred from a run count that did not move.
     * An agent that traced its system and read "0 runs reconciled" would reasonably conclude the trace
     * failed to store anything, when what happened is that it stored a run holding no span.
     */
    text: `Audit ${result.scanId}: ${formatCount(risks.length, 'risk')}, ${formatCount(result.bundle.summary.strengthCount, 'strength')}, ${formatCount(result.runsConsidered.length, 'run')} reconciled${result.silentRuns.length === 0 ? '' : `, ${formatCount(result.silentRuns.length, 'run')} recorded no span`}. Standing at ${standing?.title ?? 'closed loop'}. ${outcome.summary}.`,
    /*
     * The risks and the one next action, which are what an audit is read for. The reconciliation, the
     * loop steps and the capabilities stay in the payload: they are context for a decision rather than
     * the decision, and mirroring all of them would put a report back in the conversation.
     */
    digest: [...risks.slice(0, maxFindings).map(findingDigest), ...nextActionDigest(next)],
    data: {
      /*
       * The build that produced this answer.
       *
       * A server is started once and then serves every call in a session, so an upgrade installed while
       * it runs changes nothing a caller can see: the old build keeps answering and nothing in the
       * response says which one is speaking. An agent comparing today's audit against a finding it
       * recorded last week has no way to tell a real change in the repository from a change in the
       * reader, and the command line has carried this in every document since the first release.
       */
      orchescopeVersion: context.orchescopeVersion,
      scanId: result.scanId,
      reportId: result.bundle.reportId,
      agentSystemDetected: result.agentSystemDetected,
      summary: result.bundle.summary,
      reconciliation: result.reconciliation,
      topFindings: risks.slice(0, maxFindings).map(findingLine),
      truncated: risks.length > maxFindings,
      rulesEvaluated: result.findingSet.rulesEvaluated.length,
      runsReconciled: result.runsConsidered.map((run) => run.id),
      /** Runs that were recorded and produced no span. Nothing in this report was derived from them. */
      runsWithoutSpans: result.silentRuns.map((run) => run.id),
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
      outcome,
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
    digest: [...page.map(componentDigest), ...edges.map(edgeDigest)],
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
    digest: reconciliationDigest(delta),
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
    digest: page.map(findingDigest),
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
    text: findingDigest(finding),
    /*
     * The three things a reader decides on: why it fired, what it costs, and what to do about it. The
     * whole record is in the payload; a title alone is not enough to act on and was all the text carried.
     */
    digest: [
      finding.explanation,
      `Impact: ${finding.impact}`,
      ...finding.metrics.map(
        (metric) =>
          `${metric.name}: ${metric.value} ${metric.unit} over ${formatCount(metric.sampleSize, 'sample')}, ${metric.basis}.`,
      ),
      ...(finding.recommendation === undefined
        ? []
        : [`Recommended: ${finding.recommendation.summary}`]),
      finding.goalReadiness.eligible
        ? 'A goal can be created from this finding.'
        : `Not goal eligible: ${finding.goalReadiness.reason}`,
    ],
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
  const { goal, created } = createGoalFromFinding({
    workspace,
    findingId: string(args['findingId']) ?? '',
    ...(args['repetitions'] === undefined ? {} : { repetitions: number(args['repetitions'], 3) }),
    ...(args['createAnother'] === true ? { createAnother: true } : {}),
  });
  const shape = `It names ${formatCount(goal.acceptanceCriteria.length, 'acceptance criterion', 'acceptance criteria')} and ${formatCount(goal.validation.commands.length, 'validation command')}.`;
  return {
    /*
     * A reused goal says so. A caller that asked twice and was told "Created" both times has no way to tell
     * one goal from two, which is how six identical goals came out of six calls.
     */
    text: created
      ? `Created ${goal.id} from ${goal.findingId}. ${shape}`
      : `${goal.id} already covers ${goal.findingId} and is ${goal.status}, so it was returned unchanged. ${shape} Pass createAnother to cut a second goal from the same finding.`,
    digest: goalDigest(goal),
    data: { goal, created, agentPrompt: renderAgentPrompt(goal) },
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
    digest: goalDigest(goal),
    data: { goal, agentPrompt: renderAgentPrompt(goal) },
  };
};

const listScenarios = (context: HandlerContext, _args: Record<string, unknown>): ToolOutcome => {
  const { workspace } = context;
  const scenarios = discoverScenarios(workspace);
  return {
    text: `${formatCount(scenarios.length, 'scenario')} defined.`,
    digest: scenarios.map(
      (scenario) =>
        `${scenario.id}: ${scenario.name}. Needs ${scenario.requiredPermissions.join(', ') || 'no permission'}. ${formatCount(scenario.faults.length, 'fault')}, ${formatCount(scenario.evaluators.length, 'evaluator')}.`,
    ),
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
    digest: [
      ...outcome.result.aggregate.evaluators.map(
        (evaluator) =>
          `${evaluator.kind} ${evaluator.skipped === true ? `skipped: ${evaluator.skipReason ?? 'no reason recorded'}` : evaluator.passed ? 'passed' : 'failed'}. ${evaluator.detail}`,
      ),
      ...outcome.result.limitations.map((limitation) => `Limitation: ${limitation}`),
    ],
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
    /*
     * A quantile withheld for want of samples is reported as withheld rather than omitted, because a
     * missing p95 and a p95 nobody may rely on read identically once the number is gone.
     */
    text: `Benchmark ${report.id} measured ${formatCount(report.variants.length, 'variant')} of ${report.dimension}.`,
    digest: [
      ...report.variants.map(
        (variant) =>
          `${variant.variantId}: ${variant.completedRuns} completed runs, success ${variant.successRate ?? 'not measured'}, p50 ${variant.durationMs.p50 ?? 'withheld'} ms, p95 ${variant.durationMs.p95 ?? 'withheld'} ms, ${variant.aggregateMetrics.inputTokens + variant.aggregateMetrics.outputTokens} tokens.`,
      ),
      ...report.limitations.map((limitation) => `Limitation: ${limitation}`),
    ],
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
    digest: [
      ...report.outcomes.map(
        (outcome) =>
          `${outcome.faultKind} on ${outcome.target}, applied ${outcome.appliedCount} times: task ${outcome.taskCompleted ? 'completed' : 'did not complete'}, ${outcome.recovered ? 'recovered' : 'did not recover'}, ${formatCount(outcome.duplicateSideEffects, 'duplicated side effect')}.`,
      ),
      ...report.notApplied.map(
        (entry) => `Not applied: ${entry.faultKind} on ${entry.target}. ${entry.reason}`,
      ),
    ],
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
    digest: [
      ...comparison.metricDeltas.map(metricDeltaDigest),
      ...comparison.limitations.map((limitation) => `Limitation: ${limitation}`),
    ],
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
    digest: outcome.validation.outcomes.map(criterionDigest),
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
