/**
 * The audit document: region order, and the blank line rule.
 *
 * Exactly one blank line between regions, never two and never zero. No leading blank line and no
 * trailing one, so line one is the project name and a diff between two runs reports only the rows that
 * moved. This module composes and does nothing else: every string in it was decided by one of the
 * region modules, and every one of those was decided by the bundle.
 */

import { loopProgress } from '@orchescope/report';
import type { Finding } from '@orchescope/schema';
import type { AuditResult } from '@orchescope/usecases';
import { type Layout, renderDocument } from './document-grid.ts';
import { findingRegion } from './finding-rows.ts';
import { gapRegion } from './gap-rows.ts';
import { joinRegion } from './join-rows.ts';
import { loopRegion } from './loop-rows.ts';
import { runRegion } from './run-rows.ts';
import { sourceRegion } from './source-headline.ts';
import type { Style } from './style.ts';

export interface AuditDocumentInput {
  readonly result: AuditResult;
  readonly layout: Layout;
  readonly style: Style;
  readonly verbose: boolean;
  /** Paths this invocation wrote, so the record of a side effect sits in the document that caused it. */
  readonly written: readonly string[];
}

/**
 * The second and last place in the whole document that may emit an escape sequence.
 *
 * The first is the project name on line one. Both are typographic: the state of everything on the page
 * is already carried by a symbol and a word, so under `NO_COLOR`, in a pipe, in a log and under CI the
 * document is byte identical apart from these two. Only the first command is accented, because the
 * point of an accent is that there is one of it.
 */
const accented = (
  rows: ReturnType<typeof runRegion>,
  accent: (text: string) => string,
): ReturnType<typeof runRegion> =>
  rows.map((row, index) => (index === 0 ? { ...row, paintText: accent } : row));

/**
 * Region order, and the reason for it.
 *
 * What this repository is, then where it stands in the loop, then the join the loop's fourth step
 * produced, then what the first step found, then what could not be looked at, then what this run wrote,
 * then what to do. Action is last because it is nearest the cursor, which is the position that replaces
 * the frame the commands used to sit in.
 */
export const auditDocument = (input: AuditDocumentInput): string => {
  const { result, layout } = input;
  const progress = loopProgress(result.bundle, result.findingSet.rulesEvaluated);
  const risks = result.bundle.findings.filter((finding: Finding) => finding.polarity === 'risk');
  const strengths = result.bundle.findings.filter(
    (finding: Finding) => finding.polarity === 'strength',
  );
  const join = joinRegion(result.reconciliation);
  return renderDocument(
    [
      sourceRegion(result, layout, input.style.bold),
      loopRegion({
        progress,
        agentSystemDetected: result.agentSystemDetected,
        joinRenders: join.length > 0,
      }),
      join,
      findingRegion({ risks, strengths, verbose: input.verbose }),
      gapRegion(result.graph.coverage, layout),
      /*
       * A written path is exempt for the reason a command is: half a path names no file. A reader who
       * passed `--export-sarif` is going to open what it wrote, and a path cut at the sentence budget
       * sends them looking in a directory whose name stops at an ellipsis.
       */
      input.written.map((path) => ({ kind: 'exempt', key: 'wrote', text: path }) as const),
      accented(runRegion({ result, progress }), input.style.accent),
    ],
    layout,
  );
};
