import type { ReportBundle } from '@orchescope/schema';
import { chaosCommand } from '../commands.ts';
import { presentationRefusal } from '../presentation-refusal.ts';
import type { SectionPresentation } from './contract.ts';

export function resiliencePresentation(bundle: ReportBundle): SectionPresentation {
  const empty = bundle.chaosReports.length === 0;
  const commands = [chaosCommand(bundle.scenarios[0]?.id ?? null)];
  return {
    summary: { count: bundle.chaosReports.length },
    summaryRefusal: empty
      ? presentationRefusal(
          'Nothing has been broken on purpose yet.',
          'How a system copes is measured by watching it while something is deliberately broken. It cannot be read out of source code.',
          commands,
        )
      : null,
    primaryRefusal: empty
      ? presentationRefusal(
          'No fault was injected, so no outcome was recorded.',
          'An outcome says what one broken thing did to one run.',
          [],
        )
      : null,
    /*
     * The detail slot holds the faults that were asked for and never broken, and on a report with no
     * chaos run that number is zero for a reason the old wording got backwards. It said nothing had
     * been run; what is true of this slot is that nothing was ever requested, so there was nothing
     * to skip. A suite that quietly skipped half its plan and reported success is worse than no
     * suite, which is why this record stays visible rather than folding into a count.
     */
    detailRefusal: empty
      ? presentationRefusal(
          'Nothing was asked for, so nothing could be skipped.',
          'Once faults are requested, any that could not be applied are listed here with the reason.',
          [],
        )
      : null,
  };
}
