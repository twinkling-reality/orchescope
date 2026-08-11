import type { ReportBundle } from '@orchescope/schema';
import { compareCommand } from '../commands.ts';
import { presentationRefusal } from '../presentation-refusal.ts';
import type { SectionPresentation } from './contract.ts';

export function comparisonPresentation(bundle: ReportBundle): SectionPresentation {
  const empty = bundle.comparisons.length === 0;
  return {
    summary: { count: bundle.comparisons.length },
    summaryRefusal: empty
      ? presentationRefusal(
          'Nothing has been compared with anything yet.',
          'Nothing here can be shown to have improved until runs from after a change are measured against runs from before it.',
          [compareCommand()],
        )
      : null,
    primaryRefusal: empty
      ? presentationRefusal(
          'No number has a before and an after.',
          'One row here is one measurement taken on both sides of a change.',
          [],
        )
      : null,
    detailRefusal: empty
      ? presentationRefusal(
          'There is nothing to look at side by side.',
          'The two sides carry which runs went into each, and what that sample size lets anyone say.',
          [],
        )
      : null,
  };
}
