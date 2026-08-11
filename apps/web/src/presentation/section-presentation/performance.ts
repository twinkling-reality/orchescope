import type { ReportBundle } from '@orchescope/schema';
import { benchmarkCommand, importTraceCommand, traceCommand } from '../commands.ts';
import { presentationRefusal } from '../presentation-refusal.ts';
import type { SectionPresentation } from './contract.ts';

export function performancePresentation(bundle: ReportBundle): SectionPresentation {
  const firstScenario = bundle.scenarios[0]?.id ?? null;
  const untimed = bundle.runs.length === 0 && bundle.componentMetrics.length === 0;
  return {
    summary: { count: bundle.runs.length },
    summaryRefusal: untimed
      ? presentationRefusal(
          'Nothing has been run, so nothing was timed.',
          'How long something takes cannot be read out of source code. A recorded run supplies it.',
          [traceCommand(), importTraceCommand()],
        )
      : null,
    /*
     * The ranking slot refuses on its own condition rather than on the screen's. A report can carry
     * runs and still pin no time to any part, and then the band states a wall clock while this slot
     * has nothing to rank, which is a different absence and needs its own command. Where the band is
     * already refusing, the command is named there and not repeated here.
     */
    primaryRefusal:
      bundle.componentMetrics.length === 0
        ? presentationRefusal(
            'No part has any time against it.',
            'Time is measured per part from a recorded run, so an empty ranking is an absence of measurement rather than a system with no slow parts.',
            untimed ? [] : [traceCommand(), importTraceCommand()],
          )
        : null,
    detailRefusal:
      bundle.benchmarks.length === 0
        ? presentationRefusal(
            'Nothing has been run enough times to have a spread.',
            'This runs one scenario over and over, changing exactly one thing.',
            [benchmarkCommand(firstScenario)],
          )
        : null,
  };
}
