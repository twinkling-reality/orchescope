import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toAgentNextAction } from '../src/loop-action.ts';

describe('toAgentNextAction', () => {
  it('maps a goal create argv onto the MCP tool an agent should call', () => {
    assert.deepEqual(
      toAgentNextAction({
        kind: 'command',
        argv: ['orchescope', 'goal', 'create', 'OSC-REL-0001'],
      }),
      {
        kind: 'command',
        argv: ['orchescope', 'goal', 'create', 'OSC-REL-0001'],
        tool: {
          name: 'create_improvement_goal',
          arguments: { findingId: 'OSC-REL-0001' },
        },
      },
    );
  });

  it('maps a scenario rerun, including a repetition count', () => {
    assert.deepEqual(
      toAgentNextAction({
        kind: 'command',
        argv: ['orchescope', 'test', '--scenario', 'support-desk', '--repeat', '5'],
      }),
      {
        kind: 'command',
        argv: ['orchescope', 'test', '--scenario', 'support-desk', '--repeat', '5'],
        tool: {
          name: 'run_scenario',
          arguments: { scenarioId: 'support-desk', repetitions: 5 },
        },
      },
    );
  });

  it('maps a placeholder wrap command to run_traced without inventing an argv', () => {
    assert.deepEqual(
      toAgentNextAction({
        kind: 'command',
        argv: ['orchescope', 'trace', '--', '<the command that starts your system>'],
      }),
      {
        kind: 'command',
        argv: ['orchescope', 'trace', '--', '<the command that starts your system>'],
        tool: { name: 'run_traced', arguments: {} },
      },
    );
  });

  it('maps a concrete wrap command onto run_traced with that argv', () => {
    assert.deepEqual(
      toAgentNextAction({
        kind: 'command',
        argv: ['orchescope', 'trace', '--', 'node', 'apps/demo/src/main.ts'],
      }),
      {
        kind: 'command',
        argv: ['orchescope', 'trace', '--', 'node', 'apps/demo/src/main.ts'],
        tool: {
          name: 'run_traced',
          arguments: { command: ['node', 'apps/demo/src/main.ts'] },
        },
      },
    );
  });

  it('maps an import onto import_trace', () => {
    assert.deepEqual(
      toAgentNextAction({
        kind: 'command',
        argv: ['orchescope', 'trace', '--import', 'spans.json'],
      }),
      {
        kind: 'command',
        argv: ['orchescope', 'trace', '--import', 'spans.json'],
        tool: { name: 'import_trace', arguments: { path: 'spans.json' } },
      },
    );
  });

  it('passes an instruction through unchanged', () => {
    assert.deepEqual(
      toAgentNextAction({
        kind: 'instruction',
        text: 'declare your components in .orchescope/manifest.yaml',
      }),
      {
        kind: 'instruction',
        text: 'declare your components in .orchescope/manifest.yaml',
      },
    );
  });
});
