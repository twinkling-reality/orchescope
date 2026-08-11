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

  it('leaves trace as argv only, because MCP has no twin for it', () => {
    assert.deepEqual(
      toAgentNextAction({
        kind: 'command',
        argv: ['orchescope', 'trace', '--', '<the command that starts your system>'],
      }),
      {
        kind: 'command',
        argv: ['orchescope', 'trace', '--', '<the command that starts your system>'],
        tool: null,
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
