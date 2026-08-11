/**
 * The order scenarios are worked through in.
 *
 * A scenario that has never run is the one blocking the loop: nothing can be verified against it and
 * no comparison can name it as a baseline, so it comes first. Definition order comes second, because
 * a repository's own order is a decision somebody made and reordering by name would discard it.
 *
 * This selects and orders. It does not decide whether a scenario is worth running, which is a
 * judgement no rule here has the evidence to make.
 */

import type { Scenario, ScenarioRunSummary } from '@orchescope/schema';

export function orderScenariosForVerification(
  scenarios: readonly Scenario[],
  runs: readonly ScenarioRunSummary[],
): readonly Scenario[] {
  const hasRun = new Set(runs.map((run) => run.scenarioId));
  const position = new Map(scenarios.map((scenario, index) => [scenario.id, index] as const));
  return [...scenarios].sort((left, right) => {
    const byRun = Number(hasRun.has(left.id)) - Number(hasRun.has(right.id));
    if (byRun !== 0) {
      return byRun;
    }
    return (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0);
  });
}
