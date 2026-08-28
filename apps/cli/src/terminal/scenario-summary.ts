import { formatCount } from '@orchescope/domain';
import type { ScenarioResult } from '@orchescope/schema';
import { type Style, SYMBOLS } from './style.ts';

/**
 * What `orchescope test` reports.
 *
 * Every distribution states its sample size, and a quantile withheld for want of samples says so and says
 * how many it would need, because a number without its uncertainty is worse than no number.
 */
/** At most this many distinct failure shapes are named before the rest are counted. */
const MAX_FAILURE_NOTES = 3;

/** A reason is target output, so the terminal states enough to act on and not a wall of it. */
const MAX_REASON = 200;

/**
 * One line, because a reason carries a stderr excerpt and a stack trace pasted into an indented list
 * destroys the shape of the document around it.
 */
const oneLine = (value: string): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_REASON ? `${collapsed.slice(0, MAX_REASON - 1)}\u2026` : collapsed;
};

/**
 * Why the repetitions failed, in the document a person reads.
 *
 * A failed run reported `exit_code: passed in 0 of 3 repetitions that ran this evaluator` and stopped
 * there. The exit code and the reason were both recorded and both reachable only by running the whole
 * scenario again with `--json`, so the terminal said that something failed and declined to say what.
 *
 * Identical failures are counted rather than repeated, because three repetitions of one broken command
 * are one fact. The reason is target output and is redacted here, at the surface that emits it, which is
 * where this repository redacts everything else that leaves the process.
 */
const failureNotes = (
  result: ScenarioResult,
  redact: (value: string) => string,
): readonly string[] => {
  const shapes = new Map<string, number>();
  for (const repetition of result.repetitions) {
    if (repetition.status === 'completed' && repetition.failureReason === undefined) continue;
    const reason =
      repetition.failureReason === undefined
        ? repetition.exitCode === undefined
          ? ''
          : `, exit code ${repetition.exitCode}`
        : `: ${oneLine(redact(repetition.failureReason))}`;
    const shape = `${repetition.status}${reason}`;
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  const total = result.repetitions.length;
  const named = [...shapes.entries()];
  const shown = named
    .slice(0, MAX_FAILURE_NOTES)
    .map(([shape, count]) => `${count} of ${total} ${shape}`);
  return named.length > MAX_FAILURE_NOTES
    ? [...shown, `${named.length - MAX_FAILURE_NOTES} further failure shapes, see --json`]
    : shown;
};

export const scenarioSummary = (
  style: Style,
  result: ScenarioResult,
  redact: (value: string) => string = (value) => value,
): string => {
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
  for (const note of failureNotes(result, redact)) {
    lines.push(`  ${style.bad(SYMBOLS.failed)} ${note}`);
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
