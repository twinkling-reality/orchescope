/**
 * The one next action an audit produces, for every surface.
 *
 * The terminal, `--json` and MCP used to disagree: the terminal listed up to three loop commands, and
 * the agent surfaces listed none. One pure function owns the policy so a coding agent never has to
 * scrape the terminal document, and a human never sees two pasteable answers for one standing.
 *
 * Preflight outranks the loop. A rejected manifest or an undeclared system cannot be helped by
 * `orchescope trace`, and offering that command on those branches is the failure this module exists
 * to prevent.
 */

import { auditCommand, manifestCommand } from './commands.ts';
import type { LoopProgress } from './loop-progress.ts';

const MANIFEST_ADAPTER_ID = 'adapter:manifest';

export type AdapterStatus = {
  readonly adapterId: string;
  readonly status: string;
};

/**
 * A pasteable argv, or an instruction that names a file.
 *
 * An instruction must never wear a key that promises a pasteable command. The kind is the contract
 * every renderer and every agent payload shares.
 */
export type NextAction =
  | { readonly kind: 'command'; readonly argv: readonly string[] }
  | { readonly kind: 'instruction'; readonly text: string };

export type ResolveNextActionInput = {
  readonly progress: LoopProgress;
  readonly agentSystemDetected: boolean;
  readonly adapters: readonly AdapterStatus[];
};

export function resolveNextAction(input: ResolveNextActionInput): NextAction | null {
  const manifest = input.adapters.find((adapter) => adapter.adapterId === MANIFEST_ADAPTER_ID);
  /*
   * A rejected input comes before a missing one. A manifest the validator refused is the difference
   * between an empty graph a reader can fix and one they cannot explain.
   */
  if (manifest?.status === 'failed') {
    return {
      kind: 'instruction',
      text: `correct .orchescope/manifest.yaml, then run ${auditCommand().join(' ')}`,
    };
  }
  /*
   * On a repository that declared nothing there is one useful sentence. When the template is missing,
   * the pasteable advance is the command that writes it. When the template is already there, the
   * advance is the file to fill in. Never both, and never `trace`: spans with nothing to join them
   * against help nobody.
   */
  if (!input.agentSystemDetected) {
    if (manifest?.status === 'completed') {
      return {
        kind: 'instruction',
        text: 'declare your components in .orchescope/manifest.yaml',
      };
    }
    return { kind: 'command', argv: manifestCommand() };
  }
  if (input.progress.nextCommand === null) return null;
  return { kind: 'command', argv: input.progress.nextCommand };
}
