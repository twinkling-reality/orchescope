import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LoopProgress, LoopStep } from '../src/loop-progress.ts';
import { resolveNextAction } from '../src/next-action.ts';

/**
 * One next action, shared by every surface.
 *
 * The properties that matter: a rejected or missing declaration outranks the loop, an undeclared
 * system is never offered `trace`, and a repository the loop is waiting on gets exactly one argv.
 */

const step = (id: string, command: readonly string[] | null): LoopStep =>
  ({ id, ordinal: 2, title: id, state: 'blocked', summary: '', detail: [], command }) as LoopStep;

const progress = (
  steps: readonly LoopStep[],
  nextCommand: readonly string[] | null,
): LoopProgress =>
  ({
    steps,
    coverage: { ran: 0, blocked: 0, total: 0 },
    standingAt: steps.find((entry) => entry.command !== null) ?? steps[0] ?? null,
    nextCommand,
  }) as LoopProgress;

describe('resolveNextAction', () => {
  it('names the rejected manifest before any loop command', () => {
    assert.deepEqual(
      resolveNextAction({
        progress: progress(
          [step('goal', ['orchescope', 'goal', 'create', 'X'])],
          ['orchescope', 'goal', 'create', 'X'],
        ),
        agentSystemDetected: true,
        adapters: [{ adapterId: 'adapter:manifest', status: 'failed' }],
      }),
      {
        kind: 'instruction',
        text: 'correct .orchescope/manifest.yaml, then run orchescope audit',
      },
    );
  });

  it('never offers trace when nothing was declared', () => {
    const action = resolveNextAction({
      progress: progress(
        [step('measure', ['orchescope', 'trace', '--', 'x'])],
        ['orchescope', 'trace', '--', 'x'],
      ),
      agentSystemDetected: false,
      adapters: [],
    });
    assert.deepEqual(action, {
      kind: 'command',
      argv: ['orchescope', 'init', '--manifest'],
    });
  });

  it('names the file when the manifest template is already present', () => {
    assert.deepEqual(
      resolveNextAction({
        progress: progress([], null),
        agentSystemDetected: false,
        adapters: [{ adapterId: 'adapter:manifest', status: 'completed' }],
      }),
      {
        kind: 'instruction',
        text: 'declare your components in .orchescope/manifest.yaml',
      },
    );
  });

  it('returns the one loop command and nothing else', () => {
    assert.deepEqual(
      resolveNextAction({
        progress: progress(
          [
            step('goal', ['orchescope', 'goal', 'create', 'OSC-REL-0001']),
            step('measure', ['orchescope', 'trace', '--', 'x']),
          ],
          ['orchescope', 'goal', 'create', 'OSC-REL-0001'],
        ),
        agentSystemDetected: true,
        adapters: [],
      }),
      {
        kind: 'command',
        argv: ['orchescope', 'goal', 'create', 'OSC-REL-0001'],
      },
    );
  });

  it('contributes nothing when the loop is closed', () => {
    assert.equal(
      resolveNextAction({
        progress: progress([], null),
        agentSystemDetected: true,
        adapters: [],
      }),
      null,
    );
  });
});
