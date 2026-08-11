/// <reference types="node" />

/**
 * Fixture builders for the browser workspace tests. Everything is minimal and explicit: the tests read
 * better when the shape under test is visible in the test rather than hidden in a factory default.
 */

import type {
  Component,
  ComponentRunMetrics,
  Finding,
  Goal,
  Overlay,
  ReportBundle,
  RunRecord,
} from '@orchescope/schema';

export function component(overrides: Partial<Component> & Pick<Component, 'id'>): Component {
  return {
    id: overrides.id,
    identity: overrides.identity ?? {
      kind: overrides.kind ?? 'agent',
      namespace: 'src/module',
      localName: overrides.id,
    },
    fingerprint: overrides.fingerprint ?? 'a'.repeat(64),
    kind: overrides.kind ?? 'agent',
    displayName: overrides.displayName ?? overrides.id,
    presence: overrides.presence ?? { static: true, runtime: false, manifest: false },
    basis: overrides.basis ?? 'discovered',
    confidence: overrides.confidence ?? 0.9,
    discoveredBy: overrides.discoveredBy ?? ['adapter:test'],
    sourceLocations: overrides.sourceLocations ?? [],
    configLocations: overrides.configLocations ?? [],
    evidence: overrides.evidence ?? [],
    permissions: overrides.permissions ?? [],
    aliases: overrides.aliases ?? [],
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    ...(overrides.description === undefined ? {} : { description: overrides.description }),
    ...(overrides.details === undefined ? {} : { details: overrides.details }),
    ...(overrides.sideEffect === undefined ? {} : { sideEffect: overrides.sideEffect }),
  };
}

export function finding(overrides: Partial<Finding> & Pick<Finding, 'id'>): Finding {
  return {
    id: overrides.id,
    ruleId: overrides.ruleId ?? 'rule.test',
    category: overrides.category ?? 'performance',
    polarity: overrides.polarity ?? 'risk',
    severity: overrides.severity ?? 'medium',
    confidence: overrides.confidence ?? 0.8,
    basis: overrides.basis ?? 'observed',
    title: overrides.title ?? `title for ${overrides.id}`,
    explanation: overrides.explanation ?? 'explanation',
    impact: overrides.impact ?? 'impact',
    components: overrides.components ?? [],
    edges: overrides.edges ?? [],
    sourceLocations: overrides.sourceLocations ?? [],
    evidence: overrides.evidence ?? ['ev_0000000000000001'],
    metrics: overrides.metrics ?? [],
    goalReadiness: overrides.goalReadiness ?? {
      eligible: true,
      reason: 'evidence is sufficient',
      requiresRuntimeEvidence: false,
      requiresHumanReview: false,
    },
    taxonomy: overrides.taxonomy ?? [],
    conflictsWith: overrides.conflictsWith ?? [],
    tags: overrides.tags ?? [],
    createdAt: overrides.createdAt ?? '2026-07-24T00:00:00.000Z',
    metadata: overrides.metadata ?? {},
    ...(overrides.recommendation === undefined ? {} : { recommendation: overrides.recommendation }),
    ...(overrides.suggestedExperiment === undefined
      ? {}
      : { suggestedExperiment: overrides.suggestedExperiment }),
  };
}

export function metrics(
  overrides: Partial<ComponentRunMetrics> & Pick<ComponentRunMetrics, 'componentId'>,
): ComponentRunMetrics {
  return {
    componentId: overrides.componentId,
    executionCount: overrides.executionCount ?? 1,
    selfDurationMs: overrides.selfDurationMs ?? 10,
    totalDurationMs: overrides.totalDurationMs ?? 20,
    inputTokens: overrides.inputTokens ?? 0,
    outputTokens: overrides.outputTokens ?? 0,
    errorCount: overrides.errorCount ?? 0,
    retryCount: overrides.retryCount ?? 0,
    ...(overrides.p95DurationMs === undefined ? {} : { p95DurationMs: overrides.p95DurationMs }),
    ...(overrides.costUsd === undefined ? {} : { costUsd: overrides.costUsd }),
  };
}

export function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: overrides.id ?? 'run_0123456789abcdef',
    kind: overrides.kind ?? 'trace',
    label: overrides.label ?? 'One recorded run',
    status: overrides.status ?? 'completed',
    startedAt: overrides.startedAt ?? '2026-01-01T00:00:00.000Z',
    finishedAt: overrides.finishedAt ?? '2026-01-01T00:00:01.000Z',
    environment: overrides.environment ?? {
      orchescopeVersion: '0.1.0',
      platform: 'linux',
      arch: 'x64',
      cpuCount: 1,
      totalMemoryBytes: 0,
      runtimeName: 'node',
      runtimeVersion: '24.0.0',
    },
    metrics: overrides.metrics ?? {
      durationMs: 1000,
      modelCalls: 0,
      toolCalls: 0,
      agentSteps: 0,
      handoffs: 0,
      retrievalCalls: 0,
      memoryOperations: 0,
      inputTokens: 0,
      outputTokens: 0,
      errors: 0,
      retries: 0,
      recoveredErrors: 0,
      duplicateSideEffects: 0,
      prohibitedSideEffects: 0,
      sideEffects: 0,
      userInterventions: 0,
      policyViolations: 0,
      maxObservedConcurrency: 0,
      loopIterations: 0,
    },
    componentMetrics: overrides.componentMetrics ?? [],
    metadata: overrides.metadata ?? {},
  };
}

export function overlay(overrides: Partial<Overlay> = {}): Overlay {
  return {
    kind: overrides.kind ?? 'latency',
    label: overrides.label ?? 'Latency',
    values: overrides.values ?? [],
    basis: overrides.basis ?? 'observed',
    ...(overrides.unit === undefined ? {} : { unit: overrides.unit }),
    ...(overrides.caveat === undefined ? {} : { caveat: overrides.caveat }),
  };
}

export function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    schemaVersion: overrides.schemaVersion ?? 1,
    id: overrides.id ?? 'OSC-GOAL-0001',
    findingId: overrides.findingId ?? 'OSC-PERF-0001',
    title: overrides.title ?? 'Bound the retry loop on the refund tool',
    status: overrides.status ?? 'ready',
    createdAt: overrides.createdAt ?? '2026-07-24T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-07-24T01:00:00.000Z',
    problemStatement: overrides.problemStatement ?? 'The refund tool retries without a ceiling.',
    evidence: overrides.evidence ?? ['ev_0000000000000001'],
    evidenceSummary: overrides.evidenceSummary ?? [
      { label: 'Retries per task', value: '14', basis: 'observed' },
    ],
    affectedComponents: overrides.affectedComponents ?? ['tool:refund'],
    sourceLocations: overrides.sourceLocations ?? [{ file: 'src/tools/refund.ts', startLine: 42 }],
    scope: overrides.scope ?? {
      allowedWritePaths: ['src/tools/refund.ts'],
      prohibitedChanges: ['Do not change the refund amount calculation.'],
      invariants: ['A refund is issued at most once per request identifier.'],
      requiredApprovals: ['human_review'],
    },
    risk: overrides.risk ?? 'medium',
    acceptanceCriteria: overrides.acceptanceCriteria ?? [
      {
        id: 'AC-01',
        statement: 'Retries per task fall below four.',
        check: {
          kind: 'metric_improvement',
          metric: 'retries',
          comparator: 'lt',
          relativeThreshold: 0.5,
        },
      },
    ],
    validation: overrides.validation ?? {
      scenarioIds: ['refund-happy-path'],
      baselineRunIds: ['run_0000000000000001'],
      commands: [
        {
          purpose: 'Rerun the scenario',
          command: ['orchescope', 'scenario', 'run', 'refund-happy-path'],
        },
      ],
      repetitions: 5,
      requiresExecution: true,
    },
    rollback: overrides.rollback ?? 'Revert the commit that changed the retry policy.',
    validationResults: overrides.validationResults ?? [],
    metadata: overrides.metadata ?? {},
    ...(overrides.expectedImprovement === undefined
      ? {}
      : { expectedImprovement: overrides.expectedImprovement }),
  };
}

/** A structurally valid bundle. Fields are filled with the smallest values that satisfy the shape. */
export function bundle(overrides: Partial<ReportBundle> = {}): ReportBundle {
  const components = overrides.graph?.components ?? [];
  return {
    schemaVersion: overrides.schemaVersion ?? 1,
    reportId: overrides.reportId ?? 'rpt_0000000000000001',
    generatedAt: overrides.generatedAt ?? '2026-07-24T00:00:00.000Z',
    projectName: overrides.projectName ?? 'demo',
    graph: overrides.graph ?? {
      schemaVersion: 1,
      graphId: 'graph_0000000000000001',
      provenance: {
        orchescopeVersion: '0.1.0',
        scanId: 'scan_0000000000000001',
        projectId: 'prj_0000000000000001',
        projectName: 'demo',
        generatedAt: '2026-07-24T00:00:00.000Z',
        projectPathHash: 'b'.repeat(64),
        runIds: [],
      },
      coverage: {
        filesDiscovered: 0,
        filesParsed: 0,
        bytesParsed: 0,
        skipped: [],
        languages: [],
        adapters: [],
        unsupported: [],
        durationMs: 0,
        truncated: false,
      },
      components,
      edges: [],
      metadata: {},
    },
    findings: overrides.findings ?? [],
    evidence: overrides.evidence ?? [],
    runs: overrides.runs ?? [],
    scenarios: overrides.scenarios ?? [],
    scenarioRuns: overrides.scenarioRuns ?? [],
    componentMetrics: overrides.componentMetrics ?? [],
    overlays: overrides.overlays ?? [],
    benchmarks: overrides.benchmarks ?? [],
    chaosReports: overrides.chaosReports ?? [],
    comparisons: overrides.comparisons ?? [],
    goals: overrides.goals ?? [],
    capabilities: overrides.capabilities ?? [],
    summary: overrides.summary ?? {
      componentCount: components.length,
      edgeCount: 0,
      observedComponentCount: 0,
      staticOnlyComponentCount: components.length,
      runtimeOnlyComponentCount: 0,
      findingCountBySeverity: {},
      strengthCount: 0,
      runCount: 0,
      scenarioCount: 0,
    },
    metadata: overrides.metadata ?? {},
    ...(overrides.reconciliation === undefined ? {} : { reconciliation: overrides.reconciliation }),
  };
}
