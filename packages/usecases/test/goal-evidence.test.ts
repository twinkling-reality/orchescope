import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Goal } from '@orchescope/schema';
import { createGoalFromFinding } from '../src/goal.ts';
import { type RecordedRun, storeDouble, workspaceDouble } from './store-double.ts';
import * as documents from './stored-documents.ts';

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
 * The store here is a double rather than a database because these are assertions about a rule, not about
 * SQL. What each test supplies is the recorded history: runs, what each one executed, and the scenario
 * result that repeats them. Coverage is counted from the components a run recorded rather than from a
 * number the fixture asserts, so a test cannot claim a run exercised something it did not.
 */

const PROJECT = 'prj_0000000000000001';
const FINDING = 'OSC-PERF-0001';
const COMPONENTS = ['agent:orchestrator', 'tool:issue_refund'];

/** One scenario, the runs that repeat it, and how much of the finding each of them touched. */
type Recorded = {
  readonly scenarioId: string | undefined;
  readonly runIds: readonly string[];
  readonly faultPlanId?: string;
  /**
   * How many of the finding's components each of these runs recorded executing.
   *
   * Zero means the scenario exists and no run of it ever touched what the finding is about, so it is
   * offered to whatever reads the scenario set and withheld from whatever asks the store what ran.
   */
  readonly exercised: number;
};

let nextRun = 0;
const identifiers = new Map<string, string>();
/** A real run identifier per fixture name, because `run_a1` is not one and the schema says so. */
const idFor = (name: string): string => {
  const known = identifiers.get(name);
  if (known !== undefined) return known;
  nextRun += 1;
  const minted = documents.runId(nextRun);
  identifiers.set(name, minted);
  return minted;
};

let nextResult = 0;

const workspaceHolding = (history: readonly Recorded[]) => {
  const runs: RecordedRun[] = [];
  const results = [];
  for (const entry of history) {
    for (const name of entry.runIds) {
      runs.push({
        run: documents.runRecord({
          id: idFor(name),
          kind: entry.scenarioId === undefined ? 'trace' : 'scenario',
          ...(entry.scenarioId === undefined ? {} : { scenarioId: entry.scenarioId }),
          ...(entry.faultPlanId === undefined ? {} : { faultPlanId: entry.faultPlanId }),
        }),
        componentIds: COMPONENTS.slice(0, entry.exercised),
      });
    }
    if (entry.scenarioId !== undefined) {
      nextResult += 1;
      results.push(
        documents.scenarioResult({
          id: documents.scenarioResultId(nextResult),
          scenarioId: entry.scenarioId,
          runIds: entry.runIds.map(idFor),
        }),
      );
    }
  }
  const double = storeDouble({
    projectId: PROJECT,
    findings: [documents.finding({ id: FINDING, components: COMPONENTS })],
    runs,
    scenarioResults: results,
  });
  return {
    double,
    scenarioOf: (runIdentifier: string): string | undefined =>
      history.find((entry) => entry.runIds.some((name) => idFor(name) === runIdentifier))
        ?.scenarioId,
    workspace: workspaceDouble({ projectId: PROJECT, root: '/nowhere', store: double.store }),
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
    const { workspace, double, scenarioOf } = workspaceHolding([
      {
        scenarioId: 'alpha',
        runIds: ['run_a1', 'run_a2', 'run_a3'],
        exercised: 2,
      },
      {
        scenarioId: 'beta',
        runIds: ['run_b1', 'run_b2', 'run_b3'],
        faultPlanId: 'fp_injected',
        exercised: 2,
      },
    ]);
    createGoalFromFinding({ workspace, findingId: FINDING });
    const goal = double.savedGoals[0] as Goal;
    const { compare, last } = planOf(goal);
    assert.ok(compare !== undefined, 'the plan prescribed no comparison');
    /*
     * Asked of the history rather than read off the identifier. The fixture used to name its runs
     * `run_a1` and `run_b1` and recover the scenario from the prefix, which is not a run identifier the
     * schema admits and is not a fact the store would ever hold.
     */
    const baselineScenario = scenarioOf(compare.command[2] as string);
    assert.equal(
      baselineScenario,
      last,
      `the plan compares a recording of ${String(baselineScenario)} against a rerun of ${String(last)}`,
    );
  });

  /* The conditions travel with the plan, so a reader is told what the comparison holds fixed. */
  it('states the conditions the baseline was recorded under', () => {
    const { workspace, double } = workspaceHolding([
      {
        scenarioId: 'beta',
        runIds: ['run_b1', 'run_b2', 'run_b3'],
        faultPlanId: 'fp_injected',
        exercised: 2,
      },
    ]);
    createGoalFromFinding({ workspace, findingId: FINDING });
    const goal = double.savedGoals[0] as Goal;
    assert.equal(goal.validation.baseline?.scenarioId, 'beta');
    assert.equal(goal.validation.baseline?.faultPlanId, 'fp_injected');
    assert.equal(goal.validation.baseline?.samples, 3);
  });

  /*
   * Selection is by what a run was recorded executing, and by nothing that reads like a name.
   *
   * Measured over the 56 pinned repositories, matching a scenario's tags against component identifiers is
   * wrong in a fifth of the matches it makes inside one repository. That rule is gone, so the fixture no
   * longer carries the tags that used to defeat it: nothing under test can read a tag, and a fixture
   * feeding a rule that does not exist proves nothing about the one that does. What discriminates here is
   * that one scenario's runs recorded executing the components and the other's recorded executing none,
   * and the names are kept because they say which scenario the removed rule would have chosen.
   */
  it('reruns the scenario recorded exercising the components, not the one whose tags read alike', () => {
    const { workspace, double } = workspaceHolding([
      {
        scenarioId: 'shares-every-tag',
        runIds: ['run_s1', 'run_s2', 'run_s3'],
        exercised: 0,
      },
      {
        scenarioId: 'exercises-it',
        runIds: ['run_e1', 'run_e2', 'run_e3'],
        exercised: 2,
      },
    ]);
    createGoalFromFinding({ workspace, findingId: FINDING });
    const goal = double.savedGoals[0] as Goal;
    assert.deepEqual(goal.validation.scenarioIds, ['exercises-it']);
  });

  /* A scenario covering more of what the finding is about is the better baseline, whatever ran last. */
  it('prefers the scenario recorded exercising more of what the finding names', () => {
    const { workspace, double } = workspaceHolding([
      { scenarioId: 'partial', runIds: ['run_p1', 'run_p2', 'run_p3'], exercised: 1 },
      { scenarioId: 'whole', runIds: ['run_w1', 'run_w2', 'run_w3'], exercised: 2 },
    ]);
    createGoalFromFinding({ workspace, findingId: FINDING });
    const goal = double.savedGoals[0] as Goal;
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
    const { workspace, double } = workspaceHolding([
      { scenarioId: 'once', runIds: ['run_o1'], exercised: 2 },
    ]);
    createGoalFromFinding({ workspace, findingId: FINDING });
    const goal = double.savedGoals[0] as Goal;
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
    const { workspace, double } = workspaceHolding([
      { scenarioId: undefined, runIds: ['run_t1'], exercised: 2 },
    ]);
    createGoalFromFinding({ workspace, findingId: FINDING });
    const goal = double.savedGoals[0] as Goal;
    assert.deepEqual(goal.validation.scenarioIds, []);
    assert.equal(
      goal.validation.commands.some((entry) => entry.command[1] === 'compare'),
      false,
      'the plan prescribed a comparison whose candidate nothing would produce',
    );
  });

  /* The reason is carried rather than left to be inferred from an empty array. */
  it('says why no comparison is prescribed when the exercising runs belong to no scenario', () => {
    const { workspace, double } = workspaceHolding([
      { scenarioId: undefined, runIds: ['run_t1'], exercised: 2 },
    ]);
    createGoalFromFinding({ workspace, findingId: FINDING });
    const goal = double.savedGoals[0] as Goal;
    assert.match(goal.validation.comparisonUnavailable ?? '', /belong to no scenario/);
  });
});
