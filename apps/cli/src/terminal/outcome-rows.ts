/**
 * Where the reader ended up: what the loop decided, and what it has not decided yet.
 *
 * This is the region the product exists for. An audit is inventory; the value is in step five, so the
 * surface has to be able to say two different things and never confuse them. A comparison that reached
 * a verdict gets a row that names it. Everything the loop has not produced gets a row that names what
 * is absent, immediately above the command that would get it.
 *
 * The failure this module replaces is the one that mattered most. A regression and an improvement both
 * mark step five `done`, so a closed loop printed `nothing: every step of the loop is done` whether the
 * change had helped or had broken the system. A referee that announces a loss as a win is worse than no
 * referee, and this is the surface a person checking in on autonomous agents actually reads.
 *
 * The two rows are keyed by their own outcome word, the way a problem row is keyed by its severity:
 * `improved` and `regressed` are what a reader greps for, and a key is painted before the grid pads it,
 * so colour is a chip the width of the word and `NO_COLOR` loses nothing.
 */

import type {
  ImprovementOutcome,
  LoopProgress,
  LoopStep,
  LoopStepId,
  NextAction,
} from '@orchescope/report';
import type { Region, Row } from './document-grid.ts';
import type { Style } from './style.ts';

const MISSING: Readonly<Record<LoopStepId, string>> = {
  audit: 'evidence for every check: some had nothing to look at',
  goal: 'a problem picked to work on, with a check that proves it fixed',
  rerun: 'the same test, run again after the change',
  measure: 'a run of your system: nothing here has been measured yet',
  verdict: 'a before and an after to compare',
};

/**
 * What the two branches that outrank the loop are about.
 *
 * A repository that declared nothing, or whose manifest this build rejected, is not standing anywhere
 * in the loop: it is standing in front of it. The command those branches produce writes or fixes a
 * declaration, so the sentence above it has to be about a declaration too.
 */
const UNREADABLE_PROJECT = 'a description of this project that this build can read';

/**
 * The one step whose failure says something its blocked state does not.
 *
 * A verdict step that is `blocked` never had two sides to compare. A verdict step that is `failed` had
 * them, ran the comparison, and the comparison declined to call it. Telling a reader they are missing a
 * before and an after when they have both would be false, and it would hide the fact the product most
 * needs them to see: the measurement happened and it was not enough.
 */
const missingFor = (step: LoopStep): string =>
  step.id === 'verdict' && step.state === 'failed'
    ? 'a verdict: the last comparison did not settle it'
    : MISSING[step.id];

/** True when the command on the run row is the loop's own advance rather than a declaration fix. */
const advancesTheLoop = (action: NextAction | null, progress: LoopProgress): boolean => {
  if (action === null) return true;
  const next = progress.nextCommand;
  if (action.kind !== 'command' || next === null) return false;
  return action.argv.length === next.length && action.argv.every((arg, at) => arg === next[at]);
};

const verdictRow = (outcome: ImprovementOutcome, style: Style): Row => ({
  kind: 'keyed',
  key: outcome.verdict ?? '',
  text: outcome.verdictReason ?? '',
  paintKey: outcome.verdict === 'improved' ? style.good : style.bad,
});

const missingRow = (
  progress: LoopProgress,
  action: NextAction | null,
  standing: LoopStep | null,
): Row => ({
  kind: 'keyed',
  key: 'missing',
  text: !advancesTheLoop(action, progress)
    ? UNREADABLE_PROJECT
    : standing === null
      ? 'nothing: every step of the loop is done'
      : missingFor(standing),
});

export interface OutcomeInput {
  readonly progress: LoopProgress;
  readonly action: NextAction | null;
  /** The same selection `--json` and MCP return, so no two surfaces answer this differently. */
  readonly outcome: ImprovementOutcome;
  readonly style: Style;
}

export const outcomeRegion = (input: OutcomeInput): Region => {
  const { progress, action, outcome, style } = input;
  const standing = progress.standingAt;
  const rows: Row[] = [];
  if (outcome.decided) rows.push(verdictRow(outcome, style));
  /*
   * A decided verdict on a closed loop is the whole answer, so the missing row is dropped rather than
   * printing "nothing" underneath a result that already said it. A decided verdict with a step still
   * waiting keeps both: the last change was judged, and something else is still owed.
   */
  if (!outcome.decided || standing !== null) rows.push(missingRow(progress, action, standing));
  return rows;
};
