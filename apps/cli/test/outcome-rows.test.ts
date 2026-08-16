import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ImprovementOutcome, LoopProgress, LoopStep, NextAction } from '@orchescope/report';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { outcomeRegion } from '../src/terminal/outcome-rows.ts';
import { createStyle } from '../src/terminal/style.ts';

/**
 * The region the product exists for.
 *
 * It has to say two different things without confusing them: what the loop decided, and what it has
 * not decided yet. The case that matters most is a decided verdict, because the version before this
 * could not report one at all and reported a regression as a finished loop.
 */

const LOOP_COMMAND = ['orchescope', 'test', '--scenario', 'x'] as const;
const style = createStyle('plain');

const step = (over: Partial<LoopStep>): LoopStep =>
  ({
    id: 'verdict',
    ordinal: 5,
    title: 'Did it help',
    state: 'blocked',
    summary: 'needs a before and an after',
    detail: [],
    command: null,
    ...over,
  }) as LoopStep;

const outcome = (verdict: string | null, verdictReason: string | null): ImprovementOutcome =>
  ({
    comparisonId: verdict === null ? null : 'cmp_1',
    verdict,
    verdictReason,
    decided: verdict === 'improved' || verdict === 'regressed',
    goals: [],
    summary: '',
  }) as unknown as ImprovementOutcome;

const NOTHING_COMPARED = outcome(null, null);

const lines = (
  standing: LoopStep | null,
  over: {
    readonly action?: NextAction | null;
    readonly outcome?: ImprovementOutcome;
  } = {},
): readonly string[] =>
  outcomeRegion({
    progress: {
      standingAt: standing,
      nextCommand: [...LOOP_COMMAND],
    } as unknown as LoopProgress,
    action: over.action === undefined ? { kind: 'command', argv: [...LOOP_COMMAND] } : over.action,
    outcome: over.outcome ?? NOTHING_COMPARED,
    style,
  }).map((row) => renderRow(row, layoutFor(80)));

/*
 * `improved` and `regressed` both mark step five done, so a closed loop said "every step of the loop
 * is done" for a change that had broken the system. This is the assertion that keeps a referee from
 * announcing a loss as a win.
 */
describe('a comparison that reached a verdict', () => {
  it('names an improvement instead of reporting a finished loop', () => {
    assert.deepEqual(lines(null, { action: null, outcome: outcome('improved', 'x') }), [
      'improved        x',
    ]);
  });

  it('names a regression, and never renders one as done', () => {
    const rendered = lines(null, {
      action: null,
      outcome: outcome('regressed', 'duplicate side effects rose from 0 to 2'),
    });
    assert.deepEqual(rendered, ['regressed       duplicate side effects rose from 0 to 2']);
    assert.equal(
      rendered.some((rendered) => rendered.includes('every step of the loop is done')),
      false,
    );
  });

  it('keeps naming what is still owed when a step is waiting', () => {
    const rendered = lines(step({ id: 'goal', state: 'blocked' }), {
      outcome: outcome('improved', 'task success held'),
    });
    assert.equal(rendered[0], 'improved        task success held');
    assert.match(rendered[1] ?? '', /^missing {9}a problem picked to work on/);
  });

  it('paints the outcome word and nothing beside it', () => {
    const escapeChar = String.fromCharCode(0x1b);
    const chip = new RegExp(`${escapeChar}\\[[0-9;]*m(.*?)${escapeChar}\\[0m`);
    const painted = outcomeRegion({
      progress: { standingAt: null, nextCommand: null } as unknown as LoopProgress,
      action: null,
      outcome: outcome('regressed', 'it got worse'),
      style: createStyle('color'),
    }).map((row) => renderRow(row, layoutFor(80)));
    assert.equal(chip.exec(painted[0] ?? '')?.[1], 'regressed');
  });
});

describe('a comparison that refused to call it', () => {
  it('says what is missing rather than pretending to a verdict', () => {
    assert.deepEqual(lines(step({ state: 'failed' }), { outcome: outcome('unchanged', 'x') }), [
      'missing         a verdict: the last comparison did not settle it',
    ]);
    assert.deepEqual(
      lines(step({ state: 'failed' }), {
        outcome: outcome('insufficient_evidence', 'x'),
      }),
      ['missing         a verdict: the last comparison did not settle it'],
    );
  });
});

describe('what is missing', () => {
  it('names the run a repository with no runtime evidence has never done', () => {
    assert.deepEqual(lines(step({ id: 'measure', state: 'blocked' })), [
      'missing         a run of your system: nothing here has been measured yet',
    ]);
  });

  it('keeps a comparison that never happened apart from one that could not decide', () => {
    assert.deepEqual(lines(step({ state: 'blocked' })), [
      'missing         a before and an after to compare',
    ]);
    assert.deepEqual(lines(step({ state: 'failed' })), [
      'missing         a verdict: the last comparison did not settle it',
    ]);
  });

  it('says so plainly when the loop has closed with nothing to report', () => {
    assert.deepEqual(lines(null, { action: null }), [
      'missing         nothing: every step of the loop is done',
    ]);
  });

  /*
   * The declaration branches of `resolveNextAction` outrank the loop, so on a repository that declared
   * nothing the run row says `orchescope init --manifest` while the loop is standing at `measure`.
   * Reading the loop here printed "a run of your system" above a command that runs nothing.
   */
  it('is about the command under it, not about a step that command does not advance', () => {
    const declaration = 'missing         a description of this project that this build can read';
    assert.deepEqual(
      lines(step({ id: 'measure' }), {
        action: { kind: 'command', argv: ['orchescope', 'init', '--manifest'] },
      }),
      [declaration],
    );
    assert.deepEqual(
      lines(step({ id: 'measure' }), {
        action: { kind: 'instruction', text: 'correct the manifest' },
      }),
      [declaration],
    );
  });
});
