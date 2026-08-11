import type { ReportBundle } from '@orchescope/schema';
import { auditCommand, manifestCommand } from '../commands.ts';
import { presentationRefusal } from '../presentation-refusal.ts';
import type { SectionPresentation } from './contract.ts';

export function mapPresentation(bundle: ReportBundle): SectionPresentation {
  const empty = bundle.graph.components.length === 0;
  return {
    summary: { count: bundle.graph.components.length },
    summaryRefusal: empty
      ? presentationRefusal(
          'This report found no parts of a system, so there is nothing to draw.',
          'The scan came back empty. A manifest is how a system this build cannot read from source gets in.',
          [manifestCommand(), auditCommand()],
        )
      : null,
    primaryRefusal: empty
      ? presentationRefusal(
          'There is nothing to put on the map or in the table beside it.',
          'The drawing and the table carry the same parts, so both are empty together.',
          [],
        )
      : null,
    detailRefusal: empty
      ? presentationRefusal(
          'There is nothing to look at in detail.',
          'This fills up once at least one part of a system is found, either in the code or in a run.',
          [],
        )
      : null,
  };
}
