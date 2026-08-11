/**
 * The five step loop, as five rows.
 *
 * The loop renders whether or not an agent system was detected, which is the change that matters most
 * here: on four of the sixteen cached repositories the loop used to be absent entirely, and those are
 * exactly the reports where a reader most needs to be told what the product is for. A step that has not
 * happened is still a step.
 *
 * Nothing in this module decides a state or a sentence. Both come from `loopProgress`, which reads the
 * bundle. What this module decides is which of a step's supporting lines still say something no other
 * region says, and how a state is spelled so that it survives a pipe.
 */

import type { LoopProgress, LoopStep, LoopStepState } from '@orchescope/report';
import type { Region, Row } from './document-grid.ts';

/**
 * Symbol and word, both mandatory.
 *
 * Colour carries nothing in this document, so the state has to be legible with every escape sequence
 * removed. `blocked` and `failed` stay apart because they tell a reader to do different things: one
 * says go and run something, the other says the run you did was not enough to decide.
 */
const STATE: Readonly<Record<LoopStepState, string>> = {
  done: '+ done',
  blocked: '. not yet',
  failed: '! undecided',
};

/**
 * What blocks a run against a repository that declared nothing.
 *
 * On this branch the count of checks waiting on a run is a true number that names the wrong cause. A run
 * against an undeclared system produces spans with nothing to join them to, so the blocker is the
 * missing declaration, and the RUN region already says what to do about it. The step's own state is not
 * touched: `blocked` and `failed` are kept apart by the module that decides them.
 *
 * It replaces a blocked step's sentence and no other. A repository can hold runs and still declare
 * nothing an adapter recognises, because `agentSystemDetected` is a fact about the scan and the runs are
 * a fact about the store, and `orchescope trace` on an undeclared repository is a path the product's own
 * advice sends a reader down. Substituting on a step the engine called `done` printed a row that said
 * the measuring was finished and that nothing had been declared to measure, three lines above a join
 * that had just reported its result.
 */
const UNDECLARED_MEASURE_SUMMARY = 'nothing is declared for a run to be joined against';

/**
 * One detail row per step at most, and only where it says something no other region says.
 *
 * The audit step's detail never renders: FINDINGS is the one place that answers what was found, and a
 * detail restating it made the same integer appear four times in one report. The measure step's details
 * arrive in a fixed order, the count of parts timed first and the chaos outcome after it, and the count
 * of parts timed is a numerator whose denominator the JOIN region carries on its own first line, so it
 * is dropped exactly when that line renders.
 */
const detailsFor = (step: LoopStep, joinRenders: boolean): readonly string[] => {
  if (step.id === 'audit') return [];
  if (step.id === 'measure' && step.state === 'done' && joinRenders) return step.detail.slice(1, 2);
  return step.detail.slice(0, 1);
};

const stepRow = (step: LoopStep, summary: string): Row => ({
  kind: 'keyed',
  key: `${step.ordinal} ${step.title.toLowerCase()}`,
  state: STATE[step.state],
  text: summary,
});

export interface LoopInput {
  readonly progress: LoopProgress;
  readonly agentSystemDetected: boolean;
  /** True when the JOIN region will render, which is what makes one measure detail a duplicate. */
  readonly joinRenders: boolean;
}

/**
 * Five rows, plus at most one detail each, so at most ten and in practice five to seven.
 *
 * Five because the loop has five steps and a step that has not happened is still a step. One detail row
 * per step because a second is a paragraph and the detail column is a column.
 */
export const loopRegion = (input: LoopInput): Region => {
  const rows: Row[] = [];
  for (const step of input.progress.steps) {
    const undeclared =
      step.id === 'measure' && step.state === 'blocked' && !input.agentSystemDetected;
    rows.push(stepRow(step, undeclared ? UNDECLARED_MEASURE_SUMMARY : step.summary));
    if (undeclared) continue;
    for (const detail of detailsFor(step, input.joinRenders)) {
      rows.push({ kind: 'detail', text: detail });
    }
  }
  return rows;
};
