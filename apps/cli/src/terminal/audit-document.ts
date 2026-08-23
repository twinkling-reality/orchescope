/**
 * The audit document: region order, and the blank line rule.
 *
 * The default glance answers four questions in the order a reader asks them. What was audited, and how
 * much of it was read. What is wrong, worst first, in words that name a consequence. What is still
 * missing, because an audit is inventory and the value is in step five. And the one command that gets
 * it. Everything that is engine spine (the five steps, the reconciliation deltas, evidence bases,
 * identifiers, confidences) is `--verbose`, and all of it is always in `--json` and MCP for agents.
 *
 * The missing row and the run row share a region on purpose. A reason and the command it justifies are
 * one thought, and a blank line between them makes the command read as though it arrived unattached.
 * There is still exactly one place that says what to do.
 *
 * Exactly one blank line between regions, never two and never zero. No leading blank line and no
 * trailing one, so line one is the project name and a diff between two runs reports only the rows that
 * moved. This module composes and does nothing else: every string in it was decided by one of the
 * region modules, and every one of those was decided by the bundle.
 */

import { improvementOutcome, loopProgress } from '@orchescope/report';
import type { Finding } from '@orchescope/schema';
import type { AuditResult } from '@orchescope/usecases';
import { type Layout, renderDocument } from './document-grid.ts';
import { findingRegion } from './finding-rows.ts';
import { gapRegion } from './gap-rows.ts';
import { joinRegion } from './join-rows.ts';
import { loopRegion } from './loop-rows.ts';
import { outcomeRegion } from './outcome-rows.ts';
import { nextAction, runRegion } from './run-rows.ts';
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
 * The first is the project name on line one, and the severity chip a problem row wears. All of them are
 * typographic: the state of everything on the page is already carried by a word, so under `NO_COLOR`,
 * in a pipe, in a log and under CI the document is byte identical apart from these. Only the first
 * command is accented, because the point of an accent is that there is one of it.
 */
const accented = (
  rows: ReturnType<typeof runRegion>,
  accent: (text: string) => string,
): ReturnType<typeof runRegion> =>
  rows.map((row, index) => (index === 0 ? { ...row, paintText: accent } : row));

/**
 * Glance first. Verbose restores the full spine for a reader who asked for it.
 */
export const auditDocument = (input: AuditDocumentInput): string => {
  const { result, layout } = input;
  const progress = loopProgress(result.bundle, result.findingSet.rulesEvaluated);
  const risks = result.bundle.findings.filter((finding: Finding) => finding.polarity === 'risk');
  const strengths = result.bundle.findings.filter(
    (finding: Finding) => finding.polarity === 'strength',
  );
  const join = joinRegion(result.reconciliation, input.verbose);
  const action = nextAction({ result, progress });
  const run = accented(runRegion(action), input.style.accent);
  /*
   * A written path is exempt for the reason a command is: half a path names no file. A reader who
   * passed `--export-sarif` is going to open what it wrote, and a path cut at the sentence budget
   * sends them looking in a directory whose name stops at an ellipsis.
   */
  const written = input.written.map(
    (path) => ({ kind: 'exempt', key: 'wrote', text: path }) as const,
  );

  if (!input.verbose) {
    return renderDocument(
      [
        sourceRegion(result, layout, input.style.bold, false),
        findingRegion({ risks, strengths, verbose: false, style: input.style }),
        join,
        gapRegion(result.graph.coverage, layout),
        written,
        [
          ...outcomeRegion({
            progress,
            action,
            outcome: improvementOutcome(result.bundle),
            style: input.style,
          }),
          ...run,
        ],
      ],
      layout,
    );
  }

  return renderDocument(
    [
      sourceRegion(result, layout, input.style.bold, true),
      loopRegion({
        progress,
        agentSystemDetected: result.agentSystemDetected,
        joinRenders: join.length > 0,
      }),
      findingRegion({ risks, strengths, verbose: true, style: input.style }),
      join,
      gapRegion(result.graph.coverage, layout),
      written,
      run,
    ],
    layout,
  );
};
