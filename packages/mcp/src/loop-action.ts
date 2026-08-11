/**
 * Map the shared next action onto an MCP tool call when one exists.
 *
 * The CLI argv stays the source of truth (`resolveNextAction` in `@orchescope/report`). Agents on MCP
 * should not have to re-parse `orchescope goal create …` into a tool name. A placeholder wrap command
 * maps to `run_traced` without an argv so the agent must supply a real command; Orchescope never
 * invents one and never silently remaps wrap to import.
 */

import type { NextAction } from '@orchescope/report';

export type McpToolCall = {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
};

export type AgentNextAction =
  | {
      readonly kind: 'command';
      readonly argv: readonly string[];
      readonly tool: McpToolCall | null;
    }
  | { readonly kind: 'instruction'; readonly text: string };

export const toAgentNextAction = (action: NextAction | null): AgentNextAction | null => {
  if (action === null) return null;
  if (action.kind === 'instruction') return action;
  return { kind: 'command', argv: action.argv, tool: mcpToolFor(action.argv) };
};

const isPlaceholder = (part: string): boolean => part.startsWith('<') && part.endsWith('>');

const mcpToolFor = (argv: readonly string[]): McpToolCall | null => {
  if (argv[0] !== 'orchescope') return null;
  if (argv[1] === 'goal' && argv[2] === 'create' && typeof argv[3] === 'string') {
    return { name: 'create_improvement_goal', arguments: { findingId: argv[3] } };
  }
  if (argv[1] === 'test' && argv[2] === '--scenario' && typeof argv[3] === 'string') {
    const args: Record<string, unknown> = { scenarioId: argv[3] };
    const repeatAt = argv.indexOf('--repeat');
    if (repeatAt >= 0 && typeof argv[repeatAt + 1] === 'string') {
      const repetitions = Number.parseInt(argv[repeatAt + 1] ?? '', 10);
      if (Number.isFinite(repetitions)) args['repetitions'] = repetitions;
    }
    return { name: 'run_scenario', arguments: args };
  }
  if (argv[1] === 'compare' && typeof argv[2] === 'string' && typeof argv[3] === 'string') {
    return {
      name: 'compare_runs',
      arguments: { baselineRunId: argv[2], candidateRunId: argv[3] },
    };
  }
  if (argv[1] === 'benchmark' && argv[2] === '--scenario' && typeof argv[3] === 'string') {
    return { name: 'benchmark_variants', arguments: { scenarioId: argv[3] } };
  }
  if (argv[1] === 'chaos' && argv[2] === '--scenario' && typeof argv[3] === 'string') {
    return { name: 'inject_faults', arguments: { scenarioId: argv[3] } };
  }
  if (argv[1] === 'trace' && argv[2] === '--import' && typeof argv[3] === 'string') {
    return { name: 'import_trace', arguments: { path: argv[3] } };
  }
  if (argv[1] === 'trace' && argv[2] === '--') {
    const command = argv.slice(3);
    if (command.length === 0 || command.some(isPlaceholder)) {
      /*
       * Name the tool so the agent knows the twin exists, but omit command so validation forces a
       * real argv. Executing the printed placeholder would be inventing a start command.
       */
      return { name: 'run_traced', arguments: {} };
    }
    return { name: 'run_traced', arguments: { command } };
  }
  return null;
};
