import type { ReportBundle } from '@orchescope/schema';
import { auditCommand, importTraceCommand, traceCommand } from '../commands.ts';
import { presentationRefusal } from '../presentation-refusal.ts';
import type { SectionPresentation } from './contract.ts';

export function findingsPresentation(bundle: ReportBundle): SectionPresentation {
  const risks = bundle.findings.some((finding) => finding.polarity === 'risk');
  const strengths = bundle.findings.some((finding) => finding.polarity === 'strength');
  return {
    summary: { count: bundle.findings.length },
    summaryRefusal: risks
      ? null
      : presentationRefusal(
          'Nothing was reported as a problem.',
          'No rule had enough evidence to fire. That is not a promise that your system is fine.',
          bundle.summary.runCount === 0
            ? [traceCommand(), importTraceCommand(), auditCommand()]
            : [auditCommand()],
        ),
    primaryRefusal: risks
      ? null
      : presentationRefusal(
          'There is no problem to rank.',
          'One row here is one thing worth fixing, worst first.',
          [],
        ),
    detailRefusal: strengths
      ? null
      : presentationRefusal(
          'Nothing was reported as done well either.',
          'Saying something is done well takes the same evidence a problem does, and no rule found enough of it.',
          [],
        ),
  };
}
