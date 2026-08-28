import { compare, metricsForGoal } from '@orchescope/comparison';
import { OrchescopeError, type RunObservation } from '@orchescope/domain';
import type { Comparison, ComparisonSide, Goal, RunRecord } from '@orchescope/schema';
import type { Workspace } from '@orchescope/workspace';
import { resolveRevision } from '@orchescope/workspace';

/**
 * Comparison of a baseline against a candidate.
 *
 * References resolve in a fixed order, and each kind of reference supports a different claim, which the result
 * says out loud:
 *
 *  - a run identifier, or `latest`, compares measured runs and supports metric claims;
 *  - a scan identifier compares declared graphs and findings, and supports no metric claim;
 *  - a git reference resolves to a commit and compares the scans recorded at those commits, without executing
 *    anything, because running code from another revision is a decision for the operator rather than a side
 *    effect of asking for a comparison.
 */

export type CompareRequest = {
  readonly workspace: Workspace;
  readonly baseline: string;
  readonly candidate: string;
  readonly goalId?: string;
  readonly limit?: number;
};

type Resolved = {
  readonly side: ComparisonSide;
  readonly runs: readonly RunRecord[];
  readonly scanId: string | undefined;
};

/**
 * The runs one named run stands for, which is the repetition set it belongs to.
 *
 * Repetitions exist to give a metric a sample size, and comparing one of them against one of another is
 * comparing two draws from a noisy process. It is also the shape the printed plan produces: a goal names
 * one baseline run and the candidate side resolves to one run, so every non-incident metric came back
 * `indeterminate` for want of the samples the scenario had already recorded, and a real regression in
 * task success was reported as something the evidence could not judge.
 *
 * A run that came from `orchescope trace` belongs to no set and stands for itself, which is the honest
 * answer for a run nothing repeated.
 */
const repetitionSet = (workspace: Workspace, run: RunRecord): readonly RunRecord[] => {
  if (run.scenarioId === undefined) return [run];
  const result = workspace.store
    .scenarioResults(workspace.projectId, run.scenarioId)
    .find((entry) => entry.repetitions.some((repetition) => repetition.runId === run.id));
  if (result === undefined) return [run];
  const runs = result.repetitions
    .map((repetition) => workspace.store.runById(repetition.runId))
    .filter((entry): entry is RunRecord => entry !== undefined);
  return runs.length > 0 ? runs : [run];
};

/**
 * What these runs all did, when they all did the same thing.
 *
 * Reported only where every run agrees, because a side whose runs disagree describes no single condition
 * and naming one of them would be a claim about the rest. This is what lets a comparison say that its two
 * sides measured different work instead of presenting the difference between two scenarios as a result.
 */
const conditionsOf = (
  runs: readonly RunRecord[],
): Pick<ComparisonSide, 'scenarioId' | 'variantId' | 'faultPlanId'> => {
  const agreed = <K extends 'scenarioId' | 'variantId' | 'faultPlanId'>(
    key: K,
  ): RunRecord[K] | undefined => {
    const first = runs[0]?.[key];
    return runs.every((run) => run[key] === first) ? first : undefined;
  };
  const scenarioId = agreed('scenarioId');
  const variantId = agreed('variantId');
  const faultPlanId = agreed('faultPlanId');
  return {
    ...(scenarioId === undefined ? {} : { scenarioId }),
    ...(variantId === undefined ? {} : { variantId }),
    ...(faultPlanId === undefined ? {} : { faultPlanId }),
  };
};

/** A side made from one named run and the repetitions recorded alongside it. */
const sideFromRun = (
  workspace: Workspace,
  run: RunRecord,
  reference: string,
  label: string,
): Resolved => {
  const runs = repetitionSet(workspace, run);
  const repetitions = runs.length === 1 ? '' : `, ${runs.length} repetitions`;
  return {
    side: {
      kind: 'run',
      reference,
      label: `${label} (${run.label}${repetitions})`,
      runIds: runs.map((entry) => entry.id),
      ...conditionsOf(runs),
      ...(run.git === undefined ? {} : { git: run.git }),
    },
    runs,
    scanId: undefined,
  };
};

const resolveSide = (workspace: Workspace, reference: string, label: string): Resolved => {
  if (reference === 'latest') {
    const summaries = workspace.store.listRuns({ projectId: workspace.projectId, limit: 10 });
    const runs = summaries
      .map((summary) => workspace.store.runById(summary.runId))
      .filter((run): run is RunRecord => run !== undefined);
    if (runs.length === 0) {
      throw new OrchescopeError('NOT_FOUND', 'No run is stored, so "latest" cannot be resolved.', {
        remediation: 'Record a run with orchescope trace or orchescope test first.',
      });
    }
    const latest = runs[0] as RunRecord;
    return sideFromRun(workspace, latest, latest.id, label);
  }

  if (reference.startsWith('run_')) {
    const run = workspace.store.runById(reference);
    if (run === undefined) throw new OrchescopeError('NOT_FOUND', `No run ${reference}.`);
    return sideFromRun(workspace, run, reference, label);
  }

  if (reference.startsWith('scan_')) {
    const scan = workspace.store.scanById(reference);
    if (scan === undefined) throw new OrchescopeError('NOT_FOUND', `No scan ${reference}.`);
    return {
      side: { kind: 'scan', reference, label, runIds: [], scanId: reference },
      runs: [],
      scanId: reference,
    };
  }

  const commit = resolveRevision(workspace.paths.root, reference);
  if (commit === undefined) {
    throw new OrchescopeError('NOT_FOUND', `${reference} is not a run, a scan or a git revision.`, {
      remediation:
        'Pass a run identifier, a scan identifier, "latest", or a git revision that exists.',
    });
  }
  const scans = workspace.store.database.all(
    'SELECT id FROM scan WHERE project_id = ? AND git_commit = ? ORDER BY created_at DESC LIMIT 1',
    workspace.projectId,
    commit,
  );
  const scanId = scans[0]?.['id'];
  if (typeof scanId !== 'string') {
    throw new OrchescopeError(
      'NOT_FOUND',
      `No scan is stored for commit ${commit.slice(0, 12)}, so there is nothing to compare.`,
      {
        remediation: `Check out ${reference}, run orchescope audit, then come back and compare.`,
      },
    );
  }
  const runs = workspace.store
    .listRuns({ projectId: workspace.projectId, limit: 50 })
    .map((summary) => workspace.store.runById(summary.runId))
    .filter((run): run is RunRecord => run !== undefined && run.git?.commit === commit);
  return {
    side: {
      kind: 'git_ref',
      reference,
      label: `${label} (${commit.slice(0, 12)})`,
      runIds: runs.map((run) => run.id),
      ...conditionsOf(runs),
      scanId,
      git: { commit, ref: reference, dirty: false },
    },
    runs,
    scanId,
  };
};

/**
 * A goal a comparison claims to be evidence for has to exist.
 *
 * `goal_id` is written straight through to the document and the judgement finds a comparison with
 * `WHERE goal_id = ?`, so a mistyped identifier stores a comparison attached to nothing and leaves the
 * real goal reporting that no comparison was recorded. That is indistinguishable, from the operator's
 * side, from having forgotten the flag, and it is the failure the flag exists to remove. Refused here,
 * where the store is already in hand, rather than discovered later by a goal that cannot see its own
 * evidence.
 */
const goalNamed = (workspace: Workspace, goalId: string): Goal => {
  const goal = workspace.store.goalById(goalId);
  if (goal !== undefined) return goal;
  throw new OrchescopeError('NOT_FOUND', `No goal ${goalId}.`, {
    detail: { goalId },
    remediation: 'Run orchescope goals to list the goals this project holds.',
  });
};

export const compareUseCase = (request: CompareRequest): Comparison => {
  const { workspace } = request;
  const goal = request.goalId === undefined ? undefined : goalNamed(workspace, request.goalId);
  const baseline = resolveSide(workspace, request.baseline, 'baseline');
  const candidate = resolveSide(workspace, request.candidate, 'candidate');

  const baselineGraph =
    baseline.scanId === undefined ? undefined : workspace.store.graphForScan(baseline.scanId);
  const candidateGraph =
    candidate.scanId === undefined ? undefined : workspace.store.graphForScan(candidate.scanId);
  const baselineFindings =
    baseline.scanId === undefined
      ? undefined
      : workspace.store.listFindings({ scanId: baseline.scanId });
  const candidateFindings =
    candidate.scanId === undefined
      ? undefined
      : workspace.store.listFindings({ scanId: candidate.scanId });

  /*
   * Each run travels with how much it observed. A run is a record that something executed and not a
   * record that anything was measured, and a comparison that cannot tell the two apart reports counters
   * of zero from an uninstrumented target as though they had been counted.
   */
  const observed = (runs: readonly RunRecord[]): readonly RunObservation[] =>
    runs.map((run) => ({ run, spanCount: workspace.store.spanCountForRun(run.id) }));

  const comparison = compare({
    baseline: baseline.side,
    candidate: candidate.side,
    baselineRuns: observed(baseline.runs),
    candidateRuns: observed(candidate.runs),
    ...(baselineGraph === undefined ? {} : { baselineGraph }),
    ...(candidateGraph === undefined ? {} : { candidateGraph }),
    ...(baselineFindings === undefined ? {} : { baselineFindings }),
    ...(candidateFindings === undefined ? {} : { candidateFindings }),
    ...(goal === undefined ? {} : { goalId: goal.id, metrics: metricsForGoal(goal) }),
    now: workspace.clock.now(),
  });

  workspace.store.saveComparison(comparison, workspace.projectId);
  return comparison;
};
