import {
  formatCount,
  MINIMUM_SAMPLES_PER_SIDE,
  OrchescopeError,
  runMeasuredNothing,
} from '@orchescope/domain';
import {
  createGoal,
  goalMatchesFinding,
  type GoalValidation,
  openGoalForFinding,
  REVIEW_NOTE_PLACEHOLDER,
  validateGoal,
} from '@orchescope/goals';
import type {
  Comparison,
  Finding,
  Goal,
  RunRecord,
  ScenarioResult,
  Timestamp,
} from '@orchescope/schema';
import type { Workspace } from '@orchescope/workspace';

/**
 * The goal use case: turn a finding into a bounded goal, and later judge whether the change satisfied it.
 *
 * What a goal is judged against is one question, not two. A comparison means something only when both sides
 * reproduce the same work, so the scenarios the plan reruns and the runs it compares against have to be chosen
 * together, from the same evidence, or nothing checks that they agree. They used to be chosen apart: the
 * baseline was the newest three completed runs in the project whatever they were, and the scenarios came from
 * matching a scenario's tags against the finding's tags and component names. Neither related to the other, and
 * the plan that resulted told an operator to compare one scenario against a different scenario running under an
 * injected fault plan, then reported the faults as a regression the operator had caused.
 *
 * Both are now answered from what the repository recorded. The audit writes, per run, which graph components
 * that run executed, so "which recorded work is this finding about" is the declared against exercised join
 * asked backwards, and it is a scoped query rather than a window. No name is matched against any other name:
 * measured over the 56 pinned repositories, matching a scenario's tags against component identifiers is wrong
 * in a fifth of the matches it makes inside one repository and in nearly two thirds across the corpus
 * vocabulary, under the assumption most favourable to it.
 *
 * Creation is idempotent per finding: a finding that already has an open goal gets that goal back rather than a
 * copy of it, and the caller is told which happened. What counts as the same goal is decided by
 * `openGoalForFinding` in `@orchescope/goals`.
 */

export type CreateGoalRequest = {
  readonly workspace: Workspace;
  readonly scanId?: string;
  readonly findingId: string;
  readonly repetitions?: number;
  /**
   * Cuts a second goal from a finding that already has an open one.
   *
   * Opt in rather than default, because the caller that asks twice is usually asking the same question
   * twice. A caller that genuinely wants two attempts at one finding says so.
   */
  readonly createAnother?: boolean;
};

export type CreateGoalResult = {
  readonly goal: Goal;
  /** False when the finding already had an open goal, which was returned unchanged. */
  readonly created: boolean;
};

/**
 * How many scenarios a plan will ask an implementer to rerun.
 *
 * A ceiling on what a person is asked to do, not a selection rule: what selects is which recorded runs
 * exercised the components, and this only stops a system with many scenarios printing a plan nobody follows.
 * The scenario the comparison rests on is always among them, whatever its rank.
 */
const MAX_VALIDATION_SCENARIOS = 3;

/** A ceiling on the rows the exercising query reads back, never a window on which runs count. */
const MAX_EXERCISING_RUNS = 200;

/** How many stored results of one scenario are examined before it is passed over. */
const MAX_RESULTS_PER_SCENARIO = 5;

/**
 * How far down the coverage ranking a baseline is looked for.
 *
 * Reading a stored result costs a query for each of its repetitions, so this is what stops a system with
 * hundreds of scenarios touching one component from paying for all of them. It bounds work and not
 * correctness: the ranking is by how much of the finding each scenario was recorded exercising, so what
 * lies past this ceiling was already the worse baseline.
 */
const MAX_SCENARIOS_SEARCHED = 10;

type BaselineCandidate = {
  readonly scenarioId: string;
  readonly variantId: string | undefined;
  readonly faultPlanId: string | undefined;
  readonly runIds: readonly string[];
  readonly samples: number;
};

/**
 * One recorded scenario result read as a possible baseline, with the conditions it was recorded under.
 *
 * A result is the coherent unit already: one scenario, one environment, its repetitions kept whole. It is
 * also what a named run resolves back to on the comparison, so naming one of these runs on the compare
 * command reassembles the set with no new grammar.
 *
 * A result whose repetitions disagree about the variant or the fault plan is not one condition and is
 * refused rather than described by whichever of them happens to be first. `samples` counts only the
 * repetitions that will actually contribute, by the same two tests the comparison applies, so the count the
 * plan promises is the count the comparison will see.
 */
const baselineFrom = (
  workspace: Workspace,
  result: ScenarioResult,
): BaselineCandidate | undefined => {
  const runs = result.repetitions
    .map((repetition) => workspace.store.runById(repetition.runId))
    .filter((run): run is RunRecord => run !== undefined);
  const first = runs[0];
  if (first === undefined) return undefined;
  if (runs.some((run) => run.variantId !== first.variantId)) return undefined;
  if (runs.some((run) => run.faultPlanId !== first.faultPlanId)) return undefined;
  const samples = runs.filter(
    (run) =>
      run.status === 'completed' &&
      !runMeasuredNothing({ run, spanCount: workspace.store.spanCountForRun(run.id) }),
  ).length;
  return {
    scenarioId: result.scenarioId,
    variantId: first.variantId,
    faultPlanId: first.faultPlanId,
    runIds: runs.map((run) => run.id),
    samples,
  };
};

/**
 * The best stored result of this scenario to compare a rerun against.
 *
 * Enough samples to decide a direction is preferred and is not required, because deciding a metric is not
 * one kind of act: a duplicated side effect that happened and now does not is decided by presence, and it
 * is the criterion the loop most often closes on. So a result that clears the floor wins, and otherwise
 * the newest usable result is returned with the sample count it actually supplies, which is what lets the
 * goal state the distribution criteria only where they can be answered.
 */
const comparableResultFor = (
  workspace: Workspace,
  scenarioId: string,
): BaselineCandidate | undefined => {
  const candidates = workspace.store
    .scenarioResults(scenarioId, MAX_RESULTS_PER_SCENARIO)
    .map((result) => baselineFrom(workspace, result))
    .filter((candidate): candidate is BaselineCandidate => candidate !== undefined)
    .filter((candidate) => candidate.samples > 0);
  return (
    candidates.find((candidate) => candidate.samples >= MINIMUM_SAMPLES_PER_SIDE) ?? candidates[0]
  );
};

type ValidationEvidence = {
  readonly scenarioIds: readonly string[];
  /** Runs that exercised the components, whether or not any of them can serve as a baseline. */
  readonly exercisingRunIds: readonly string[];
  readonly baseline: BaselineCandidate | undefined;
  readonly comparisonUnavailable: string | undefined;
};

/**
 * The recorded work a goal is judged against, and the scenarios that reproduce it.
 *
 * Scenarios are ranked by how much of what the finding is about they were recorded exercising, and only then
 * by recency. A run that touched one of six named components and a run that touched all six are both matches,
 * and preferring the more recent of them would pick a baseline measuring a sixth of the thing being changed.
 * On the demonstration system that ordering is the difference between a scenario covering six of six
 * components and one whose injected faults stop it after three.
 *
 * A run belonging to no scenario is not a validation scenario. It exercised the components and it counts as
 * evidence, but nothing here can rerun it, and inventing a repetition set for it would be a claim that runs
 * nobody repeated are repetitions of each other.
 *
 * Where no comparable pair exists the reason is carried rather than left to be inferred from two empty
 * arrays, because each reason has a different remedy and a reader who cannot tell them apart has been told
 * only that something is missing.
 */
const chooseValidationEvidence = (workspace: Workspace, finding: Finding): ValidationEvidence => {
  const exercising = workspace.store.runsExercising({
    projectId: workspace.projectId,
    componentIds: finding.components,
    limit: MAX_EXERCISING_RUNS,
  });
  const exercisingRunIds = exercising.map((run) => run.runId);
  if (exercising.length === 0) {
    return {
      scenarioIds: [],
      exercisingRunIds,
      baseline: undefined,
      comparisonUnavailable:
        'no recorded run has exercised the components this finding names, so there is nothing to compare against',
    };
  }

  const coverage = new Map<string, { readonly rank: number; readonly order: number }>();
  exercising.forEach((run, order) => {
    if (run.scenarioId === undefined) return;
    const seen = coverage.get(run.scenarioId);
    if (seen === undefined || run.exercisedComponents > seen.rank) {
      coverage.set(run.scenarioId, { rank: run.exercisedComponents, order: seen?.order ?? order });
    }
  });
  const ranked = [...coverage.entries()]
    .toSorted(([, left], [, right]) =>
      left.rank === right.rank ? left.order - right.order : right.rank - left.rank,
    )
    .map(([scenarioId]) => scenarioId);

  if (ranked.length === 0) {
    return {
      scenarioIds: [],
      exercisingRunIds,
      baseline: undefined,
      comparisonUnavailable:
        'the runs that exercised these components belong to no scenario, so this plan has no way to record a run made after the change',
    };
  }

  /*
   * A scenario covering more of what the finding is about wins, and among those a result that clears the
   * sample floor wins over one that does not, because the criteria it can carry are the point.
   *
   * Searched in rank order and stopped at the first result that clears the floor, rather than reading
   * every scenario's history and choosing afterwards. Reading a result costs a query per repetition, and a
   * system with hundreds of scenarios exercising one component would otherwise pay all of them to answer a
   * question the first few already answered. The ceiling bounds the rest: past it the ranking has stopped
   * being about coverage, and a scenario nothing ranked highly is not a better baseline for having been
   * looked at.
   */
  let baseline: BaselineCandidate | undefined;
  for (const scenarioId of ranked.slice(0, MAX_SCENARIOS_SEARCHED)) {
    const candidate = comparableResultFor(workspace, scenarioId);
    if (candidate === undefined) continue;
    if (candidate.samples >= MINIMUM_SAMPLES_PER_SIDE) {
      baseline = candidate;
      break;
    }
    baseline ??= candidate;
  }

  /*
   * The compared scenario goes last so that `latest` on the printed compare command is its rerun. That
   * ordering is a convenience and not what makes the comparison sound: a plan run out of order produces a
   * comparison whose sides name different work, the comparison says so, and the criterion stays undecided
   * rather than reporting a regression nobody caused.
   */
  const others = ranked
    .filter((scenarioId) => scenarioId !== baseline?.scenarioId)
    .slice(0, baseline === undefined ? MAX_VALIDATION_SCENARIOS : MAX_VALIDATION_SCENARIOS - 1);
  const scenarioIds = baseline === undefined ? others : [...others, baseline.scenarioId];

  return {
    scenarioIds,
    exercisingRunIds,
    ...(baseline === undefined ? { baseline: undefined } : { baseline }),
    comparisonUnavailable: baseline !== undefined ? undefined : unavailableReason(ranked),
  };
};

/**
 * Why no comparable pair was found, distinguishing questions with different answers.
 *
 * "Nothing was recorded" asks for a run. "One repetition was recorded" asks for more of them and no rule can
 * manufacture the rest. "You asked for fewer repetitions than a direction needs" asks the operator to change
 * one argument. A single sentence covering all three would send every reader down the wrong path twice.
 */
const unavailableReason = (scenarioIds: readonly string[]): string =>
  `the ${formatCount(scenarioIds.length, 'scenario')} that exercised these components ${scenarioIds.length === 1 ? 'has' : 'have'} no stored result whose repetitions were recorded under one set of conditions and measured anything`;

export const createGoalFromFinding = (request: CreateGoalRequest): CreateGoalResult => {
  const { workspace } = request;
  const scanId = request.scanId ?? workspace.store.latestScan(workspace.projectId)?.scanId;
  if (scanId === undefined) {
    throw new OrchescopeError('NOT_FOUND', 'No scan is stored for this project.', {
      remediation: 'Run orchescope audit first.',
    });
  }
  const finding = workspace.store.findingById(scanId, request.findingId);
  if (finding === undefined) {
    throw new OrchescopeError('NOT_FOUND', `No finding ${request.findingId} in scan ${scanId}.`, {
      remediation: 'List findings with orchescope audit --json, or rerun the audit.',
    });
  }
  if (request.createAnother !== true) {
    const existing = openGoalForFinding(
      workspace.store.listGoals(workspace.projectId).toReversed(),
      finding,
    );
    if (existing !== undefined) return { goal: existing, created: false };
  }

  const graph = workspace.store.graphForScan(scanId);
  const components = graph.components.filter((component) =>
    finding.components.includes(component.id),
  );
  const evidence = workspace.store.evidenceByIds(finding.evidence);
  const repetitions = request.repetitions ?? 3;
  const chosen = chooseValidationEvidence(workspace, finding);

  const goal = createGoal({
    finding,
    sequence: workspace.store.nextGoalSequence(workspace.projectId),
    now: workspace.clock.now(),
    components,
    evidence,
    validationScenarioIds: chosen.scenarioIds,
    exercisingRunIds: chosen.exercisingRunIds,
    ...(chosen.baseline === undefined ? {} : { baseline: chosen.baseline }),
    ...(chosen.comparisonUnavailable === undefined
      ? {}
      : { comparisonUnavailable: chosen.comparisonUnavailable }),
    repetitions,
  });
  workspace.store.saveGoal(goal, workspace.projectId);
  return { goal, created: true };
};

export type ValidateGoalRequest = {
  readonly workspace: Workspace;
  readonly goalId: string;
  readonly comparison?: Comparison;
  readonly rescanned?: boolean;
};

/**
 * The stored results of every scenario the goal's criteria name.
 *
 * A goal is verified by rerunning the scenario it was created with, so the results it is judged against are read
 * from the store rather than supplied by the caller. Passing them in would mean every surface had to remember to,
 * and the one that forgot would report an unjudgeable criterion as undecided while the evidence sat in the store.
 */
const resultsForCriteria = (workspace: Workspace, goal: Goal): readonly ScenarioResult[] => {
  const scenarioIds = new Set(
    goal.acceptanceCriteria
      .map((criterion) => criterion.check)
      .filter((check) => check.kind === 'scenario_passes')
      .map((check) => check.scenarioId),
  );
  return [...scenarioIds].flatMap((scenarioId) => workspace.store.scenarioResults(scenarioId));
};

export type ValidateGoalResult = {
  readonly goal: Goal;
  readonly validation: GoalValidation;
  /**
   * The comparison that decided the metric criteria, when one did.
   *
   * The caller resolves this silently when it is not passed, so without it a reader is told a goal was
   * refused and never told what refused it. A verdict whose evidence cannot be named is not something a
   * person can check.
   */
  readonly comparison?: Comparison;
};

/**
 * The comparison that may decide this goal's metric criteria.
 *
 * `compare --goal` is how a reader states which goal a comparison is evidence for, and it is the only
 * reason that link is recorded, so the judgement reads it back rather than asking for the identifier
 * again on the next command. Only a comparison made after the goal is eligible: an earlier one measured
 * the code the goal exists to change, and letting it decide a criterion would validate the change
 * against its own baseline, which is the mistake `scenarioPassesOutcome` already refuses to make.
 */
const comparisonForGoal = (workspace: Workspace, goal: Goal): Comparison | undefined =>
  workspace.store.latestComparisonForGoal(goal.id, goal.createdAt);

/**
 * Judges one goal against what the store holds.
 *
 * Exported because two surfaces need the same answer from the same rules: `orchescope goal validate`,
 * which prints it, and the audit, which carries it into the report so the Goals screen can state what
 * was decided instead of claiming nothing was.
 *
 * Presence is resolved on the same semantic claim, not every risk emitted by the same rule. Semantic
 * goals carry the full key and subject digests. A version-1 goal uses the explicit compatibility match
 * on its stored rule and canonical affected components. A strength never keeps a risk goal open.
 */
export const judgeGoal = (input: {
  readonly workspace: Workspace;
  readonly goal: Goal;
  readonly findings: readonly Finding[];
  readonly rescanned: boolean;
  readonly comparison?: Comparison;
}): GoalValidation => {
  const { workspace, goal } = input;
  const stillPresent = new Set(
    input.findings
      .filter((finding) => finding.polarity === 'risk' && goalMatchesFinding(goal, finding))
      .map((finding) => finding.id),
  );
  if (stillPresent.size > 0) stillPresent.add(goal.findingId);
  return validateGoal(goal, {
    comparison: input.comparison ?? comparisonForGoal(workspace, goal),
    scenarioResults: resultsForCriteria(workspace, goal),
    findingStillPresent: stillPresent,
    rescanned: input.rescanned,
  });
};

export type RecordGoalReviewRequest = {
  readonly workspace: Workspace;
  readonly goalId: string;
  readonly note: string;
};

/**
 * Recording that somebody reviewed the change this goal describes.
 *
 * A `manual_review` criterion is the one term no run can decide, and without an act that writes it down
 * it could never be satisfied, so a goal cut from a finding that needs a review was unvalidatable by
 * construction. This is that act, and it is deliberately separate from judging the goal: recording a
 * review and asking what the evidence now says are two different things, and folding them together would
 * mean neither could be done alone.
 *
 * It refuses a goal that asks for no review. A review recorded against a goal whose criteria never
 * mention one is a note nothing reads, and storing it would let a caller believe they had answered
 * something.
 *
 * The note is stored as written, through the workspace redactor, because it is text a person typed and
 * this repository treats such text as untrusted everywhere else.
 */
export const recordGoalReview = (request: RecordGoalReviewRequest): Goal => {
  const { workspace } = request;
  const goal = workspace.store.goalById(request.goalId);
  if (goal === undefined) {
    throw new OrchescopeError('NOT_FOUND', `No goal ${request.goalId}.`, {
      remediation: 'Run orchescope goals to list the goals this project holds.',
    });
  }
  const note = workspace.redactor.text(request.note).trim();
  if (note.length === 0) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'A review needs a note saying what was checked.',
      {
        remediation: 'Pass --note with what you reviewed and what you concluded.',
      },
    );
  }
  /*
   * The plan prints the placeholder so the shape of the command is obvious, and it comes back here
   * unchanged whenever something ran the plan without reading it. Storing it would satisfy the one
   * criterion no run can decide with a string this product wrote itself.
   */
  if (note.includes(REVIEW_NOTE_PLACEHOLDER)) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      'The review note is still the placeholder the goal printed, so it records no review.',
      {
        detail: { goalId: goal.id },
        remediation: `Replace ${REVIEW_NOTE_PLACEHOLDER} with what you checked and what you concluded.`,
      },
    );
  }
  if (!goal.acceptanceCriteria.some((criterion) => criterion.check.kind === 'manual_review')) {
    throw new OrchescopeError(
      'INVALID_ARGUMENT',
      `Goal ${goal.id} states no criterion that a review decides.`,
      {
        detail: { goalId: goal.id },
        remediation: 'Nothing here is waiting on a review, so recording one would decide nothing.',
      },
    );
  }
  const updated: Goal = {
    ...goal,
    updatedAt: workspace.clock.now(),
    reviews: [...(goal.reviews ?? []), { at: workspace.clock.now(), note: note.slice(0, 2000) }],
  };
  workspace.store.saveGoal(updated, workspace.projectId);
  return updated;
};

export const validateGoalOutcome = (request: ValidateGoalRequest): ValidateGoalResult => {
  const { workspace } = request;
  const goal = workspace.store.goalById(request.goalId);
  if (goal === undefined) {
    throw new OrchescopeError('NOT_FOUND', `No goal ${request.goalId}.`);
  }
  const latestScan = workspace.store.latestScan(workspace.projectId);
  const findings =
    latestScan === undefined ? [] : workspace.store.listFindings({ scanId: latestScan.scanId });
  const comparison = request.comparison ?? comparisonForGoal(workspace, goal);

  const validation = judgeGoal({
    workspace,
    goal,
    findings,
    rescanned: request.rescanned ?? latestScan !== undefined,
    ...(comparison === undefined ? {} : { comparison }),
  });

  const now: Timestamp = workspace.clock.now();
  // The list records the comparisons that judged this goal, so validating twice against the same one
  // adds nothing: an entry per invocation would grow without bound and say nothing new.
  const alreadyRecorded =
    comparison !== undefined &&
    goal.validationResults.some((result) => result.comparisonId === comparison.id);
  const updated: Goal = {
    ...goal,
    status: validation.validated ? 'validated' : goal.status === 'draft' ? 'draft' : 'in_progress',
    updatedAt: now,
    validationResults:
      comparison === undefined || alreadyRecorded
        ? goal.validationResults
        : [
            ...goal.validationResults,
            { comparisonId: comparison.id, at: now, verdict: comparison.verdict },
          ],
  };
  workspace.store.saveGoal(updated, workspace.projectId);
  return { goal: updated, validation, ...(comparison === undefined ? {} : { comparison }) };
};
