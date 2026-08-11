/**
 * Overview is one answer and three tiles that do not repeat it.
 *
 * The answer is the worst thing found and the one command that starts fixing it. The tiles below ask
 * three different questions: what else is there, how much of this has actually run, and how much of it
 * could we read. None of them names the finding the answer already named.
 */

import { buildOverviewPresentation } from '../presentation/overview-presentation.ts';
import { useApp } from '../store.tsx';
import { OverviewSkeleton } from '../ui/section-skeleton.tsx';
import { OverviewContext } from './overview/context.tsx';
import { OverviewHeadline } from './overview/headline.tsx';
import { OverviewProblems } from './overview/problems.tsx';
import { OverviewRan } from './overview/ran.tsx';

export function OverviewSection() {
  const presentation = buildOverviewPresentation(useApp().bundle);
  return (
    <OverviewSkeleton
      headline={
        <OverviewHeadline
          presentation={presentation.headline}
          preamble={presentation.preamble.sentence}
        />
      }
      problems={<OverviewProblems mixes={presentation.headline.mixes} />}
      ran={<OverviewRan presentation={presentation.delta} />}
      scan={<OverviewContext presentation={presentation.context} />}
    />
  );
}
