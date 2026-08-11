import type { ReportBundle } from '@orchescope/schema';
import { comparisonPresentation } from './section-presentation/comparisons.ts';
import type { DepthSectionId, SectionPresentation } from './section-presentation/contract.ts';
import { findingsPresentation } from './section-presentation/findings.ts';
import { goalsPresentation } from './section-presentation/goals.ts';
import { mapPresentation } from './section-presentation/map.ts';
import { performancePresentation } from './section-presentation/performance.ts';
import { resiliencePresentation } from './section-presentation/resilience.ts';
import { scenariosPresentation } from './section-presentation/scenarios.ts';

export type { DepthSectionId, SectionPresentation } from './section-presentation/contract.ts';

export function buildSectionPresentations(
  bundle: ReportBundle,
): Readonly<Record<DepthSectionId, SectionPresentation>> {
  return {
    map: mapPresentation(bundle),
    findings: findingsPresentation(bundle),
    performance: performancePresentation(bundle),
    resilience: resiliencePresentation(bundle),
    scenarios: scenariosPresentation(bundle),
    comparisons: comparisonPresentation(bundle),
    goals: goalsPresentation(bundle),
  };
}
