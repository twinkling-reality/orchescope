/**
 * What to do next, answered once.
 *
 * Two independent policies used to answer this, a panel of commands derived from the loop and a `next:`
 * line derived from the audit result, and on the bundled demonstration they disagreed while on `crewai`
 * one silently dropped the other's first row. There is one policy here and it is the loop's own
 * ordering, because the loop is what decides where a repository stands.
 *
 * Two row kinds, and the difference is a promise rather than a style. A `run` row carries an argv a
 * reader can paste. A `next` row carries an instruction that names a file to edit, which is not an argv
 * and must never wear a key that says it is one. Neither is ever truncated: half a command is worse than
 * a wrapped one, and half an instruction names no file.
 */

import type { LoopProgress } from '@orchescope/report';
import type { AuditResult } from '@orchescope/usecases';
import { auditCommand, manifestCommand } from './commands.ts';
import type { Region, Row } from './document-grid.ts';

const MANIFEST_ADAPTER_ID = 'adapter:manifest';

/**
 * Three derived rows.
 *
 * There are five steps and at most three of them can carry a command at once: the audit step never has
 * one, and a step that is done never has one. So three is the ceiling the loop itself sets rather than
 * a number chosen for the page, and it cannot be exceeded without the loop growing a sixth step.
 */
const DERIVED_CEILING = 3;

/** Quotes only what a shell would need quoted, so a printed command can be pasted as it stands. */
const quoteArg = (arg: string): string =>
  /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

const formatArgv = (argv: readonly string[]): string => argv.map(quoteArg).join(' ');

const command = (argv: readonly string[]): Row => ({
  kind: 'exempt',
  key: 'run',
  text: formatArgv(argv),
});

const instruction = (text: string): Row => ({ kind: 'exempt', key: 'next', text });

export interface RunInput {
  readonly result: AuditResult;
  readonly progress: LoopProgress;
}

/**
 * The commands the loop is waiting on, most urgent first.
 *
 * A repository with no detected agent system is never offered `orchescope trace`. Tracing something that
 * declares no agent produces spans with nothing to join them against, and sending a reader to a command
 * that cannot help them is the failure the branch order below exists to prevent.
 */
export const runRegion = (input: RunInput): Region => {
  const manifest = input.result.graph.coverage.adapters.find(
    (adapter) => adapter.adapterId === MANIFEST_ADAPTER_ID,
  );
  /*
   * A rejected input comes before a missing one. A manifest the validator refused is the difference
   * between an empty graph a reader can fix and one they cannot explain, and every other row below is
   * about a graph that may be empty for that reason.
   */
  if (manifest?.status === 'failed') {
    return [
      instruction(`correct .orchescope/manifest.yaml, then run ${formatArgv(auditCommand())}`),
    ];
  }
  /*
   * The floor, and it is the thing that is true rather than a pointer to a report. On a repository that
   * declared nothing there is one useful sentence and it names the file, because a bare
   * `orchescope init --manifest` is the command without the reason, which is the inverse of the rule
   * this product states everywhere else.
   */
  if (!input.result.agentSystemDetected) {
    const declare = instruction('declare your components in .orchescope/manifest.yaml');
    return manifest?.status === 'completed' ? [declare] : [command(manifestCommand()), declare];
  }
  return input.progress.steps
    .filter((step) => step.command !== null)
    .slice(0, DERIVED_CEILING)
    .map((step) => command(step.command ?? []));
};
