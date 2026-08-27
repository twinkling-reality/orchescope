import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FindingSet, ReportBundle } from '@orchescope/schema';
import { checkCoverage, loopProgress } from '../src/loop-progress.ts';

/**
 * The five step loop.
 *
 * Two properties matter more than the wording of any step. The first is that a step which never ran
 * and a step which ran and could not decide stay apart, because they tell a reader to do different
 * things. The second is that the coverage fraction counts what could run rather than what came back
 * clean: a bar that fell every time somebody measured their system would punish using the tool, and
 * on the corpus tracing raises the finding count on every repository it has been tried on.
 */

type Rules = FindingSet['rulesEvaluated'];

const rule = (
  status: Rules[number]['status'],
  category: Rules[number]['category'] = 'reliability',
): Rules[number] => ({ ruleId: `rule-${status}-${category}`, category, status });

/**
 * A run in the fixture measured something unless the case says otherwise.
 *
 * The summary is derived from `runs` rather than left off, because the loop asks how many runs observed
 * a span and not how many were recorded. A fixture that answered the second question was the shape of the
 * bug: an empty run counted as a baseline, and the loop reported itself past the step that would have
 * fixed it.
 */
const bundle = (overrides: Partial<ReportBundle> = {}): ReportBundle => {
  const runs = overrides.runs ?? [];
  return {
    schemaVersion: 1,
    reportId: 'rpt_0000000000000000',
    projectName: 'fixture',
    findings: [],
    goals: [],
    scenarios: [],
    scenarioRuns: [],
    runs: [],
    componentMetrics: [],
    chaosReports: [],
    comparisons: [],
    ...overrides,
    summary: {
      runCount: runs.length,
      observedRunCount: runs.length,
      silentRunCount: 0,
      ...(overrides.summary ?? {}),
    },
  } as unknown as ReportBundle;
};

/**
 * A bundle that does not carry the partition, which is what an older stored report is.
 *
 * Seven runs, and the seventh produced four spans that resolved only to an undeclared host, so nothing
 * was attributed and `componentMetrics` is empty. Deriving silence from that emptiness said seven runs
 * had recorded no span, which is false of one of them and points a reader at instrumentation that is
 * working.
 */
const unpartitionedBundle = (): ReportBundle =>
  ({
    ...bundle(),
    runs: Array.from({ length: 7 }, (_unused, index) => ({
      id: `run_000000000000000${index}`,
    })),
    summary: { runCount: 7 },
  }) as unknown as ReportBundle;

/** One run recorded, no span in it. The loop must treat this as no baseline at all. */
const silentRunBundle = (overrides: Partial<ReportBundle> = {}): ReportBundle =>
  bundle({
    ...overrides,
    runs: [{ id: 'run_0000000000000001' }] as unknown as ReportBundle['runs'],
    summary: { runCount: 1, observedRunCount: 0, silentRunCount: 1 } as ReportBundle['summary'],
  });

const risk = (id: string, eligible = true) =>
  ({
    id,
    polarity: 'risk',
    goalReadiness: { eligible },
  }) as unknown as ReportBundle['findings'][number];

describe('checkCoverage', () => {
  it('counts a rule that fired and a rule that came back clear as having run', () => {
    assert.deepEqual(checkCoverage([rule('fired'), rule('clear')]), {
      ran: 2,
      blocked: 0,
      total: 2,
    });
  });

  it('counts a rule with too little evidence as blocked rather than as clean', () => {
    const coverage = checkCoverage([rule('fired'), rule('insufficient_evidence')]);
    assert.deepEqual(coverage, { ran: 1, blocked: 1, total: 2 });
  });

  /*
   * A rule with nothing to say about this repository is not a check the reader is missing. Counting it
   * as blocked would make every report look under measured in a way no command could fix.
   */
  it('leaves a rule that does not apply out of both halves', () => {
    assert.deepEqual(checkCoverage([rule('fired'), rule('not_applicable')]), {
      ran: 1,
      blocked: 0,
      total: 1,
    });
  });

  it('has no total to state when nothing was evaluated', () => {
    assert.deepEqual(checkCoverage([]), { ran: 0, blocked: 0, total: 0 });
  });
});

describe('loopProgress', () => {
  it('always reports the same five steps in the same order', () => {
    const progress = loopProgress(bundle(), []);
    assert.deepEqual(
      progress.steps.map((step) => step.id),
      ['audit', 'goal', 'rerun', 'measure', 'verdict'],
    );
    assert.deepEqual(
      progress.steps.map((step) => step.ordinal),
      [1, 2, 3, 4, 5],
    );
  });

  it('stands at goal create once a baseline run exists', () => {
    const progress = loopProgress(
      bundle({
        findings: [risk('OSC-REL-0001')],
        runs: [{ id: 'run_0000000000000001' }] as unknown as ReportBundle['runs'],
      }),
      [rule('fired')],
    );
    assert.equal(progress.standingAt?.id, 'goal');
    assert.deepEqual(progress.nextCommand, ['orchescope', 'goal', 'create', 'OSC-REL-0001']);
  });

  /*
   * Eligible findings without a run used to win standing with goal create, while measure still said
   * checks were blocked on a run. Thirteen of the sixteen corpus reports have no runs. The goal's
   * metric criteria cannot close step five without a baseline, so standing walks to trace.
   */
  it('prefers a baseline run over goal create when nothing has been run', () => {
    const progress = loopProgress(bundle({ findings: [risk('OSC-REL-0001')] }), [
      rule('insufficient_evidence'),
    ]);
    assert.equal(progress.standingAt?.id, 'measure');
    assert.deepEqual(progress.nextCommand?.slice(0, 2), ['orchescope', 'trace']);
    assert.match(progress.steps.find((step) => step.id === 'goal')?.detail[0] ?? '', /baseline/);
  });

  it('prefers a scenario run over trace when scenarios exist and nothing has been run', () => {
    const progress = loopProgress(
      bundle({
        findings: [risk('OSC-REL-0001')],
        scenarios: [{ id: 'support-desk' }] as unknown as ReportBundle['scenarios'],
      }),
      [],
    );
    assert.equal(progress.standingAt?.id, 'rerun');
    assert.deepEqual(progress.nextCommand, ['orchescope', 'test', '--scenario', 'support-desk']);
  });

  /*
   * A goal with nothing eligible to hand off used to park standingAt on a null command while measure
   * still named `trace`. The reader stands where there is something to type.
   */
  it('walks past a blocked step with no command to the next one that has one', () => {
    const progress = loopProgress(bundle(), [rule('insufficient_evidence')]);
    assert.equal(progress.standingAt?.id, 'measure');
    assert.deepEqual(progress.nextCommand?.slice(0, 2), ['orchescope', 'trace']);
  });

  it('says the audit ran even on a repository where nothing was found', () => {
    const [audit] = loopProgress(bundle(), []).steps;
    assert.equal(audit?.state, 'done');
    assert.match(audit?.detail[0] ?? '', /not the same as nothing being wrong/);
  });

  it('names the first eligible problem in the command that writes a goal once a run exists', () => {
    const progress = loopProgress(
      bundle({
        findings: [risk('OSC-REL-0001')],
        runs: [{ id: 'run_0000000000000001' }] as unknown as ReportBundle['runs'],
      }),
      [],
    );
    const goal = progress.steps.find((step) => step.id === 'goal');
    assert.equal(goal?.state, 'blocked');
    assert.deepEqual(goal?.command, ['orchescope', 'goal', 'create', 'OSC-REL-0001']);
  });

  it('offers no goal command when no problem has enough behind it', () => {
    const progress = loopProgress(
      bundle({
        findings: [risk('OSC-REL-0001', false)],
        runs: [{ id: 'run_0000000000000001' }] as unknown as ReportBundle['runs'],
      }),
      [],
    );
    assert.equal(progress.steps.find((step) => step.id === 'goal')?.command, null);
  });

  /*
   * A repository with scenarios written down and none of them ever run is a different state from one
   * with no scenario at all, and the command differs too: the first can name a scenario, the second
   * has nothing to name.
   */
  it('keeps a scenario that was never run apart from having no scenario', () => {
    const none = loopProgress(bundle(), []).steps.find((step) => step.id === 'rerun');
    assert.match(none?.summary ?? '', /no scenario to repeat/);
    assert.equal(none?.command, null);

    const written = loopProgress(
      bundle({ scenarios: [{ id: 'support-desk' }] as unknown as ReportBundle['scenarios'] }),
      [],
    ).steps.find((step) => step.id === 'rerun');
    assert.match(written?.summary ?? '', /none has ever run/);
    assert.deepEqual(written?.command, ['orchescope', 'test', '--scenario', 'support-desk']);
  });

  it('bounds how many areas it names, and counts the rest', () => {
    // Distinct counts, so this exercises the ranking as well as the ceiling. Ties fall back to the
    // category name so that two builds of the same report name the same three.
    const blocked = (category: string, times: number) =>
      Array.from({ length: times }, (_value, index) => ({
        ruleId: `blocked-${category}-${index}`,
        category,
        status: 'insufficient_evidence' as const,
      }));
    const many = [
      ...blocked('reliability', 5),
      ...blocked('performance', 4),
      ...blocked('cost', 3),
      ...blocked('architecture', 2),
      ...blocked('observability', 1),
    ] as unknown as Rules;
    const measure = loopProgress(bundle(), many).steps.find((step) => step.id === 'measure');
    assert.equal(measure?.detail[0], 'reliability, performance, cost and 2 more');
    assert.match(measure?.summary ?? '', /15 checks are blocked on a run/);
  });

  it('names the areas a run would unblock, worst first', () => {
    const progress = loopProgress(bundle(), [
      rule('insufficient_evidence', 'reliability'),
      rule('insufficient_evidence', 'performance'),
      { ruleId: 'second-reliability', category: 'reliability', status: 'insufficient_evidence' },
    ]);
    const measure = progress.steps.find((step) => step.id === 'measure');
    assert.equal(measure?.state, 'blocked');
    assert.match(measure?.summary ?? '', /3 checks are blocked on a run/);
    assert.equal(measure?.detail[0], 'reliability, performance');
    assert.deepEqual(measure?.command?.slice(0, 2), ['orchescope', 'trace']);
  });

  /*
   * The whole reason this view exists. A comparison that returns `unchanged` on one run per side has
   * not found that nothing changed, it has found that the evidence cannot tell, and that is a failure
   * a reader has to see rather than a step quietly marked complete.
   */
  it('reports an undecided comparison as failed, not as done', () => {
    const progress = loopProgress(
      bundle({
        scenarios: [{ id: 'support-desk' }] as unknown as ReportBundle['scenarios'],
        comparisons: [
          {
            verdict: 'unchanged',
            verdictReason: 'no metric moved enough to call',
          },
        ] as unknown as ReportBundle['comparisons'],
      }),
      [],
    );
    const verdict = progress.steps.find((step) => step.id === 'verdict');
    assert.equal(verdict?.state, 'failed');
    assert.match(verdict?.summary ?? '', /no metric moved enough to call/);
    /*
     * Spelled out rather than compared against the builder, because this assertion existed while the
     * flag was `--repeat`, which the binary refuses. A test that reads the argv from the same function
     * that writes it agrees with whatever that function says; `tests/e2e/report-commands.test.ts` is
     * what holds it against the binary's own help.
     */
    assert.deepEqual(verdict?.command, [
      'orchescope',
      'test',
      '--scenario',
      'support-desk',
      '--repetitions',
      '5',
    ]);
  });

  it('reports a comparison that reached a verdict as done, with nothing left to run', () => {
    const progress = loopProgress(
      bundle({
        comparisons: [
          { verdict: 'improved', verdictReason: 'duration fell 18 percent' },
        ] as unknown as ReportBundle['comparisons'],
      }),
      [],
    );
    const verdict = progress.steps.find((step) => step.id === 'verdict');
    assert.equal(verdict?.state, 'done');
    assert.equal(verdict?.command, null);
  });

  /*
   * A run that produced no span advanced the loop past the only step that could have helped: measure
   * reported one run recorded and done, and goal offered a handoff against a baseline whose every
   * metric was unmeasured. Recording that a run happened is right. Reading it as a measurement is not.
   */
  it('does not let a run that produced no span stand in for a baseline', () => {
    const progress = loopProgress(silentRunBundle({ findings: [risk('OSC-REL-0001')] }), [
      rule('insufficient_evidence'),
    ]);
    const measure = progress.steps.find((step) => step.id === 'measure');
    assert.equal(measure?.state, 'blocked');
    assert.match(measure?.summary ?? '', /1 run recorded, no span arrived/);
    assert.deepEqual(measure?.command?.slice(0, 2), ['orchescope', 'trace']);
    assert.equal(progress.standingAt?.id, 'measure');
    assert.equal(progress.steps.find((step) => step.id === 'goal')?.command, null);
  });

  it('counts only the runs that measured something once one of them did', () => {
    const progress = loopProgress(
      bundle({
        runs: [
          { id: 'run_0000000000000001' },
          { id: 'run_0000000000000002' },
        ] as unknown as ReportBundle['runs'],
        summary: {
          runCount: 2,
          observedRunCount: 1,
          silentRunCount: 1,
        } as ReportBundle['summary'],
      }),
      [rule('fired')],
    );
    const measure = progress.steps.find((step) => step.id === 'measure');
    assert.equal(measure?.state, 'done');
    assert.match(measure?.summary ?? '', /^1 run recorded$/);
    assert.ok(measure?.detail.some((line) => /1 run recorded no span/.test(line)));
  });

  it('closes the loop only when every step is done', () => {
    const closed = loopProgress(
      bundle({
        findings: [risk('OSC-REL-0001')],
        goals: [{ id: 'OSC-GOAL-0001' }] as unknown as ReportBundle['goals'],
        scenarios: [{ id: 'support-desk' }] as unknown as ReportBundle['scenarios'],
        scenarioRuns: [{ scenarioId: 'support-desk' }] as unknown as ReportBundle['scenarioRuns'],
        runs: [{ id: 'run_0000000000000001' }] as unknown as ReportBundle['runs'],
        comparisons: [
          { verdict: 'improved', verdictReason: 'duration fell 18 percent' },
        ] as unknown as ReportBundle['comparisons'],
      }),
      [rule('fired')],
    );
    assert.equal(closed.standingAt, null);
    assert.equal(closed.nextCommand, null);
  });
});

describe('a bundle that does not say which runs were silent', () => {
  it('does not read runs that measured nothing as runs that produced no span', () => {
    const measure = loopProgress(unpartitionedBundle(), []).steps.find(
      (step) => step.id === 'measure',
    );
    assert.doesNotMatch(measure?.summary ?? '', /recorded, no span arrived/);
    assert.ok(!measure?.detail.some((line) => /recorded no span/.test(line)));
  });

  it('still sends the reader to trace, because nothing was measured either way', () => {
    const measure = loopProgress(unpartitionedBundle(), []).steps.find(
      (step) => step.id === 'measure',
    );
    assert.equal(measure?.state, 'blocked');
    assert.deepEqual(measure?.command, [
      'orchescope',
      'trace',
      '--',
      '<the command that starts your system>',
    ]);
  });
});
