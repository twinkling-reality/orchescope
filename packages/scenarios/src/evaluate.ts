import type {
  Evaluator,
  EvaluatorResult,
  MetadataValue,
  NormalizedSpan,
  RunMetrics,
  SideEffectRecord,
} from '@orchescope/schema';
import { observedNameFor } from '@orchescope/traces';
import { countMatching, describeExpectation, type ReportedEffect } from './effects.ts';
import { resolvePointer } from './json-pointer.ts';

/**
 * Deterministic evaluation.
 *
 * Every evaluator here decides from evidence already collected, with no model call and no network access,
 * so the same repetition always produces the same verdict. The single model based evaluator is skipped
 * rather than guessed at: `evaluate` is synchronous by design, so a judged question is reported as skipped
 * with the reason, and the caller that has model access applies it separately.
 *
 * A skipped result carries `passed: false` and must always be read together with `skipped`. Everything in
 * Orchescope that aggregates evaluator results checks `skipped` first, so a skipped evaluator never counts
 * as a failure and never counts as a pass.
 *
 * `caseSensitive` defaults to false on the text evaluators: an expectation about the content of an answer
 * should not fail because a model capitalised a word differently. An author who means an exact match sets
 * the flag.
 */

const MAX_DETAIL = 1000;

const JUDGE_UNAVAILABLE =
  'analysis in this build is deterministic, so a judged question is recorded and never answered';

type OfKind<K extends Evaluator['kind']> = Extract<Evaluator, { kind: K }>;

export type EvaluationInput = {
  readonly evaluators: readonly Evaluator[];
  /** Output the target reported, used by the text evaluators and by a judge. */
  readonly output: string | undefined;
  /** Document JSON pointers resolve against first: the metadata of the target result file. */
  readonly resultMetadata: Readonly<Record<string, MetadataValue>> | undefined;
  /** Side effects observed as span events. */
  readonly sideEffects: readonly SideEffectRecord[];
  /** Side effects the target listed in its result file. */
  readonly reportedEffects: readonly ReportedEffect[];
  readonly duplicateSideEffectKeys: readonly string[];
  readonly spans: readonly NormalizedSpan[];
  readonly metrics: RunMetrics;
  readonly exitCode: number | undefined;
};

const bounded = (text: string): string =>
  text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 3)}...` : text;

const verdict = (kind: string, passed: boolean, detail: string): EvaluatorResult => ({
  kind,
  passed,
  detail: bounded(detail),
});

const skip = (kind: string, detail: string, skipReason: string): EvaluatorResult => ({
  kind,
  passed: false,
  detail: bounded(detail),
  skipped: true,
  skipReason,
});

const normalizeCase = (value: string, caseSensitive: boolean | undefined): string =>
  caseSensitive === true ? value : value.toLowerCase();

const containsAll = (
  evaluator: OfKind<'output_contains_all'>,
  output: string | undefined,
): EvaluatorResult => {
  if (output === undefined) {
    return verdict(evaluator.kind, false, 'the target reported no output to match against');
  }
  const haystack = normalizeCase(output, evaluator.caseSensitive);
  const missing = evaluator.values.filter(
    (value) => !haystack.includes(normalizeCase(value, evaluator.caseSensitive)),
  );
  return missing.length === 0
    ? verdict(
        evaluator.kind,
        true,
        `output contains all ${evaluator.values.length} required values`,
      )
    : verdict(evaluator.kind, false, `output is missing: ${missing.join(', ')}`);
};

const containsNone = (
  evaluator: OfKind<'output_contains_none'>,
  output: string | undefined,
): EvaluatorResult => {
  if (output === undefined) {
    return verdict(
      evaluator.kind,
      true,
      'the target reported no output, so no forbidden value appears',
    );
  }
  const haystack = normalizeCase(output, evaluator.caseSensitive);
  const present = evaluator.values.filter((value) =>
    haystack.includes(normalizeCase(value, evaluator.caseSensitive)),
  );
  return present.length === 0
    ? verdict(
        evaluator.kind,
        true,
        `output contains none of the ${evaluator.values.length} forbidden values`,
      )
    : verdict(evaluator.kind, false, `output contains forbidden values: ${present.join(', ')}`);
};

const describeValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'object') return Array.isArray(value) ? `array(${value.length})` : 'object';
  return JSON.stringify(value) ?? String(value);
};

const pointerEquals = (
  evaluator: OfKind<'json_pointer_equals'>,
  input: EvaluationInput,
  parsedOutput: unknown,
): EvaluatorResult => {
  const fromMetadata = resolvePointer(input.resultMetadata, evaluator.pointer);
  const resolution = fromMetadata.found
    ? fromMetadata
    : resolvePointer(parsedOutput, evaluator.pointer);
  const source = fromMetadata.found ? 'the target result metadata' : 'the parsed target output';
  if (!resolution.found) {
    return verdict(
      evaluator.kind,
      false,
      `pointer ${evaluator.pointer} does not resolve in the target result metadata or in the parsed output`,
    );
  }
  return resolution.value === evaluator.value
    ? verdict(
        evaluator.kind,
        true,
        `pointer ${evaluator.pointer} equals ${describeValue(evaluator.value)} in ${source}`,
      )
    : verdict(
        evaluator.kind,
        false,
        `pointer ${evaluator.pointer} resolved to ${describeValue(resolution.value)} in ${source}, expected ${describeValue(evaluator.value)}`,
      );
};

const effectRecorded = (
  evaluator: OfKind<'effect_recorded'>,
  input: EvaluationInput,
): EvaluatorResult => {
  const expectation = evaluator.effect;
  const count = countMatching(expectation, input.sideEffects, input.reportedEffects);
  const minCount = expectation.minCount ?? 1;
  const description = describeExpectation(expectation);
  if (count < minCount) {
    return verdict(
      evaluator.kind,
      false,
      `${description} was recorded ${count} times, at least ${minCount} expected`,
    );
  }
  if (expectation.maxCount !== undefined && count > expectation.maxCount) {
    return verdict(
      evaluator.kind,
      false,
      `${description} was recorded ${count} times, at most ${expectation.maxCount} expected`,
    );
  }
  return verdict(evaluator.kind, true, `${description} was recorded ${count} times`);
};

const noDuplicateEffects = (
  evaluator: OfKind<'no_duplicate_effects'>,
  duplicateKeys: readonly string[],
): EvaluatorResult =>
  duplicateKeys.length === 0
    ? verdict(evaluator.kind, true, 'no side effect was recorded more than once')
    : verdict(
        evaluator.kind,
        false,
        `${duplicateKeys.length} side effect key(s) were recorded more than once: ${duplicateKeys.join(', ')}`,
      );

const spanObserved = (
  evaluator: OfKind<'span_observed'>,
  spans: readonly NormalizedSpan[],
): EvaluatorResult => {
  const matches = spans.filter(
    (span) =>
      span.operation === evaluator.operation &&
      (evaluator.componentName === undefined ||
        observedNameFor(span.operation, span.name, span.attributes) === evaluator.componentName),
  );
  const required = evaluator.minCount ?? 1;
  const where =
    evaluator.componentName === undefined
      ? `operation ${evaluator.operation}`
      : `operation ${evaluator.operation} on ${evaluator.componentName}`;
  return matches.length >= required
    ? verdict(evaluator.kind, true, `${where} was observed ${matches.length} times`)
    : verdict(
        evaluator.kind,
        false,
        `${where} was observed ${matches.length} times, at least ${required} expected`,
      );
};

/** Metric lookup by name over the run metrics. A metric that was not measured is absent, not zero. */
const metricValue = (metrics: RunMetrics, name: string): number | undefined => {
  const entry = Object.entries(metrics).find(([key]) => key === name);
  const value = entry?.[1];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const COMPARATORS: Readonly<
  Record<OfKind<'metric_threshold'>['comparator'], (left: number, right: number) => boolean>
> = {
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right,
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
  eq: (left, right) => left === right,
};

const metricThreshold = (
  evaluator: OfKind<'metric_threshold'>,
  metrics: RunMetrics,
): EvaluatorResult => {
  const measured = metricValue(metrics, evaluator.metric);
  if (measured === undefined) {
    return skip(
      evaluator.kind,
      `metric ${evaluator.metric} was not measured in this run`,
      `metric ${evaluator.metric} was not measured`,
    );
  }
  const passed = COMPARATORS[evaluator.comparator](measured, evaluator.value);
  return verdict(
    evaluator.kind,
    passed,
    `${evaluator.metric} was ${measured}, expected ${evaluator.comparator} ${evaluator.value}`,
  );
};

const exitCodeEquals = (
  evaluator: OfKind<'exit_code'>,
  exitCode: number | undefined,
): EvaluatorResult => {
  if (exitCode === undefined) {
    return verdict(
      evaluator.kind,
      false,
      'the target did not report an exit code, so it was terminated by a signal',
    );
  }
  return verdict(
    evaluator.kind,
    exitCode === evaluator.equals,
    `the target exited with code ${exitCode}, expected ${evaluator.equals}`,
  );
};

/**
 * A judged question is a first class outcome that is never decided here.
 *
 * The evaluator kind stays in the scenario vocabulary because a scenario file that uses it is still readable and
 * its question is still recorded. What changed is the reason: nothing in this build calls a model, so the skip is
 * permanent rather than a setting away.
 */
const modelJudge = (evaluator: OfKind<'model_judge'>): EvaluatorResult =>
  skip(
    evaluator.kind,
    `the judged question was not evaluated: ${evaluator.question}`,
    JUDGE_UNAVAILABLE,
  );

const parseJson = (text: string | undefined): unknown => {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const evaluateOne = (
  evaluator: Evaluator,
  input: EvaluationInput,
  parsedOutput: unknown,
): EvaluatorResult => {
  switch (evaluator.kind) {
    case 'output_contains_all':
      return containsAll(evaluator, input.output);
    case 'output_contains_none':
      return containsNone(evaluator, input.output);
    case 'json_pointer_equals':
      return pointerEquals(evaluator, input, parsedOutput);
    case 'effect_recorded':
      return effectRecorded(evaluator, input);
    case 'no_duplicate_effects':
      return noDuplicateEffects(evaluator, input.duplicateSideEffectKeys);
    case 'span_observed':
      return spanObserved(evaluator, input.spans);
    case 'metric_threshold':
      return metricThreshold(evaluator, input.metrics);
    case 'exit_code':
      return exitCodeEquals(evaluator, input.exitCode);
    case 'model_judge':
      return modelJudge(evaluator);
  }
};

export const evaluate = (input: EvaluationInput): readonly EvaluatorResult[] => {
  const parsedOutput = parseJson(input.output);
  return input.evaluators.map((evaluator) => evaluateOne(evaluator, input, parsedOutput));
};
