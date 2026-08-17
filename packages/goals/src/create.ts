import { goalId as makeGoalId, OrchescopeError } from '@orchescope/domain';
import type {
  AcceptanceCriterion,
  ClaimBasis,
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

const RELATIVE_IMPROVEMENT_BY_RULE: Readonly<
  Record<string, { metric: string; threshold: number }>
> = {
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

/**
 * The criteria, written so that a reader can still find what they name after a rescan.
 *
 * A finding identifier is a sequence number inside its category, assigned over a sorted list of that
 * scan's drafts. It is deterministic for a given set of findings and it is not stable across scans: a
 * new rule that sorts earlier renumbers everything after it, and the runs this goal's own validation
 * plan prescribes are exactly what produce new findings. So a criterion that named `OSC-REL-0003`
 * would, by the time anyone read it back, be pointing at whichever finding had since inherited that
 * number. The rule identifier is the finding's stable name and it is already what the check resolves
 * on, so it is what the statement says. The finding identifier stays in the check as the record of
 * which finding this goal was cut from.
 */
const acceptanceCriteriaFor = (
  finding: Finding,
  validationScenarioIds: readonly string[],
  comparable: boolean,
): readonly AcceptanceCriterion[] => {
  const criteria: AcceptanceCriterion[] = [];
  let sequence = 1;
  const next = (): string => `AC-${String(sequence++).padStart(2, '0')}`;

  /*
   * A metric criterion is issued only where there is a baseline to compare against.
   *
   * The plan already declines to prescribe `orchescope compare` when no run has been recorded, and a
   * goal that states a criterion whose deciding command it will not name has written a term nobody can
   * evaluate. It read as a demand rather than as a gap: an operator who did exactly what the goal asked
   * got `not validated` with two criteria permanently undecided, so a goal that was in fact complete
   * could never say so, and the loop this product exists to close stopped one step from the end.
   *
   * Omitted rather than reported not applicable at validation, because the goal document is a contract
   * handed to an agent and the honest form of a term that cannot be evaluated is its absence. Recording
   * a run and cutting the goal again is what brings them back, and the plan says so.
   */
  const improvement = comparable ? RELATIVE_IMPROVEMENT_BY_RULE[finding.ruleId] : undefined;
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

  if (comparable) {
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
  }
  for (const scenarioId of validationScenarioIds) {
    criteria.push({
      id: next(),
      statement: `scenario ${scenarioId} passes`,
      check: { kind: 'scenario_passes', scenarioId },
    });
  }
  criteria.push({
    id: next(),
    statement: `finding ${finding.ruleId} no longer fires on a rescan`,
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
      purpose: `rerun the scenario that produced the evidence for ${input.finding.ruleId}`,
      command: [
        'orchescope',
        'test',
        '--scenario',
        scenarioId,
        '--repetitions',
        String(input.repetitions),
      ],
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

const records = (count: number): string => `${count} ${count === 1 ? 'record' : 'records'}`;

/**
 * The evidence behind a goal, grouped for a reader.
 *
 * Every line carries the evidence class of the records it counts, read from those records rather than
 * assumed. A `config_entry` read out of a manifest is `discovered` and a rule's conclusion is
 * `inferred`, and reporting either as `observed` would tell whoever implements the change that a line
 * in a YAML file was seen in a runtime trace. That is the one claim this repository will not make, and
 * a goal is the document least able to defend itself against it, because it is read by an agent that
 * has no way to go and check.
 *
 * Records are therefore grouped by kind *and* class, not by kind alone: one kind can hold records of
 * differing classes, and picking a single class per kind would report the wrong one for the rest.
 */
const evidenceSummaryFor = (
  finding: Finding,
  evidence: readonly Evidence[],
): Goal['evidenceSummary'] => {
  const summary: { label: string; value: string; basis: ClaimBasis }[] = [];
  for (const metric of finding.metrics.slice(0, 8)) {
    summary.push({
      label: metric.name,
      value: `${metric.value} ${metric.unit} over ${metric.sampleSize} ${metric.sampleSize === 1 ? 'sample' : 'samples'}`,
      basis: metric.basis,
    });
  }
  const groups = new Map<string, { kind: string; basis: ClaimBasis; count: number }>();
  for (const record of evidence) {
    const key = `${record.kind} ${record.basis}`;
    const existing = groups.get(key);
    groups.set(
      key,
      existing === undefined
        ? { kind: record.kind, basis: record.basis, count: 1 }
        : { ...existing, count: existing.count + 1 },
    );
  }
  for (const group of groups.values()) {
    summary.push({
      label: `${group.kind} evidence`,
      value: records(group.count),
      basis: group.basis,
    });
  }
  if (summary.length === 0) {
    summary.push({
      label: 'evidence',
      value: `${records(finding.evidence.length)} referenced by the finding`,
      basis: finding.basis,
    });
  }
  return summary;
};

const rollbackFor = (finding: Finding): string =>
  `Revert the change to the paths listed in the scope. The finding ${finding.ruleId} and its evidence remain in the store, so the situation before the change is fully described by the baseline runs named in the validation plan.`;

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
    risk:
      input.finding.recommendation?.risk === 'unknown'
        ? 'medium'
        : (input.finding.recommendation?.risk ?? 'medium'),
    acceptanceCriteria: [
      ...acceptanceCriteriaFor(
        input.finding,
        input.validationScenarioIds,
        input.baselineRunIds.length > 0,
      ),
    ],
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
