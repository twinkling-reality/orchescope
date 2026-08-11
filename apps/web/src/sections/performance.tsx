import { buildSectionPresentations } from '../presentation/section-presentation.ts';
import { useApp } from '../store.tsx';
import { SectionSkeleton } from '../ui/section-skeleton.tsx';
import { BenchmarkEvidence } from './performance/benchmarks.tsx';
import { PerformanceEvidence } from './performance/evidence.tsx';
import { PerformanceBand, PerformancePrimary } from './performance/summary.tsx';

export function PerformanceSection() {
  const app = useApp();
  const measured = app.index.metricsByComponent.size;
  const presentation = buildSectionPresentations(app.bundle).performance;
  return (
    <SectionSkeleton
      section="performance"
      summary={<PerformanceBand measured={measured} refusal={presentation.summaryRefusal} />}
      primary={<PerformancePrimary refusal={presentation.primaryRefusal} />}
      detail={
        <div class="bento">
          <PerformanceEvidence />
          <BenchmarkEvidence />
        </div>
      }
    />
  );
}
