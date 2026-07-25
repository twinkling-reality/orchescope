import { OrchescopeError, goalId as makeGoalId } from '@orchescope/domain';
import type {
  AcceptanceCriterion,
  Component,
  Evidence,
  Finding,
  Goal,
  GoalScope,
  Timestamp,
  ValidationPlan,
} from '@orchescope/schema';

/**
 * Goal creation.
 *
 * A goal is the contract between a finding and whoever implements the change. It is bounded on purpose: the
 * write scope, the prohibited changes, the acceptance criteria and the exact validation commands are part of
 * the document, so a coding agent has no room to interpret the task as "improve the system".
 *
 * A finding whose `goalReadiness.eligible` is false cannot become a goal. That flag is set by the rule that
 * produced the finding, which is the only place that knows whether the change is bounded.
 */

export type CreateGoalInput = {
  readonly finding: Finding;
  readonly sequence: number;
  readonly now: Timestamp;
  readonly components: readonly Component[];
  readonly evidence: readonly Evidence[];
  /** Scenarios that exercise the affected components, chosen by the caller from the scenario set. */
  readonly validationScenarioIds: readonly string[];
  /** Runs that will serve as the baseline for the comparison. */
  readonly baselineRunIds: readonly string[];
  readonly baselineBenchmarkId?: string;
  readonly repetitions: number;
};

const RELATIVE_IMPROVEMENT_BY_RULE: Readonly<Record<string, { metric: string; threshold: number }>> = {
  'independent-calls-run-sequentially': { metric: 'durationMs.p95', threshold: 0.15 },
  'workers-receive-comparably-large-context': { metric: 'inputTokens', threshold: 0.2 },
  'agent-count-does-not-pay-for-itself': { metric: 'durationMs.p50', threshold: 0.1 },
};

const ALWAYS_PROHIBITED: readonly string[] = [
  'changing an acceptance criterion or a validation command in this goal',
  'editing a stored baseline run, benchmark or comparison',
  'weakening an evaluator or removing an assertion to make a scenario pass',
  'disabling redaction, a policy setting or a permission check',
];

const writePathsFor = (components: readonly Component[], finding: Finding): readonly string[] => {
  const paths = new Set<string>();
  for (const location of finding.sourceLocations) paths.add(location.file);
  for (const component of components) {
    for (const location of component.sourceLocations) paths.add(location.file);
    for (const location of component.configLocations) paths.add(location.file);
  }
  return [...paths].sort();
};

const acceptanceCriteriaFor = (
  finding: Finding,
  validationScenarioIds: readonly string[],
): readonly AcceptanceCriterion[] => {
  const criteria: AcceptanceCriterion[] = [];
  let sequence = 1;
  const next = (): string => `AC-${String(sequence++).padStart(2, '0')}`;

  const improvement = RELATIVE_IMPROVEMENT_BY_RULE[finding.ruleId];
  if (improvement !== undefined) {
    criteria.push({
      id: next(),
      statement: `${improvement.metric} improves by at least ${Math.round(improvement.threshold * 100)} percent against the baseline`,
      check: {
        kind: 'metric_improvement',
        metric: improvement.metric,
        comparator: 'lt',
        relativeThreshold: improvement.threshold,
      },
    });
  }

  criteria.push({
    id: next(),
    statement: 'task success does not decline against the baseline',
    check: { kind: 'metric_not_worse', metric: 'successRate', tolerance: 0 },
  });
  criteria.push({
    id: next(),
    statement: 'no duplicate side effect appears in any validation run',
    check: { kind: 'metric_not_worse', metric: 'duplicateSideEffects', tolerance: 0 },
  });
  for (const scenarioId of validationScenarioIds) {
    criteria.push({
      id: next(),
      statement: `scenario ${scenarioId} passes`,
      check: { kind: 'scenario_passes', scenarioId },
    });
  }
  criteria.push({
    id: next(),
    statement: `finding ${finding.id} no longer fires on a rescan`,
    check: { kind: 'finding_resolved', findingId: finding.id },
  });
  if (finding.goalReadiness.requiresHumanReview) {
    criteria.push({
      id: next(),
      statement: 'a human reviewed the change against the evidence in this goal',
      check: {
        kind: 'manual_review',
        instruction:
          'Confirm the change addresses the mechanism described in the finding rather than only the symptom the metric measures.',
      },
    });
  }
  return criteria;
};

const validationPlanFor = (input: CreateGoalInput): ValidationPlan => {
  const commands: ValidationPlan['commands'] = [
    {
      purpose: 'rescan the repository so the static side of the finding is re-evaluated',
      command: ['orchescope', 'audit', '--json'],
    },
  ];
  for (const scenarioId of input.validationScenarioIds) {
    commands.push({
      purpose: `rerun the scenario that produced the evidence for ${input.finding.id}`,
      command: ['orchescope', 'test', '--scenario', scenarioId, '--repetitions', String(input.repetitions)],
    });
  }
  if (input.baselineRunIds.length > 0) {
    commands.push({
      purpose: 'compare the candidate run against the baseline run',
      command: ['orchescope', 'compare', input.baselineRunIds[0] as string, 'latest'],
    });
  }
  return {
    scenarioIds: [...input.validationScenarioIds],
    baselineRunIds: [...input.baselineRunIds],
    ...(input.baselineBenchmarkId === undefined
      ? {}
      : { baselineBenchmarkId: input.baselineBenchmarkId }),
    commands,
    repetitions: input.repetitions,
    requiresExecution: input.validationScenarioIds.length > 0,
  };
};

const scopeFor = (input: CreateGoalInput): GoalScope => {
  const invariants = [
    'the observable behaviour of every path not named in this goal stays the same',
    'no external effect becomes possible that was not possible before',
  ];
  if (input.finding.category === 'performance' || input.finding.category === 'cost') {
    invariants.push('the answer the system produces for the validation scenario stays correct');
  }
  return {
    allowedWritePaths: [...writePathsFor(input.components, input.finding)],
    prohibitedChanges: [...ALWAYS_PROHIBITED],
    invariants,
    requiredApprovals: [
      ...(input.finding.goalReadiness.requiresHumanReview ? (['human_review'] as const) : []),
      ...(input.validationScenarioIds.length > 0 ? (['live_execution'] as const) : []),
    ],
  };
};

const evidenceSummaryFor = (
  finding: Finding,
  evidence: readonly Evidence[],
): Goal['evidenceSummary'] => {
  const summary: { label: string; value: string; basis: string }[] = [];
  for (const metric of finding.metrics.slice(0, 8)) {
    summary.push({
      label: metric.name,
      value: `${metric.value} ${metric.unit} over ${metric.sampleSize} sample(s)`,
      basis: metric.basis,
    });
  }
  const kinds = new Map<string, number>();
  for (const record of evidence) kinds.set(record.kind, (kinds.get(record.kind) ?? 0) + 1);
  for (const [kind, count] of kinds) {
    summary.push({ label: `${kind} evidence`, value: `${count} record(s)`, basis: 'observed' });
  }
  if (summary.length === 0) {
    summary.push({
      label: 'evidence',
      value: `${finding.evidence.length} record(s) referenced by the finding`,
      basis: finding.basis,
    });
  }
  return summary;
};

const rollbackFor = (finding: Finding): string =>
  `Revert the change to the paths listed in the scope. The finding ${finding.id} and its evidence remain in the store, so the situation before the change is fully described by the baseline runs named in the validation plan.`;

export const createGoal = (input: CreateGoalInput): Goal => {
  if (!input.finding.goalReadiness.eligible) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `Finding ${input.finding.id} is not eligible to become a goal: ${input.finding.goalReadiness.reason}`,
      {
        detail: { findingId: input.finding.id },
        remediation:
          'Pick a finding whose goalReadiness.eligible is true, or address this one directly without a goal.',
      },
    );
  }
  if (input.finding.goalReadiness.requiresRuntimeEvidence && input.baselineRunIds.length === 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `Finding ${input.finding.id} needs runtime evidence before it can be verified, and no baseline run was supplied.`,
      {
        remediation: 'Record a run with orchescope trace, then create the goal.',
      },
    );
  }

  const improvement = RELATIVE_IMPROVEMENT_BY_RULE[input.finding.ruleId];
  return {
    schemaVersion: 1,
    id: makeGoalId(input.sequence),
    findingId: input.finding.id,
    title: input.finding.recommendation?.summary ?? input.finding.title,
    status: 'ready',
    createdAt: input.now,
    updatedAt: input.now,
    problemStatement: `${input.finding.explanation}\n\nImpact: ${input.finding.impact}`,
    evidence: [...input.finding.evidence],
    evidenceSummary: evidenceSummaryFor(input.finding, input.evidence),
    affectedComponents: [...input.finding.components],
    sourceLocations: [...input.finding.sourceLocations],
    scope: scopeFor(input),
    risk: input.finding.recommendation?.risk === 'unknown' ? 'medium' : (input.finding.recommendation?.risk ?? 'medium'),
    acceptanceCriteria: [...acceptanceCriteriaFor(input.finding, input.validationScenarioIds)],
    validation: validationPlanFor(input),
    ...(improvement === undefined
      ? {}
      : {
          expectedImprovement: `${improvement.metric} improves by at least ${Math.round(improvement.threshold * 100)} percent with task success unchanged`,
        }),
    rollback: rollbackFor(input.finding),
    validationResults: [],
    metadata: {
      ruleId: input.finding.ruleId,
      category: input.finding.category,
      severity: input.finding.severity,
      basis: input.finding.basis,
    },
  };
};
