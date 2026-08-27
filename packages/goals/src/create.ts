import {
  goalId as makeGoalId,
  metricDecidedByPresence,
  MINIMUM_SAMPLES_PER_SIDE,
  OrchescopeError,
  SEMANTIC_FINDING_IDENTITY,
  semanticFindingKeyDigest,
  semanticFindingSubjectDigest,
  usesSemanticFindingIdentity,
} from '@orchescope/domain';
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
  /** Scenarios recorded exercising the affected components, chosen by the caller from what the store holds. */
  readonly validationScenarioIds: readonly string[];
  /**
   * The recorded work the candidate is compared against, with the conditions it was recorded under.
   *
   * Absent when the caller found no comparable pair, which is a normal outcome and not a failure: a
   * repository with no scenario, a scenario whose only result is a single repetition, a finding whose
   * components nothing has exercised. `comparisonUnavailable` says which of those it was.
   */
  readonly baseline?: {
    readonly scenarioId: string;
    readonly variantId?: string | undefined;
    readonly faultPlanId?: string | undefined;
    readonly runIds: readonly string[];
    readonly samples: number;
  };
  /** Why no comparison is prescribed, when none is. */
  readonly comparisonUnavailable?: string;
  /**
   * Runs that exercised the affected components, whether or not any of them can serve as a baseline.
   *
   * This is what runtime evidence means, and it is a different question from whether a comparison is
   * reachable. Reading one field for both is how a goal came to name three unrelated recent runs as the
   * thing its candidate would be compared against.
   */
  readonly exercisingRunIds: readonly string[];
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

/**
 * What the plan prints where the reviewer's own words belong.
 *
 * Printed rather than omitted so the shape of the command is obvious, and refused when it arrives back
 * unchanged. The review is the one step a machine must not be able to complete by copying: an agent that
 * ran the plan verbatim would otherwise store this string as the note and satisfy the criterion with it,
 * which is a goal reporting that a change was reviewed when nothing was.
 */
export const REVIEW_NOTE_PLACEHOLDER = '<what you checked>';

const ALWAYS_PROHIBITED: readonly string[] = [
  'changing an acceptance criterion or a validation command in this goal',
  'editing a stored baseline run, benchmark or comparison',
  'weakening an evaluator or removing an assertion to make a scenario pass',
  'disabling redaction, a policy setting or a permission check',
];

/**
 * Whether this goal can be judged against a comparison of two executions of the same work.
 *
 * A baseline alone is half of a comparison. The other half is a run made after the change, and the only
 * thing in the plan that produces one is a scenario: `orchescope audit` records no run, so with no
 * scenario named the plan prints `compare <baseline> latest` at a moment when `latest` is still the
 * baseline. That is a run compared with itself, and it reports every metric unchanged, so both
 * `metric_not_worse` criteria come back satisfied on a comparison that measured nothing about the
 * change. A false pass is worse than an undecided one: undecided says look again, and this says done.
 *
 * Two questions, and both have to hold. The caller found a recorded result that can serve as a baseline,
 * and the plan will rerun the scenario that result came from, so the candidate reproduces the same work
 * under the same conditions rather than being whichever run happens to be newest.
 */
const comparisonIsReachable = (input: CreateGoalInput): boolean =>
  input.baseline !== undefined &&
  input.baseline.samples > 0 &&
  input.repetitions > 0 &&
  input.validationScenarioIds.includes(input.baseline.scenarioId);

/**
 * Whether a criterion about a distribution can be decided by what the plan will produce.
 *
 * Reachability is not one question, because deciding a metric is not one kind of act. A duplicated side
 * effect that happened and now does not is decided by presence and needs no sample floor at all: it is the
 * criterion the improvement loop closes on, and gating it on three samples would have withdrawn it from
 * the one scenario shape that produces it, on the reasoning that a categorical change is a weak
 * distribution claim.
 *
 * A latency, a token count or a success rate is a claim about a distribution, and `compareMetric` refuses
 * a direction on fewer than `MINIMUM_SAMPLES_PER_SIDE`. Both sides have to clear it: the recorded result
 * supplies the baseline side and no rule can manufacture samples nobody recorded, and the plan's own
 * repetition count supplies the candidate side. Asked here rather than discovered afterwards, because a
 * criterion whose deciding command comes back indeterminate is a term the plan wrote knowing nothing
 * could answer it.
 */
const clearsTheSampleFloor = (input: CreateGoalInput): boolean =>
  (input.baseline?.samples ?? 0) >= MINIMUM_SAMPLES_PER_SIDE &&
  input.repetitions >= MINIMUM_SAMPLES_PER_SIDE;

/**
 * Whether the plan can produce evidence that decides a criterion about this metric.
 *
 * The metric is asked rather than listed, so adding a criterion never means remembering to update a rule
 * about which criteria are which. What decides a metric is a property of the metric, and the one place
 * that knows it is the one the comparison reads.
 */
const metricIsDecidable = (input: CreateGoalInput, metric: string): boolean =>
  comparisonIsReachable(input) && (metricDecidedByPresence(metric) || clearsTheSampleFloor(input));

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
 * The criteria name the rule in prose because it explains what must stop firing. The machine check keeps
 * the semantic finding identifier, and compatibility reads the stored rule and affected subject from a
 * version-1 goal that lacks semantic metadata.
 */
const acceptanceCriteriaFor = (
  finding: Finding,
  validationScenarioIds: readonly string[],
  decides: (metric: string) => boolean,
): readonly AcceptanceCriterion[] => {
  const criteria: AcceptanceCriterion[] = [];
  let sequence = 1;
  const next = (): string => `AC-${String(sequence++).padStart(2, '0')}`;

  /*
   * A metric criterion is issued only where the plan can produce the comparison that decides it.
   *
   * A goal that states a criterion whose deciding command it will not name has written a term nobody can
   * evaluate. It read as a demand rather than as a gap: an operator who did exactly what the goal asked
   * got `not validated` with two criteria permanently undecided, so a goal that was in fact complete
   * could never say so, and the loop this product exists to close stopped one step from the end.
   *
   * The same principle refuses the opposite failure. Naming a command is not enough if the command
   * cannot decide the term: with a baseline and no scenario the prescribed comparison has no candidate
   * but the baseline itself, and a run compared with itself reports every metric unchanged and satisfies
   * the criteria on evidence about nothing. `comparisonIsReachable` is what asks the real question.
   *
   * Omitted rather than reported not applicable at validation, because the goal document is a contract
   * handed to an agent and the honest form of a term that cannot be evaluated is its absence. Recording
   * a run, adding a scenario and cutting the goal again is what brings them back, and the plan says so.
   */
  const named = RELATIVE_IMPROVEMENT_BY_RULE[finding.ruleId];
  const improvement = named !== undefined && decides(named.metric) ? named : undefined;
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

  if (decides('successRate')) {
    criteria.push({
      id: next(),
      statement: 'task success does not decline against the baseline',
      check: { kind: 'metric_not_worse', metric: 'successRate', tolerance: 0 },
    });
  }
  if (decides('duplicateSideEffects')) {
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

/**
 * The commands an implementer runs, and the arguments each one needs to decide what it is there to decide.
 *
 * The goal identifier is threaded in rather than left out because the comparison is the one step whose
 * result is not findable without it. `orchescope compare` writes `goal_id` only from `--goal`, and the
 * judgement resolves a comparison with `WHERE goal_id = ?`, which never matches a null. A plan that
 * printed the command without the flag asked an operator to produce evidence and then hid it: the
 * comparison sat in the store while the goal reported that no comparison was recorded, which is the same
 * failure the comment above describes, one argument further in.
 */
const validationPlanFor = (input: CreateGoalInput, goalId: string): ValidationPlan => {
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
  const baseline = input.baseline;
  if (comparisonIsReachable(input) && baseline !== undefined) {
    commands.push({
      purpose: `compare the rerun of ${baseline.scenarioId} against the recording of it this goal was cut from, attached to this goal`,
      command: ['orchescope', 'compare', baseline.runIds[0] as string, 'latest', '--goal', goalId],
    });
  }
  /*
   * The plan ends at the command that renders the decision.
   *
   * It used to end at the comparison, so an operator did everything asked and never saw what any of it
   * decided: the only printed command that judges a goal was `audit`, which runs first, before the
   * comparison it would have read exists. Naming `goal validate` last makes the order stop mattering,
   * and it is the step that turns the evidence just produced into an answer about this goal.
   *
   * The review comes immediately before it, and only where a criterion asks for one. It is the single
   * term nothing in a run can decide, so a plan that did not name the act that decides it would be
   * stating a term whose deciding command it declines to name, which is the failure the comment above
   * describes.
   */
  if (input.finding.goalReadiness.requiresHumanReview) {
    commands.push({
      purpose: 'record that the change was reviewed against the evidence in this goal',
      command: ['orchescope', 'goal', 'review', goalId, '--note', REVIEW_NOTE_PLACEHOLDER],
    });
  }
  commands.push({
    purpose: 'judge this goal against everything the commands above recorded',
    command: ['orchescope', 'goal', 'validate', goalId],
  });
  const reachable = comparisonIsReachable(input);
  return {
    scenarioIds: [...input.validationScenarioIds],
    baselineRunIds: reachable && baseline !== undefined ? [...baseline.runIds] : [],
    ...(reachable && baseline !== undefined
      ? {
          baseline: {
            scenarioId: baseline.scenarioId,
            ...(baseline.variantId === undefined ? {} : { variantId: baseline.variantId }),
            ...(baseline.faultPlanId === undefined ? {} : { faultPlanId: baseline.faultPlanId }),
            samples: baseline.samples,
          },
        }
      : { comparisonUnavailable: unavailableReason(input) }),
    ...(input.baselineBenchmarkId === undefined
      ? {}
      : { baselineBenchmarkId: input.baselineBenchmarkId }),
    commands,
    repetitions: input.repetitions,
    requiresExecution: input.validationScenarioIds.length > 0,
  };
};

/**
 * Why the plan prescribes no comparison.
 *
 * The caller's reason is preferred, because the caller is what asked the store and knows which question
 * failed. The two answered here are the ones only this module can see: it found a baseline the plan will
 * not rerun, or the repetition count it was given is below what a direction needs.
 */
const unavailableReason = (input: CreateGoalInput): string => {
  if (input.comparisonUnavailable !== undefined) return input.comparisonUnavailable;
  if (input.repetitions < MINIMUM_SAMPLES_PER_SIDE) {
    return `this plan reruns ${input.repetitions} ${input.repetitions === 1 ? 'repetition' : 'repetitions'}, and a metric direction needs at least ${MINIMUM_SAMPLES_PER_SIDE} samples on each side`;
  }
  if (
    input.baseline !== undefined &&
    !input.validationScenarioIds.includes(input.baseline.scenarioId)
  ) {
    return `the recorded baseline is a result of ${input.baseline.scenarioId}, which this plan does not rerun, so nothing here would produce a candidate to compare it against`;
  }
  return 'no recorded result of a scenario that exercised these components can serve as a baseline';
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
  /*
   * Runtime evidence and a reachable comparison are different questions, and this asks the first.
   * Reading the baseline here would refuse a goal whose finding rests on real recorded runs merely
   * because none of those runs forms a repetition set large enough to compare against, which is a
   * reason to omit the metric criteria and say so, never a reason to refuse the goal.
   */
  if (input.finding.goalReadiness.requiresRuntimeEvidence && input.exercisingRunIds.length === 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `Finding ${input.finding.id} needs runtime evidence before it can be verified, and no baseline run was supplied.`,
      {
        remediation: 'Record a run with orchescope trace, then create the goal.',
      },
    );
  }

  const id = makeGoalId(input.sequence);
  const improvement = RELATIVE_IMPROVEMENT_BY_RULE[input.finding.ruleId];
  const semanticKey = semanticFindingKeyDigest(input.finding.metadata);
  const semanticSubject = semanticFindingSubjectDigest(input.finding.metadata);
  if (
    usesSemanticFindingIdentity(input.finding.metadata) &&
    (semanticKey === undefined || semanticSubject === undefined)
  ) {
    throw new OrchescopeError(
      'INVALID_STATE',
      `Finding ${input.finding.id} carries incomplete semantic identity metadata.`,
    );
  }
  return {
    schemaVersion: 1,
    id,
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
      ...acceptanceCriteriaFor(input.finding, input.validationScenarioIds, (metric) =>
        metricIsDecidable(input, metric),
      ),
    ],
    validation: validationPlanFor(input, id),
    ...(improvement === undefined
      ? {}
      : {
          expectedImprovement: `${improvement.metric} improves by at least ${Math.round(improvement.threshold * 100)} percent with task success unchanged`,
        }),
    rollback: rollbackFor(input.finding),
    validationResults: [],
    metadata: {
      ruleId: input.finding.ruleId,
      ...(semanticKey === undefined || semanticSubject === undefined
        ? {}
        : {
            findingIdentity: SEMANTIC_FINDING_IDENTITY,
            findingSemanticKey: semanticKey,
            findingSemanticSubject: semanticSubject,
          }),
      category: input.finding.category,
      severity: input.finding.severity,
      basis: input.finding.basis,
    },
  };
};
