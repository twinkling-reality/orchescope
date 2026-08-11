import type { ReportBundle } from '@orchescope/schema';
import { goalCommand } from '../commands.ts';
import { presentationRefusal } from '../presentation-refusal.ts';
import type { SectionPresentation } from './contract.ts';

export function goalsPresentation(bundle: ReportBundle): SectionPresentation {
  const empty = bundle.goals.length === 0;
  const eligibleFinding =
    bundle.findings.find(
      (finding) => finding.polarity === 'risk' && finding.goalReadiness.eligible,
    ) ?? null;
  const commands = [goalCommand(eligibleFinding?.id ?? null)];
  return {
    summary: { count: bundle.goals.length },
    summaryRefusal: empty
      ? presentationRefusal(
          'Nothing has been turned into work somebody can pick up.',
          'A job written up here says which files may be touched, what it must not do, what has to be true at the end, and the command that decides it.',
          commands,
        )
      : null,
    primaryRefusal: empty
      ? presentationRefusal('There is no job to list.', 'One row here is one job.', [])
      : null,
    detailRefusal: empty
      ? presentationRefusal(
          'There is nothing to hand over and nothing to check.',
          'A job carries what has to be true at the end, and the command that decides whether it is.',
          [],
        )
      : null,
  };
}
