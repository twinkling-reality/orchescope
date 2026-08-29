import type { ExercisingRun, ScanSummary, Store } from '@orchescope/persistence';
import { buildGraph } from '@orchescope/testkit';
import type {
  Comparison,
  Evidence,
  Finding,
  Goal,
  RunRecord,
  Scenario,
  ScenarioResult,
  SystemGraph,
} from '@orchescope/schema';
import { resolvePaths, type Workspace } from '@orchescope/workspace';

/**
 * A store and a workspace that hold what a test put in them, and refuse everything else.
 *
 * These tests are assertions about a rule rather than about SQL, so the store they run against is a double
 * rather than a database. What that used to cost is the whole reason this file exists. Each test wrote its
 * own object literal of lambdas and cast the workspace around it with `as never`, so nothing checked that
 * a taught method matched the method it stood in for, or that a document it returned was a document at
 * all: `runById` answered with a `RunRecord` missing two thirds of its fields, `listRuns` answered with
 * rows whose identifier column does not exist, and when three store methods gained a project identifier
 * the compiler said nothing at all. Four tests failed, none of them naming the cause.
 *
 * So the double is written once, against the real `Store`, and a test supplies documents rather than
 * behaviour. Three things follow. Every method here is checked against the store it stands in for, because
 * the object is `Partial<Store>` and not a cast. Every document a test hands over is a real one, because
 * the fields are typed and the schema requires what it requires. And the project filtering is in one place
 * rather than in each test's lambda, so the double answers a project-scoped question the way the database
 * does.
 *
 * **What that is worth, measured rather than assumed.** Adding a required field to `RunRecord` is a compile
 * error here and was silently swallowed before. Adding a leading project identifier to `spanCountForRun`,
 * which is the change that started this, is caught twice: the conversion of this object to `Store` stops
 * overlapping and the compiler says so, and the double then refuses a run identifier it never held with
 * `the store double holds no run prj_…`, which names the project arriving where a run was expected.
 *
 * The first of those two is a heuristic rather than a guarantee. A function of fewer parameters is
 * assignable to one of more, so a signature that grows a leading parameter of a type it already had can
 * still slip past an assignment; what caught this one is that the object as a whole stopped resembling the
 * store. The second is what does not depend on the compiler: the double answers only about documents a
 * test gave it, and says which one it was asked for.
 */

/** What a run recorded executing, which is the join a goal reads backwards to find its baseline. */
export type RecordedRun = {
  readonly run: RunRecord;
  /** Graph components this run was reconciled as having executed. */
  readonly componentIds: readonly string[];
  /** Spans the run exported. A run that exported none measured nothing, whatever its status says. */
  readonly spanCount?: number;
};

export type StoreContents = {
  readonly projectId: string;
  readonly scanId?: string;
  readonly graph?: SystemGraph;
  readonly findings?: readonly Finding[];
  readonly evidence?: readonly Evidence[];
  readonly goals?: readonly Goal[];
  readonly runs?: readonly RecordedRun[];
  readonly scenarios?: readonly { readonly scenario: Scenario; readonly sourcePath?: string }[];
  readonly scenarioResults?: readonly ScenarioResult[];
  readonly comparisons?: readonly Comparison[];
};

/** Goals the double was handed plus the ones the code under test saved, in the order they arrived. */
export type StoreDouble = {
  readonly store: Store;
  readonly savedGoals: readonly Goal[];
  readonly savedScenarios: readonly Scenario[];
};

/** A real graph with nothing in it, built the way every other fixture builds one, so it is not a cast. */
const EMPTY_GRAPH: SystemGraph = buildGraph([]);

/**
 * A method the double does not implement.
 *
 * Reached through a proxy rather than written out, because listing the rest of the store's surface would
 * be a second copy of it that nothing keeps in step. A method nobody implemented throws its own name,
 * which is the sentence the previous doubles could not produce: they answered `undefined` and failed
 * somewhere else, several frames later.
 */
const refusingTheRest = <T extends object>(implemented: T, label: string): T =>
  new Proxy(implemented, {
    get: (target, property, receiver) => {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      if (typeof property !== 'string') return undefined;
      return () => {
        throw new Error(
          `${label} does not implement ${property}, which the code under test called`,
        );
      };
    },
  });

export const storeDouble = (contents: StoreContents): StoreDouble => {
  const savedGoals: Goal[] = [...(contents.goals ?? [])];
  const savedScenarios: Scenario[] = [];
  const scenarios = new Map(
    (contents.scenarios ?? []).map((entry) => [entry.scenario.id, entry] as const),
  );
  const runs = new Map((contents.runs ?? []).map((entry) => [entry.run.id, entry] as const));
  const scanId = contents.scanId ?? 'scan_double';

  /**
   * The project filter, in one place.
   *
   * Every project-scoped read goes through it, so a question about another project is answered with
   * nothing rather than with this project's documents. That is the behaviour the database has and the
   * behaviour a per-test lambda kept forgetting.
   */
  const mine = (projectId: string): boolean => projectId === contents.projectId;

  const implemented = {
    latestScan: (projectId: string): ScanSummary | undefined =>
      mine(projectId)
        ? {
            scanId,
            graphId: `gph_${scanId}`,
            createdAt: '2026-08-01T00:00:00.000Z',
            componentCount: contents.graph?.components.length ?? 0,
            edgeCount: contents.graph?.edges.length ?? 0,
            gitCommit: undefined,
            gitRef: undefined,
            gitDirty: false,
            digest: `sha256:${scanId}`,
          }
        : undefined,
    graphForScan: (asked: string): SystemGraph => {
      if (asked !== scanId) throw new Error(`the store double holds no scan ${asked}`);
      return contents.graph ?? EMPTY_GRAPH;
    },
    findingById: (asked: string, findingId: string): Finding | undefined =>
      asked === scanId
        ? (contents.findings ?? []).find((finding) => finding.id === findingId)
        : undefined,
    evidenceByIds: (ids: readonly string[]): readonly Evidence[] =>
      (contents.evidence ?? []).filter((record) => ids.includes(record.id)),

    listGoals: (projectId: string): readonly Goal[] => (mine(projectId) ? savedGoals : []),
    nextGoalSequence: (projectId: string): number => (mine(projectId) ? savedGoals.length + 1 : 1),
    saveGoal: (goal: Goal, projectId: string): void => {
      if (!mine(projectId)) return;
      const at = savedGoals.findIndex((entry) => entry.id === goal.id);
      if (at < 0) savedGoals.push(goal);
      else savedGoals[at] = goal;
    },

    /* Absence is a real answer here, and `baselineFrom` reads it: a repetition may name a run nothing kept. */
    runById: (runId: string): RunRecord | undefined => runs.get(runId)?.run,
    /*
     * Asked only about runs the store handed out, so a run this double never held is a mistake in the
     * test rather than a measurement of zero. Answering a number would hide it, and hiding it is what a
     * leading parameter added to a store method does: the identifier shifts, the lookup misses, and a
     * plausible default carries the test past the point where it went wrong.
     */
    spanCountForRun: (runId: string): number => {
      const recorded = runs.get(runId);
      if (recorded === undefined) throw new Error(`the store double holds no run ${runId}`);
      return recorded.spanCount ?? 1;
    },
    /*
     * The declared against exercised join asked backwards, counted from what each run recorded rather
     * than from a number a test supplies, so a fixture cannot claim coverage it did not record.
     */
    runsExercising: (input: {
      readonly projectId: string;
      readonly componentIds: readonly string[];
      readonly limit?: number;
    }): readonly ExercisingRun[] => {
      if (!mine(input.projectId)) return [];
      return [...runs.values()]
        .filter((entry) => entry.run.status === 'completed')
        .map((entry) => ({
          runId: entry.run.id,
          kind: entry.run.kind,
          label: entry.run.label,
          status: entry.run.status,
          startedAt: entry.run.startedAt,
          scenarioId: entry.run.scenarioId,
          variantId: entry.run.variantId,
          faultPlanId: entry.run.faultPlanId,
          experimentId: entry.run.experimentId,
          exercisedComponents: entry.componentIds.filter((id) => input.componentIds.includes(id))
            .length,
        }))
        .filter((run) => run.exercisedComponents > 0)
        .slice(0, input.limit ?? 100);
    },

    listScenarios: (projectId: string): readonly Scenario[] =>
      mine(projectId) ? [...scenarios.values()].map((entry) => entry.scenario) : [],
    scenarioById: (projectId: string, scenarioId: string): Scenario | undefined =>
      mine(projectId) ? scenarios.get(scenarioId)?.scenario : undefined,
    scenarioSourceById: (projectId: string, scenarioId: string): string | undefined =>
      mine(projectId) ? scenarios.get(scenarioId)?.sourcePath : undefined,
    saveScenario: (scenario: Scenario, projectId: string, sourcePath?: string): void => {
      if (!mine(projectId)) return;
      savedScenarios.push(scenario);
      scenarios.set(scenario.id, {
        scenario,
        ...(sourcePath === undefined ? {} : { sourcePath }),
      });
    },
    scenarioResults: (
      projectId: string,
      scenarioId: string,
      limit = 20,
    ): readonly ScenarioResult[] =>
      mine(projectId)
        ? (contents.scenarioResults ?? [])
            .filter((result) => result.scenarioId === scenarioId)
            .slice(0, limit)
        : [],

    latestComparisonForGoal: (goalId: string, notBefore: string): Comparison | undefined =>
      (contents.comparisons ?? []).find(
        (comparison) => comparison.goalId === goalId && comparison.createdAt >= notBefore,
      ),
  } satisfies Partial<Store>;

  return {
    store: refusingTheRest(implemented, 'the store double') as Store,
    get savedGoals() {
      return savedGoals;
    },
    get savedScenarios() {
      return savedScenarios;
    },
  };
};

/**
 * A workspace around a store, carrying the parts a use case reads and nothing running behind them.
 *
 * Anything not given here throws the name of the field rather than answering `undefined`, so a use case
 * that starts reading configuration or the git facts says which one it wanted.
 */
export const workspaceDouble = (input: {
  readonly projectId: string;
  readonly root: string;
  readonly store: Store;
  readonly now?: string;
}): Workspace => {
  const now = input.now ?? '2026-08-02T00:00:00.000Z';
  /*
   * `Partial<Workspace>` rather than an inferred literal, so the parts that are here are the real ones:
   * `paths` used to be `{ root }` alone, and a use case reading any other path off it got `undefined`
   * with nothing to say about it. The paths are resolved the way the product resolves them.
   */
  const given: Partial<Workspace> = {
    projectId: input.projectId,
    paths: resolvePaths(input.root),
    store: input.store,
    clock: { now: () => now, monotonicMs: () => 0 },
  };
  return new Proxy(given, {
    get: (target, property, receiver) => {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      throw new Error(
        `the workspace double was not given ${String(property)}, which the code under test reads`,
      );
    },
  }) as unknown as Workspace;
};
