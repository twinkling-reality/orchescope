import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Finding, Goal, RunRecord, ScenarioResult } from '@orchescope/schema';
import { createGoalFromFinding } from '../src/goal.ts';

/**
 * Which recorded work a goal is judged against.
 *
 * A comparison means something only when both sides reproduce the same work, so the runs a goal names as
 * its baseline and the scenarios its plan reruns have to be chosen together. They were once chosen apart,
 * by two rules that shared no input: the baseline was the newest completed runs in the project whatever
 * they were, and the scenarios came from matching a scenario's tags against the finding's tags and
 * component names. The plan that resulted told an operator to compare one scenario against a different
 * scenario running under an injected fault plan, and reported the injected failures as a regression the
 * operator had caused.
 *
 * The store here is a fake rather than a real database because these are assertions about a rule, not
 * about SQL, and it answers the questions both the rule under test and the rule it replaced would ask, so
 * every test below is a claim about behaviour on either.
 */

const COMPONENTS = ['agent:orchestrator', 'tool:issue_refund'];

const finding = (overrides: Partial<Finding> = {}): Finding =>
  ({
    id: 'OSC-PERF-0001',
    ruleId: 'independent-calls-run-sequentially',
    category: 'performance',
    severity: 'high',
    basis: 'observed',
    confidence: 0.9,
    polarity: 'risk',
    title: 'Independent calls run one after another',
    explanation: 'the orchestrator awaits each call in turn.',
    impact: 'the task takes longer than the work requires.',
    components: [...COMPONENTS],
    edges: [],
    sourceLocations: [{ file: 'src/agents/orchestrator.ts', startLine: 1 }],
    evidence: [],
    metrics: [],
    tags: ['latency', 'parallelism'],
    metadata: {},
    goalReadiness: { eligible: true, requiresRuntimeEvidence: false, requiresHumanReview: false },
    ...overrides,
  }) as Finding;

type Recorded = {
  readonly scenarioId: string | undefined;
  readonly runIds: readonly string[];
  readonly faultPlanId?: string;
  /**
   * How many of the finding's components each of these runs was recorded executing.
   *
   * Zero means the scenario exists and no run of it ever touched what the finding is about, so it is
   * offered to whatever reads the scenario set and withheld from whatever asks the store what ran.
   */
  readonly exercised: number;
  /** Scenario tags, which nothing under test may read and the rule this replaced did. */
  readonly tags: readonly string[];
};

/**
 * A store holding a recorded history, newest first.
 *
 * `runsExercising` is the question the rule asks and `listRuns` with `listScenarios` are the two the rule
 * it replaced asked, so both are answered from the same history and neither test depends on which one
 * runs.
 */
const workspaceHolding = (history: readonly Recorded[]) => {
  const runs = new Map<string, RunRecord>();
  const results = new Map<string, ScenarioResult[]>();
  const flat: { readonly runId: string; readonly entry: Recorded }[] = [];
  for (const entry of history) {
    for (const runId of entry.runIds) {
      runs.set(runId, {
        id: runId,
        kind: entry.scenarioId === undefined ? 'trace' : 'scenario',
        label: runId,
        status: 'completed',
        startedAt: '2026-08-01T00:00:00.000Z',
        ...(entry.scenarioId === undefined ? {} : { scenarioId: entry.scenarioId }),
        ...(entry.faultPlanId === undefined ? {} : { faultPlanId: entry.faultPlanId }),
        metrics: { taskSuccess: true },
      } as unknown as RunRecord);
      flat.push({ runId, entry });
    }
    if (entry.scenarioId !== undefined) {
      results.set(entry.scenarioId, [
        {
          id: `sres_${entry.scenarioId}`,
          scenarioId: entry.scenarioId,
          startedAt: '2026-08-01T00:00:00.000Z',
          repetitions: entry.runIds.map((runId, index) => ({ runId, repetition: index })),
        } as unknown as ScenarioResult,
      ]);
    }
  }
  const saved: Goal[] = [];
  return {
    saved,
    workspace: {
      projectId: 'prj_test',
      clock: { now: () => '2026-08-02T00:00:00.000Z' },
      store: {
        latestScan: () => ({ scanId: 'scan_one' }),
        findingById: (_scan: string, id: string) =>
          id === 'OSC-PERF-0001' ? finding() : undefined,
        listGoals: () => [],
        graphForScan: () => ({ components: [] }),
        evidenceByIds: () => [],
        nextGoalSequence: () => 1,
        saveGoal: (goal: Goal) => saved.push(goal),
        spanCountForRun: () => 4,
        runById: (runId: string) => runs.get(runId),
        scenarioResults: (_projectId: string, scenarioId: string) => results.get(scenarioId) ?? [],
        runsExercising: () =>
          flat
            .filter(({ entry }) => entry.exercised > 0)
            .map(({ runId, entry }) => ({
              runId,
              kind: entry.scenarioId === undefined ? 'trace' : 'scenario',
              label: runId,
              status: 'completed',
              startedAt: '2026-08-01T00:00:00.000Z',
              scenarioId: entry.scenarioId,
              variantId: undefined,
              faultPlanId: entry.faultPlanId,
              experimentId: undefined,
              exercisedComponents: entry.exercised,
            })),
        // What the rule this replaced read, answered from the same history.
        listRuns: () => flat.map(({ runId }) => ({ runId, status: 'completed' })),
        listScenarios: () =>
          history
            .filter((entry) => entry.scenarioId !== undefined)
            .map((entry) => ({ id: entry.scenarioId, tags: entry.tags })),
      },
    } as never,
  };
};

const planOf = (goal: Goal) => {
  const compare = goal.validation.commands.find((entry) => entry.command[1] === 'compare');
  const reruns = goal.validation.commands
    .filter((entry) => entry.command[1] === 'test')
    .map((entry) => entry.command[entry.command.indexOf('--scenario') + 1] as string);
  return { compare, reruns, last: reruns.at(-1) };
};

describe('the runs a goal is judged against', () => {
  /*
   * The measured defect, reduced to its shape.
   *
   * Two scenarios both exercised what the finding is about. One ran under an injected fault plan. The
   * plan must not name a baseline recorded under one of them and a rerun that produces the other, because
   * the difference it would then report is the difference between two scenarios and includes every
   * failure the fault plan injected on purpose.
   */
  it('names a baseline recorded from the same scenario its plan reruns last', () => {
    const { workspace, saved } = workspaceHolding([
      {
        scenarioId: 'alpha',
        runIds: ['run_a1', 'run_a2', 'run_a3'],
        exercised: 2,
        tags: ['smoke'],
      },
      {
        scenarioId: 'beta',
        runIds: ['run_b1', 'run_b2', 'run_b3'],
        faultPlanId: 'fp_injected',
        exercised: 2,
        tags: ['latency'],
      },
    ]);
    createGoalFromFinding({ workspace, findingId: 'OSC-PERF-0001' });
    const goal = saved[0] as Goal;
    const { compare, last } = planOf(goal);
    assert.ok(compare !== undefined, 'the plan prescribed no comparison');
    const baselineRun = compare.command[2] as string;
    const baselineScenario = baselineRun.startsWith('run_a') ? 'alpha' : 'beta';
    assert.equal(
      baselineScenario,
      last,
      `the plan compares a recording of ${baselineScenario} against a rerun of ${String(last)}`,
    );
  });

  /* The conditions travel with the plan, so a reader is told what the comparison holds fixed. */
  it('states the conditions the baseline was recorded under', () => {
    const { workspace, saved } = workspaceHolding([
      {
        scenarioId: 'beta',
        runIds: ['run_b1', 'run_b2', 'run_b3'],
        faultPlanId: 'fp_injected',
        exercised: 2,
        tags: [],
      },
    ]);
    createGoalFromFinding({ workspace, findingId: 'OSC-PERF-0001' });
    const goal = saved[0] as Goal;
    assert.equal(goal.validation.baseline?.scenarioId, 'beta');
    assert.equal(goal.validation.baseline?.faultPlanId, 'fp_injected');
    assert.equal(goal.validation.baseline?.samples, 3);
  });

  /*
   * Selection is by what a run was recorded executing, and by nothing that reads like a name.
   *
   * Measured over the 56 pinned repositories, matching a scenario's tags against component identifiers is
   * wrong in a fifth of the matches it makes inside one repository. Here the scenario that shares every
   * tag with the finding exercised none of its components, and the scenario that exercised all of them
   * shares no tag at all.
   */
  it('reruns the scenario recorded exercising the components, not the one whose tags read alike', () => {
    const { workspace, saved } = workspaceHolding([
      {
        scenarioId: 'shares-every-tag',
        runIds: ['run_s1', 'run_s2', 'run_s3'],
        exercised: 0,
        tags: ['latency', 'parallelism'],
      },
      {
        scenarioId: 'exercises-it',
        runIds: ['run_e1', 'run_e2', 'run_e3'],
        exercised: 2,
        tags: ['unrelated'],
      },
    ]);
    createGoalFromFinding({ workspace, findingId: 'OSC-PERF-0001' });
    const goal = saved[0] as Goal;
    assert.deepEqual(goal.validation.scenarioIds, ['exercises-it']);
  });

  /* A scenario covering more of what the finding is about is the better baseline, whatever ran last. */
  it('prefers the scenario recorded exercising more of what the finding names', () => {
    const { workspace, saved } = workspaceHolding([
      { scenarioId: 'partial', runIds: ['run_p1', 'run_p2', 'run_p3'], exercised: 1, tags: [] },
      { scenarioId: 'whole', runIds: ['run_w1', 'run_w2', 'run_w3'], exercised: 2, tags: [] },
    ]);
    createGoalFromFinding({ workspace, findingId: 'OSC-PERF-0001' });
    const goal = saved[0] as Goal;
    assert.equal(goal.validation.baseline?.scenarioId, 'whole');
  });

  /*
   * A sample floor nobody can reach is a criterion nobody can answer.
   *
   * `compareMetric` refuses a direction below three samples a side, so a baseline recorded once can never
   * decide a latency or a success rate however the plan is run. What it can still decide is a metric
   * judged by presence, which is why the duplicate side effect criterion survives here and the other two
   * do not.
   */
  it('states no criterion about a distribution when the recorded baseline is a single repetition', () => {
    const { workspace, saved } = workspaceHolding([
      { scenarioId: 'once', runIds: ['run_o1'], exercised: 2, tags: [] },
    ]);
    createGoalFromFinding({ workspace, findingId: 'OSC-PERF-0001' });
    const goal = saved[0] as Goal;
    const metrics = goal.acceptanceCriteria
      .map((criterion) => criterion.check)
      .filter((check) => check.kind === 'metric_improvement' || check.kind === 'metric_not_worse')
      .map((check) => check.metric);
    assert.ok(
      !metrics.includes('successRate'),
      'a success rate criterion was stated against one recorded sample',
    );
    assert.ok(
      !metrics.includes('durationMs.p95'),
      'a latency criterion was stated against one recorded sample',
    );
    assert.deepEqual(metrics, ['duplicateSideEffects']);
  });

  /*
   * A GUARD, not a falsifier: it holds on the tree before this change as well, and it is here so that
   * this rule is not the thing that reintroduces the mistake. A run no scenario repeated stands for
   * itself. Nothing in the plan can rerun it, so it is evidence and never a baseline, and inventing a
   * repetition set for it would claim that runs nobody repeated are repetitions of each other.
   */
  it('does not turn a traced run that exercised the components into a scenario to rerun', () => {
    const { workspace, saved } = workspaceHolding([
      { scenarioId: undefined, runIds: ['run_t1'], exercised: 2, tags: [] },
    ]);
    createGoalFromFinding({ workspace, findingId: 'OSC-PERF-0001' });
    const goal = saved[0] as Goal;
    assert.deepEqual(goal.validation.scenarioIds, []);
    assert.equal(
      goal.validation.commands.some((entry) => entry.command[1] === 'compare'),
      false,
      'the plan prescribed a comparison whose candidate nothing would produce',
    );
  });

  /* The reason is carried rather than left to be inferred from an empty array. */
  it('says why no comparison is prescribed when the exercising runs belong to no scenario', () => {
    const { workspace, saved } = workspaceHolding([
      { scenarioId: undefined, runIds: ['run_t1'], exercised: 2, tags: [] },
    ]);
    createGoalFromFinding({ workspace, findingId: 'OSC-PERF-0001' });
    const goal = saved[0] as Goal;
    assert.match(goal.validation.comparisonUnavailable ?? '', /belong to no scenario/);
  });
});
