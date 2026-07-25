import type { ProcessOutcome, TraceSessionResult } from '@orchescope/runtime';
import {
  compileChecker,
  type EvaluatorResult,
  FaultKind,
  type RepetitionResult,
  type ResultSource,
  type RunMetrics,
  type Scenario,
  type ScenarioBudgets,
  type SideEffectRecord,
  type TargetResult,
  type TraceBundle,
} from '@orchescope/schema';
import { ORCHESCOPE, readString, type TopologyResult } from '@orchescope/traces';
import {
  countMatching,
  describeExpectation,
  type ReportedEffect,
  tallyEffects,
} from './effects.ts';
import { evaluate } from './evaluate.ts';

/**
 * One repetition of a scenario, turned into a result.
 *
 * Two decisions here are worth stating. Duration is the wall clock the supervisor measured around the
 * process, not the root span duration, because a target with no tracing still has a duration and a run whose
 * timing depends on whether the target happened to emit spans is not comparable. Counters that both the
 * trace and the result file can report are merged with a maximum rather than a sum, so a target that
 * instruments an event and also reports it is not punished for being thorough.
 */

const MAX_OUTPUT_EXCERPT = 4000;
const MAX_FAILURE_REASON = 1000;
const MAX_STDERR_EXCERPT = 300;

const isFaultKind = compileChecker(FaultKind);

const truncate = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit - 3)}...` : text;

/** Spans whose parent is absent from the bundle are roots: the parent was never exported. */
const rootSpanOf = (bundle: TraceBundle) => {
  const known = new Set(bundle.spans.map((span) => span.spanId));
  return bundle.spans.find(
    (span) => span.parentSpanId === undefined || !known.has(span.parentSpanId),
  );
};

/**
 * Task outcome, read from the mechanism the scenario declared. The declared source wins, and the other
 * mechanism is used as a fallback so that a target which reports both is never contradicted by a missing
 * file or a lost span.
 */
export const resolveTaskSuccess = (
  source: ResultSource,
  session: TraceSessionResult,
  runMetrics: RunMetrics,
): boolean | undefined => {
  const fromFile = session.targetResult?.success;
  const fromSpan = runMetrics.taskSuccess;
  if (source === 'exit_code') {
    return session.process.exitCode === undefined ? undefined : session.process.exitCode === 0;
  }
  if (source === 'root_span') return fromSpan ?? fromFile;
  return fromFile ?? fromSpan;
};

export const resolveOutput = (session: TraceSessionResult): string | undefined => {
  if (session.targetResult?.output !== undefined) return session.targetResult.output;
  const root = rootSpanOf(session.bundle);
  return root === undefined ? undefined : readString(root.attributes, ORCHESCOPE.taskOutput);
};

/**
 * Faults the target reported applying, read from the `orchescope.fault.injected` attribute. An unknown value
 * is ignored rather than trusted: the attribute comes from a process Orchescope does not control.
 */
export const faultsApplied = (bundle: TraceBundle): RepetitionResult['faultsApplied'] => {
  const counts = new Map<string, { kind: FaultKind; target: string; appliedCount: number }>();
  for (const span of bundle.spans) {
    const checked = isFaultKind(span.attributes[ORCHESCOPE.faultInjected]);
    if (!checked.ok) continue;
    const target = readString(span.attributes, ORCHESCOPE.component) ?? span.name;
    const key = `${checked.value}|${target}`;
    const existing = counts.get(key);
    counts.set(
      key,
      existing === undefined
        ? { kind: checked.value, target, appliedCount: 1 }
        : { ...existing, appliedCount: existing.appliedCount + 1 },
    );
  }
  return [...counts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([, value]) => value);
};

export const prohibitedEffectKinds = (
  scenario: Scenario,
  spanEffects: readonly SideEffectRecord[],
  reportedEffects: readonly ReportedEffect[],
): readonly string[] => {
  const kinds = new Set<string>();
  for (const expectation of scenario.expect?.prohibitedEffects ?? []) {
    const count = countMatching(expectation, spanEffects, reportedEffects);
    if (count > (expectation.maxCount ?? 0)) kinds.add(expectation.kind);
  }
  return [...kinds].sort();
};

type MetricsInput = {
  readonly runMetrics: RunMetrics;
  readonly outcome: ProcessOutcome;
  readonly targetResult: TargetResult | undefined;
  readonly taskSuccess: boolean | undefined;
  readonly effectTotal: number;
  readonly duplicateCount: number;
  readonly prohibitedCount: number;
};

export const repetitionMetrics = (input: MetricsInput): RunMetrics => ({
  ...input.runMetrics,
  durationMs: input.outcome.durationMs,
  ...(input.taskSuccess === undefined ? {} : { taskSuccess: input.taskSuccess }),
  duplicateSideEffects: input.duplicateCount,
  prohibitedSideEffects: input.prohibitedCount,
  sideEffects: input.effectTotal,
  userInterventions: Math.max(
    input.runMetrics.userInterventions,
    input.targetResult?.userInterventions ?? 0,
  ),
  policyViolations: Math.max(
    input.runMetrics.policyViolations,
    input.targetResult?.policyViolations ?? 0,
  ),
  loopIterations: Math.max(
    input.runMetrics.loopIterations,
    input.targetResult?.loopIterations ?? 0,
  ),
});

const lowerOf = (left: number | undefined, right: number | undefined): number | undefined => {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
};

/**
 * Budget enforcement for one repetition.
 *
 * A cost ceiling is only enforceable against a cost the target reported. When cost is unknown the ceiling is
 * not applied, because assuming zero would silently turn an unmeasured run into a run within budget. The
 * omission is reported as a limitation on the result instead.
 */
export const budgetBreach = (
  budgets: ScenarioBudgets,
  metrics: RunMetrics,
  costCeilingUsd: number | undefined,
): string | undefined => {
  const tokens = metrics.inputTokens + metrics.outputTokens;
  if (budgets.maxDurationMs !== undefined && metrics.durationMs > budgets.maxDurationMs) {
    return `duration of ${Math.round(metrics.durationMs)} ms exceeded the ${budgets.maxDurationMs} ms budget`;
  }
  if (budgets.maxTokens !== undefined && tokens > budgets.maxTokens) {
    return `${tokens} tokens exceeded the ${budgets.maxTokens} token budget`;
  }
  if (budgets.maxModelCalls !== undefined && metrics.modelCalls > budgets.maxModelCalls) {
    return `${metrics.modelCalls} model calls exceeded the ${budgets.maxModelCalls} call budget`;
  }
  if (budgets.maxRetries !== undefined && metrics.retries > budgets.maxRetries) {
    return `${metrics.retries} retries exceeded the ${budgets.maxRetries} retry budget`;
  }
  const ceiling = lowerOf(budgets.maxCostUsd, costCeilingUsd);
  if (ceiling !== undefined && metrics.costUsd !== undefined && metrics.costUsd > ceiling) {
    return `reported cost of ${metrics.costUsd} USD exceeded the ${ceiling} USD ceiling`;
  }
  return undefined;
};

export const repetitionStatus = (
  outcome: ProcessOutcome,
  breach: string | undefined,
): RepetitionResult['status'] => {
  if (outcome.timedOut) return 'timeout';
  if (outcome.cancelled) return 'cancelled';
  if (breach !== undefined) return 'budget_exceeded';
  if (outcome.exitCode !== 0) return 'failed';
  return 'completed';
};

type FailureInput = {
  readonly status: RepetitionResult['status'];
  readonly outcome: ProcessOutcome;
  readonly breach: string | undefined;
  readonly problem: string | undefined;
  readonly timeoutMs: number;
};

const exitFailure = (outcome: ProcessOutcome): string => {
  const cause =
    outcome.exitCode === undefined
      ? `the target was terminated by signal ${outcome.signal ?? 'unknown'}`
      : `the target exited with code ${outcome.exitCode}`;
  const stderr = outcome.stderr.trim();
  return stderr.length === 0 ? cause : `${cause}: ${truncate(stderr, MAX_STDERR_EXCERPT)}`;
};

const describeFailure = (input: FailureInput): string | undefined => {
  if (input.breach !== undefined) return input.breach;
  if (input.status === 'timeout') {
    return `the target did not finish within its ${input.timeoutMs} ms timeout`;
  }
  if (input.status === 'cancelled') return 'the run was cancelled before the target finished';
  if (input.status === 'failed') return exitFailure(input.outcome);
  return input.problem === undefined
    ? undefined
    : `the target result file was rejected: ${input.problem}`;
};

export const failureReason = (input: FailureInput): string | undefined => {
  const detail = describeFailure(input);
  return detail === undefined ? undefined : truncate(detail, MAX_FAILURE_REASON);
};

const expectationVerdict = (kind: string, passed: boolean, detail: string): EvaluatorResult => ({
  kind,
  passed,
  detail: truncate(detail, MAX_FAILURE_REASON),
});

const taskSuccessResult = (expected: boolean, actual: boolean | undefined): EvaluatorResult => {
  if (actual === undefined) {
    return {
      kind: 'expect_task_success',
      passed: false,
      detail: `the target did not report a task outcome, ${expected} expected`,
      skipped: true,
      skipReason: 'the target reported no task outcome',
    };
  }
  return expectationVerdict(
    'expect_task_success',
    actual === expected,
    `the target reported task success ${actual}, ${expected} expected`,
  );
};

/**
 * `scenario.expect` is checked as evaluators rather than as a separate verdict, so a scenario that declares
 * an expectation and no evaluators still decides whether the run passed, and every expectation appears in
 * the report next to the evaluators it belongs with.
 */
export const expectationResults = (
  scenario: Scenario,
  input: {
    readonly taskSuccess: boolean | undefined;
    readonly spanEffects: readonly SideEffectRecord[];
    readonly reportedEffects: readonly ReportedEffect[];
  },
): readonly EvaluatorResult[] => {
  const expect = scenario.expect;
  if (expect === undefined) return [];
  const results: EvaluatorResult[] = [];
  if (expect.taskSuccess !== undefined) {
    results.push(taskSuccessResult(expect.taskSuccess, input.taskSuccess));
  }
  for (const expectation of expect.requiredEffects ?? []) {
    const count = countMatching(expectation, input.spanEffects, input.reportedEffects);
    const minCount = expectation.minCount ?? 1;
    const withinMax = expectation.maxCount === undefined || count <= expectation.maxCount;
    results.push(
      expectationVerdict(
        'expect_required_effect',
        count >= minCount && withinMax,
        `${describeExpectation(expectation)} was recorded ${count} times, at least ${minCount} expected`,
      ),
    );
  }
  for (const expectation of expect.prohibitedEffects ?? []) {
    const count = countMatching(expectation, input.spanEffects, input.reportedEffects);
    const allowed = expectation.maxCount ?? 0;
    results.push(
      expectationVerdict(
        'expect_prohibited_effect',
        count <= allowed,
        `${describeExpectation(expectation)} was recorded ${count} times, at most ${allowed} allowed`,
      ),
    );
  }
  return results;
};

export type RepetitionContext = {
  readonly scenario: Scenario;
  readonly runId: string;
  readonly index: number;
  readonly session: TraceSessionResult;
  readonly topology: TopologyResult;
  readonly costCeilingUsd: number | undefined;
  readonly timeoutMs: number;
};

export const buildRepetition = (context: RepetitionContext): RepetitionResult => {
  const { scenario, session } = context;
  const spanEffects = session.bundle.sideEffects;
  const reportedEffects = session.targetResult?.effects ?? [];
  const tally = tallyEffects(spanEffects, reportedEffects);
  const prohibited = prohibitedEffectKinds(scenario, spanEffects, reportedEffects);
  const taskSuccess = resolveTaskSuccess(
    scenario.target.resultSource,
    session,
    context.topology.runMetrics,
  );
  const output = resolveOutput(session);
  const metrics = repetitionMetrics({
    runMetrics: context.topology.runMetrics,
    outcome: session.process,
    targetResult: session.targetResult,
    taskSuccess,
    effectTotal: tally.total,
    duplicateCount: tally.extraOccurrences,
    prohibitedCount: prohibited.length,
  });
  const breach = budgetBreach(scenario.budgets, metrics, context.costCeilingUsd);
  const status = repetitionStatus(session.process, breach);
  const evaluators = [
    ...evaluate({
      evaluators: scenario.evaluators,
      output,
      resultMetadata: session.targetResult?.metadata,
      sideEffects: spanEffects,
      reportedEffects,
      duplicateSideEffectKeys: tally.duplicateKeys,
      spans: session.bundle.spans,
      metrics,
      exitCode: session.process.exitCode,
    }),
    ...expectationResults(scenario, { taskSuccess, spanEffects, reportedEffects }),
  ];
  const reason = failureReason({
    status,
    outcome: session.process,
    breach,
    problem: session.targetResultProblem,
    timeoutMs: context.timeoutMs,
  });
  return {
    runId: context.runId,
    repetition: context.index,
    status,
    ...(taskSuccess === undefined ? {} : { taskSuccess }),
    metrics,
    evaluators,
    sideEffects: [...spanEffects],
    duplicateSideEffectKeys: [...tally.duplicateKeys],
    prohibitedSideEffectKinds: [...prohibited],
    faultsApplied: faultsApplied(session.bundle),
    ...(session.process.exitCode === undefined ? {} : { exitCode: session.process.exitCode }),
    ...(reason === undefined ? {} : { failureReason: reason }),
    ...(output === undefined ? {} : { outputExcerpt: truncate(output, MAX_OUTPUT_EXCERPT) }),
  };
};
