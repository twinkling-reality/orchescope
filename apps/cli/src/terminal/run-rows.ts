/**
 * What to do next, answered once.
 *
 * The policy lives in `@orchescope/report` so the terminal, `--json` and MCP name the same advance.
 * This module only renders that decision: a `run` row for a pasteable argv, a `next` row for an
 * instruction that names a file. Neither is ever truncated.
 */

import { type LoopProgress, type NextAction, resolveNextAction } from '@orchescope/report';
import type { AuditResult } from '@orchescope/usecases';
import type { Region, Row } from './document-grid.ts';

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
 * The decision itself, so the row that says why and the row that says what are answers to one question.
 *
 * The document names what a reader is missing directly above the command that gets it. Those two rows
 * reading a policy each would let them disagree, and they did: a repository that declared nothing was
 * told it was missing a run of its system and handed `orchescope init --manifest`.
 */
export const nextAction = (input: RunInput): NextAction | null =>
  resolveNextAction({
    progress: input.progress,
    agentSystemDetected: input.result.agentSystemDetected,
    adapters: input.result.graph.coverage.adapters,
  });

export const runRegion = (action: NextAction | null): Region => {
  if (action === null) return [];
  return action.kind === 'command' ? [command(action.argv)] : [instruction(action.text)];
};
