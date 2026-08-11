import { formatCount } from '@orchescope/domain';
import type { ScenarioResult } from '@orchescope/schema';
import { type Style, SYMBOLS } from './style.ts';

/**
 * What `orchescope test` reports.
 *
 * Every distribution states its sample size, and a quantile withheld for want of samples says so and says
 * how many it would need, because a number without its uncertainty is worse than no number.
 */
export const scenarioSummary = (style: Style, result: ScenarioResult): string => {
  const lines: string[] = [];
  lines.push('');
  lines.push(
    `${result.passed ? style.good(SYMBOLS.done) : style.bad(SYMBOLS.failed)} ${style.bold(result.scenarioId)}: ${result.passed ? 'passed' : 'failed'} over ${formatCount(result.repetitions.length, 'repetition')}`,
  );
  const distribution = result.aggregate.durationMs;
  lines.push(
    `  duration: p50 ${distribution.p50 === undefined ? 'withheld' : `${Math.round(distribution.p50)}ms`}, min ${Math.round(distribution.min ?? 0)}ms, max ${Math.round(distribution.max ?? 0)}ms, ${formatCount(distribution.sampleSize, 'sample')}`,
  );
  for (const withheld of distribution.withheld) {
    lines.push(
      style.dim(
        `  ${withheld.quantile} withheld: it needs at least ${withheld.requiredSamples} samples`,
      ),
    );
  }
  lines.push(
    `  reliability: ${result.reliability.successes} of ${result.reliability.repetitions} succeeded${result.reliability.passPowerK
      .map((entry) => `, pass^${entry.k} ${entry.value.toFixed(2)}`)
      .join('')}`,
  );
  const failedEvaluators = result.aggregate.evaluators.filter(
    (evaluator) => !evaluator.passed && evaluator.skipped !== true,
  );
  for (const evaluator of failedEvaluators) {
    lines.push(`  ${style.bad(SYMBOLS.failed)} ${evaluator.kind}: ${evaluator.detail}`);
  }
  const skipped = result.aggregate.evaluators.filter((evaluator) => evaluator.skipped === true);
  for (const evaluator of skipped) {
    lines.push(
      style.dim(
        `  ${SYMBOLS.skipped} ${evaluator.kind} skipped: ${evaluator.skipReason ?? 'no reason given'}`,
      ),
    );
  }
  for (const limitation of result.limitations) {
    lines.push(style.dim(`  ${SYMBOLS.pending} ${limitation}`));
  }
  return lines.join('\n');
};
