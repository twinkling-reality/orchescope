import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LoopProgress, LoopStep } from '@orchescope/report';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { loopRegion } from '../src/terminal/loop-rows.ts';

/**
 * Five rows, always, whether or not anything was found.
 *
 * The loop used to be absent entirely on four of the sixteen cached repositories, which were exactly
 * the reports where a reader most needs to be told what the product is for. A step that has not
 * happened is still a step, and it says what would advance it.
 */

const step = (over: Partial<LoopStep>): LoopStep =>
  ({
    id: 'goal',
    ordinal: 2,
    title: 'Goal',
    state: 'blocked',
    summary: 'nothing handed off yet',
    detail: [],
    command: null,
    ...over,
  }) as LoopStep;

const progress = (steps: readonly LoopStep[]): LoopProgress =>
  ({
    steps,
    coverage: { ran: 0, blocked: 0, total: 0 },
    standingAt: steps[0] ?? null,
  }) as LoopProgress;

const FIVE: readonly LoopStep[] = [
  step({
    id: 'audit',
    ordinal: 1,
    title: 'Audit',
    state: 'done',
    summary: '21 of 22 checks ran',
    detail: ['19 problems found'],
  }),
  step({ id: 'goal', ordinal: 2, title: 'Goal', state: 'done', summary: '2 jobs written up' }),
  step({
    id: 'rerun',
    ordinal: 3,
    title: 'Rerun',
    state: 'done',
    summary: '1 of 3 scenarios has been run',
  }),
  step({
    id: 'measure',
    ordinal: 4,
    title: 'Measure',
    state: 'done',
    summary: '10 runs recorded',
    detail: ['15 parts timed', '8 faults injected, 1 broke the task'],
  }),
  step({
    id: 'verdict',
    ordinal: 5,
    title: 'Did it help',
    state: 'failed',
    summary: 'unchanged: no metric moved enough to call',
  }),
];

const render = (
  steps: readonly LoopStep[],
  over: { readonly agentSystemDetected?: boolean; readonly joinRenders?: boolean } = {},
): readonly string[] => {
  const layout = layoutFor(80);
  return loopRegion({
    progress: progress(steps),
    agentSystemDetected: over.agentSystemDetected ?? true,
    joinRenders: over.joinRenders ?? false,
  }).map((row) => renderRow(row, layout));
};

describe('the five rows', () => {
  it('renders every step in ordinal order, on a repository with a system and on one without', () => {
    for (const detected of [true, false]) {
      const keys = render(FIVE, { agentSystemDetected: detected })
        .filter((line) => /^\d/.test(line))
        .map((line) => line.slice(0, 14).trim());
      assert.deepEqual(keys, ['1 audit', '2 goal', '3 rerun', '4 measure', '5 did it help']);
    }
  });

  it('spells every state with a symbol and a word, so colour carries nothing', () => {
    const rendered = render(FIVE);
    assert.match(rendered[0] ?? '', /^1 audit {9}\+ done {7}21 of 22 checks ran$/);
    assert.match(rendered.at(-1) ?? '', /^5 did it help {3}! undecided {2}unchanged: /);
    const blocked = render([step({})])[0] ?? '';
    assert.match(blocked, /^2 goal {10}\. not yet {4}nothing handed off yet$/);
  });

  /*
   * A comparison that came back undecided has not found that nothing changed. It has found that the
   * evidence cannot tell, which is a different instruction, and marking it done would lose it.
   */
  it('never renders an undecided verdict as done', () => {
    const line = render(FIVE).at(-1) ?? '';
    assert.equal(line.includes('done'), false);
  });
});

describe('which supporting lines survive', () => {
  it('never renders the audit step detail, because the findings region answers it', () => {
    assert.equal(
      render(FIVE).some((line) => line.includes('19 problems found')),
      false,
    );
  });

  it('drops the parts timed count when the join region carries its denominator', () => {
    const withJoin = render(FIVE, { joinRenders: true });
    assert.equal(
      withJoin.some((line) => line.includes('15 parts timed')),
      false,
    );
    assert.ok(withJoin.some((line) => line.includes('8 faults injected')));
  });

  it('keeps the parts timed count when nothing else states it', () => {
    const withoutJoin = render(FIVE, { joinRenders: false });
    assert.ok(withoutJoin.some((line) => line.includes('15 parts timed')));
  });

  it('renders at most one supporting line per step', () => {
    const rendered = render(FIVE);
    assert.equal(rendered.filter((line) => line.startsWith('    ')).length, 1);
  });

  it('has no supporting line to render on a loop where no step reported one', () => {
    const bare = render(FIVE.map((entry) => ({ ...entry, detail: [] })));
    assert.equal(bare.length, 5);
  });
});

describe('a repository that declared nothing', () => {
  /*
   * The count of checks waiting on a run is a true number naming the wrong cause. A run against an
   * undeclared system produces spans with nothing to join them to, so the blocker is the missing
   * declaration and the run region already says what to do about it.
   */
  it('names the missing declaration rather than the checks waiting on a run', () => {
    const blocked = step({
      id: 'measure',
      ordinal: 4,
      title: 'Measure',
      state: 'blocked',
      summary: '11 checks are blocked on a run',
      detail: ['reliability, cost, performance and 4 more'],
    });
    const undetected = render([blocked], { agentSystemDetected: false });
    assert.deepEqual(undetected, [
      '4 measure       . not yet    nothing is declared for a run to be joined against',
    ]);

    const detected = render([blocked], { agentSystemDetected: true });
    assert.match(detected[0] ?? '', /11 checks are blocked on a run/);
    assert.match(detected[1] ?? '', /reliability, cost, performance and 4 more/);
  });

  /*
   * The substitution replaces a blocked step's sentence and no other.
   *
   * `agentSystemDetected` is a fact about the scan and the runs are a fact about the store, so a
   * repository can hold runs and still declare nothing an adapter recognises. Tracing an undeclared
   * repository is a path the product's own advice sends a reader down, and substituting on a step the
   * engine called `done` printed a row saying the measuring was finished and that nothing had been
   * declared to measure, above a join that had just reported its result.
   */
  it('leaves a measure step that ran alone, and keeps its supporting line', () => {
    const measured = step({
      id: 'measure',
      ordinal: 4,
      title: 'Measure',
      state: 'done',
      summary: '1 run recorded',
      detail: ['3 parts timed'],
    });
    const rows = render([measured], { agentSystemDetected: false });
    assert.deepEqual(rows, [
      '4 measure       + done       1 run recorded',
      '                             3 parts timed',
    ]);
  });
});
