import { OrchescopeError } from '@orchescope/domain';
import { createGoal, type GoalValidation, validateGoal } from '@orchescope/goals';
import type { Comparison, Goal, ScenarioResult, Timestamp } from '@orchescope/schema';
import type { Workspace } from '@orchescope/workspace';

/**
 * The goal use case: turn a finding into a bounded goal, and later judge whether the change satisfied it.
 *
 * Validation scenarios are chosen by matching a scenario's tags against the finding's components and tags rather
 * than by guessing: a scenario is only proposed when it names one of the affected components or shares a tag
 * with the finding, and a goal with no validation scenario says so instead of pretending it can be verified.
 */

export type CreateGoalRequest = {
  readonly workspace: Workspace;
  readonly scanId?: string;
  readonly findingId: string;
  readonly repetitions?: number;
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

export const createGoalFromFinding = (request: CreateGoalRequest): Goal => {
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
  return goal;
};

export type ValidateGoalRequest = {
  readonly workspace: Workspace;
  readonly goalId: string;
  readonly comparison?: Comparison;
  readonly scenarioResults?: readonly ScenarioResult[];
  readonly rescanned?: boolean;
};

export type ValidateGoalResult = {
  readonly goal: Goal;
  readonly validation: GoalValidation;
};

export const validateGoalOutcome = (request: ValidateGoalRequest): ValidateGoalResult => {
  const { workspace } = request;
  const goal = workspace.store.goalById(request.goalId);
  if (goal === undefined) {
    throw new OrchescopeError('NOT_FOUND', `No goal ${request.goalId}.`);
  }
  const latestScan = workspace.store.latestScan(workspace.projectId);
  const stillPresent = new Set(
    latestScan === undefined
      ? []
      : workspace.store
          .listFindings({ scanId: latestScan.scanId })
          .filter((finding) => finding.ruleId === goal.metadata['ruleId'])
          .map((finding) => finding.id),
  );
  if (latestScan !== undefined && stillPresent.size === 0) {
    // The finding identifier can change between scans, so absence is judged on the rule rather than the id.
    stillPresent.delete(goal.findingId);
  } else if (latestScan !== undefined) {
    stillPresent.add(goal.findingId);
  }

  const validation = validateGoal(goal, {
    comparison: request.comparison,
    scenarioResults: request.scenarioResults ?? [],
    findingStillPresent: stillPresent,
    rescanned: request.rescanned ?? latestScan !== undefined,
  });

  const now: Timestamp = workspace.clock.now();
  const updated: Goal = {
    ...goal,
    status: validation.validated ? 'validated' : goal.status === 'draft' ? 'draft' : 'in_progress',
    updatedAt: now,
    validationResults:
      request.comparison === undefined
        ? goal.validationResults
        : [
            ...goal.validationResults,
            { comparisonId: request.comparison.id, at: now, verdict: request.comparison.verdict },
          ],
  };
  workspace.store.saveGoal(updated, workspace.projectId);
  return { goal: updated, validation };
};
