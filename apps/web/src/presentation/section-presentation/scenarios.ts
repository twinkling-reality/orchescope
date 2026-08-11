import type { ReportBundle } from '@orchescope/schema';
import { scenarioRunCommand } from '../commands.ts';
import { presentationRefusal } from '../presentation-refusal.ts';
import type { SectionPresentation } from './contract.ts';

export function scenariosPresentation(bundle: ReportBundle): SectionPresentation {
  const firstScenario = bundle.scenarios[0]?.id ?? null;
  const noScenarios = bundle.scenarios.length === 0;
  return {
    summary: { count: bundle.scenarios.length },
    summaryRefusal: noScenarios
      ? presentationRefusal(
          'Nothing here can be run again the same way.',
          'Without a run you can repeat, there is no way to check a change by doing the same thing twice.',
          [scenarioRunCommand(null)],
        )
      : null,
    primaryRefusal: noScenarios
      ? presentationRefusal(
          'No scenario is written down.',
          'One row here is one repeatable way of driving the system.',
          [],
        )
      : null,
    /*
     * This slot is about runs rather than about definitions, so it fires on a different condition
     * from the two above and keeps its own command when there is a scenario to name. A report can
     * carry three scenarios and no run of any of them, which is `demonstration-system`, and there
     * the band is silent while this slot is not.
     */
    detailRefusal:
      bundle.scenarioRuns.length === 0
        ? presentationRefusal(
            'No scenario here has ever been run.',
            'Until one runs, its checks have decided nothing about this system.',
            noScenarios ? [] : [scenarioRunCommand(firstScenario)],
          )
        : null,
  };
}
