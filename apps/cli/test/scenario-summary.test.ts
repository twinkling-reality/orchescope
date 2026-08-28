import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RepetitionResult, ScenarioResult } from '@orchescope/schema';
import { scenarioSummary } from '../src/terminal/scenario-summary.ts';
import { createStyle } from '../src/terminal/style.ts';

/**
 * What a failed scenario says in the document a person reads.
 *
 * It used to say `exit_code: passed in 0 of 3 repetitions that ran this evaluator` and stop there. The
 * exit code and the reason were both recorded and both reachable only by running the whole scenario again
 * with `--json`, so the terminal reported that something failed and declined to say what.
 */

const style = createStyle('plain');

const repetition = (over: Partial<RepetitionResult>): RepetitionResult =>
  ({
    runId: 'run_0000000000000001',
    repetition: 0,
    status: 'failed',
    metrics: { durationMs: 1 },
    evaluators: [],
    sideEffects: [],
    duplicateSideEffectKeys: [],
    prohibitedSideEffectKinds: [],
    faultsApplied: [],
    ...over,
  }) as RepetitionResult;

const resultWith = (repetitions: readonly RepetitionResult[]): ScenarioResult =>
  ({
    id: 'sres_0000000000000001',
    scenarioId: 'support-desk',
    passed: false,
    repetitions,
    reliability: { repetitions: repetitions.length, successes: 0, passPowerK: [] },
    aggregate: { durationMs: { sampleSize: 0, withheld: [] }, evaluators: [] },
    limitations: [],
  }) as unknown as ScenarioResult;

describe('what a failed scenario reports in the terminal', () => {
  it('names the exit code and the reason the repetitions failed', () => {
    const summary = scenarioSummary(
      style,
      resultWith([
        repetition({ exitCode: 127, failureReason: 'the target exited with code 127: not found' }),
      ]),
    );
    assert.match(summary, /the target exited with code 127: not found/);
  });

  it('counts identical failures rather than repeating them', () => {
    const one = repetition({ exitCode: 1, failureReason: 'the target exited with code 1: boom' });
    const summary = scenarioSummary(style, resultWith([one, one, one]));
    assert.match(summary, /3 of 3 failed: the target exited with code 1: boom/);
    assert.equal(summary.split('the target exited with code 1').length - 1, 1);
  });

  /* A reason carries a stderr excerpt, and a stack trace pasted into an indented list destroys the shape. */
  it('states a reason on one line however many the target wrote', () => {
    const summary = scenarioSummary(
      style,
      resultWith([repetition({ failureReason: 'first line\n  second line\n\tthird' })]),
    );
    assert.match(summary, /first line second line third/);
    for (const line of summary.split('\n')) assert.ok(line.length < 260, line);
  });

  /* The reason is target output, so it leaves the process through redaction like everything else. */
  it('passes the reason through the redactor it is given', () => {
    const summary = scenarioSummary(
      style,
      resultWith([repetition({ failureReason: 'token sk-live-secret failed' })]),
      (value) => value.replace('sk-live-secret', '[redacted]'),
    );
    assert.match(summary, /\[redacted\]/);
    assert.doesNotMatch(summary, /sk-live-secret/);
  });

  /* A guard: a scenario whose repetitions all completed says nothing extra. */
  it('says nothing about failure when every repetition completed', () => {
    const summary = scenarioSummary(
      style,
      resultWith([repetition({ status: 'completed', exitCode: 0 })]),
    );
    assert.doesNotMatch(summary, /of 1 completed/);
  });
});
