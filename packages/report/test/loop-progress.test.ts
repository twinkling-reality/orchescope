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

const bundle = (overrides: Partial<ReportBundle> = {}): ReportBundle =>
  ({
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
  }) as unknown as ReportBundle;

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

  it('stands the reader at the first step that is not done', () => {
    const progress = loopProgress(bundle(), [rule('fired')]);
    assert.equal(progress.standingAt?.id, 'goal');
  });

  it('says the audit ran even on a repository where nothing was found', () => {
    const [audit] = loopProgress(bundle(), []).steps;
    assert.equal(audit?.state, 'done');
    assert.match(audit?.detail[0] ?? '', /not the same as nothing being wrong/);
  });

  it('names the first eligible problem in the command that writes a goal', () => {
    const progress = loopProgress(bundle({ findings: [risk('OSC-REL-0001')] }), []);
    const goal = progress.steps.find((step) => step.id === 'goal');
    assert.equal(goal?.state, 'blocked');
    assert.deepEqual(goal?.command, ['orchescope', 'goal', 'create', 'OSC-REL-0001']);
  });

  it('offers no goal command when no problem has enough behind it', () => {
    const progress = loopProgress(bundle({ findings: [risk('OSC-REL-0001', false)] }), []);
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
    assert.deepEqual(verdict?.command, [
      'orchescope',
      'test',
      '--scenario',
      'support-desk',
      '--repeat',
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
  });
});
