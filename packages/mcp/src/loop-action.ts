/**
 * Map the shared next action onto an MCP tool call when one exists.
 *
 * The CLI argv stays the source of truth (`resolveNextAction` in `@orchescope/report`). Agents on MCP
 * should not have to re-parse `orchescope goal create …` into a tool name. Steps with no MCP twin
 * (`trace`, `init --manifest`) keep `tool` null and the argv alone.
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
  return null;
};
