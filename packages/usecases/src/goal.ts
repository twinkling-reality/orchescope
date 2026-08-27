import { OrchescopeError } from '@orchescope/domain';
import {
  createGoal,
  goalMatchesFinding,
  type GoalValidation,
  openGoalForFinding,
  REVIEW_NOTE_PLACEHOLDER,
  validateGoal,
} from '@orchescope/goals';
import type { Comparison, Finding, Goal, ScenarioResult, Timestamp } from '@orchescope/schema';
import type { Workspace } from '@orchescope/workspace';

/**
 * The goal use case: turn a finding into a bounded goal, and later judge whether the change satisfied it.
 *
 * Validation scenarios are chosen by matching a scenario's tags against the finding's components and tags rather
 * than by guessing: a scenario is only proposed when it names one of the affected components or shares a tag
 * with the finding, and a goal with no validation scenario says so instead of pretending it can be verified.
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

const chooseValidationScenarios = (
  workspace: Workspace,
  components: readonly string[],
  tags: readonly string[],
): readonly string[] => {
  const scenarios = workspace.store.listScenarios(workspace.projectId);
  const matches = scenarios.filter(
    (scenario) =>
      scenario.tags.some((tag) => tags.includes(tag)) ||
      components.some((component) =>
        scenario.tags.some(
          (tag) => component.includes(tag) || tag.includes(component.split(':')[1] ?? ''),
        ),
      ),
  );
  const chosen = matches.length > 0 ? matches : scenarios;
  return chosen.slice(0, 3).map((scenario) => scenario.id);
};

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
  const runIds = workspace.store
    .listRuns({ projectId: workspace.projectId, limit: 20 })
    .filter((run) => run.status === 'completed')
    .map((run) => run.runId);

  const goal = createGoal({
    finding,
    sequence: workspace.store.nextGoalSequence(workspace.projectId),
    now: workspace.clock.now(),
    components,
    evidence,
    validationScenarioIds: chooseValidationScenarios(workspace, finding.components, finding.tags),
    baselineRunIds: runIds.slice(0, 3),
    repetitions: request.repetitions ?? 3,
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
