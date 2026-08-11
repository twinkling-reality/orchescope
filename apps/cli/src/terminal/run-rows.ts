/**
 * What to do next, answered once.
 *
 * The policy lives in `@orchescope/report` so the terminal, `--json` and MCP name the same advance.
 * This module only renders that decision: a `run` row for a pasteable argv, a `next` row for an
 * instruction that names a file. Neither is ever truncated.
 */

import { type LoopProgress, resolveNextAction } from '@orchescope/report';
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

export const runRegion = (input: RunInput): Region => {
  const action = resolveNextAction({
    progress: input.progress,
    agentSystemDetected: input.result.agentSystemDetected,
    adapters: input.result.graph.coverage.adapters,
  });
  if (action === null) return [];
  return action.kind === 'command' ? [command(action.argv)] : [instruction(action.text)];
};
