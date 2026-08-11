import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LoopProgress, LoopStep } from '@orchescope/report';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { runRegion } from '../src/terminal/run-rows.ts';
import { adapter, auditResult, coverage } from './audit-fixture.ts';

/**
 * What to do next, answered once.
 *
 * The version before this listed every loop command that carried an argv, so on `crewai` a reader saw
 * both `goal create` and `trace`. The ordering below is the whole policy: a rejected input before a
 * missing one, a missing declaration before runtime evidence, and exactly one pasteable advance from
 * the loop.
 */

const step = (id: string, command: readonly string[] | null): LoopStep =>
  ({ id, ordinal: 2, title: id, state: 'blocked', summary: '', detail: [], command }) as LoopStep;

const progress = (
  steps: readonly LoopStep[],
  nextCommand: readonly string[] | null = steps.find((entry) => entry.command !== null)?.command ??
    null,
): LoopProgress =>
  ({
    steps,
    coverage: { ran: 0, blocked: 0, total: 0 },
    standingAt: steps.find((entry) => entry.command !== null) ?? null,
    nextCommand,
  }) as LoopProgress;

const render = (
  result: Parameters<typeof runRegion>[0]['result'],
  steps: readonly LoopStep[] = [],
  nextCommand?: readonly string[] | null,
): readonly string[] => {
  const layout = layoutFor(80);
  return runRegion({ result, progress: progress(steps, nextCommand) }).map((row) =>
    renderRow(row, layout),
  );
};

describe('a repository with no detected agent system', () => {
  /*
   * Tracing something that declares no agent produces spans with nothing to join them against, so
   * sending a reader to `orchescope trace` here is sending them to a command that cannot help them.
   */
  it('is never offered a command that cannot help it', () => {
    const rendered = render(auditResult({ agentSystemDetected: false }), [
      step('measure', ['orchescope', 'trace', '--', 'x']),
    ]);
    assert.equal(
      rendered.some((line) => line.includes('trace')),
      false,
    );
  });

  it('is told the one command that creates the manifest template', () => {
    assert.deepEqual(render(auditResult({ agentSystemDetected: false })), [
      'run             orchescope init --manifest',
    ]);
  });

  it('is not told to create a manifest it already has', () => {
    assert.deepEqual(
      render(
        auditResult({
          agentSystemDetected: false,
          coverage: coverage({ adapters: [adapter('adapter:manifest', 'completed')] }),
        }),
      ),
      ['next            declare your components in .orchescope/manifest.yaml'],
    );
  });
});

describe('a manifest the validator rejected', () => {
  it('outranks every other branch', () => {
    const rejected = auditResult({
      agentSystemDetected: true,
      coverage: coverage({ adapters: [adapter('adapter:manifest', 'failed', 'bad')] }),
    });
    assert.deepEqual(render(rejected, [step('goal', ['orchescope', 'goal', 'create', 'X'])]), [
      'next            correct .orchescope/manifest.yaml, then run orchescope audit',
    ]);
  });

  /*
   * An instruction is not an argv. A row carrying the `run` key promises something a reader can paste,
   * and neither of the two instructions in this product is pasteable.
   */
  it('never wears the key that promises something pasteable', () => {
    const rejected = auditResult({
      coverage: coverage({ adapters: [adapter('adapter:manifest', 'failed', 'bad')] }),
    });
    for (const line of render(rejected)) assert.equal(line.startsWith('run '), false);
  });
});

describe('a repository the loop is waiting on', () => {
  it('prints the one loop command, even when later steps also carry one', () => {
    assert.deepEqual(
      render(
        auditResult({}),
        [
          step('goal', ['orchescope', 'goal', 'create', 'OSC-REL-0001']),
          step('measure', ['orchescope', 'trace', '--', '<the command that starts your system>']),
        ],
        ['orchescope', 'goal', 'create', 'OSC-REL-0001'],
      ),
      ['run             orchescope goal create OSC-REL-0001'],
    );
  });

  it('quotes only what a shell would need quoted, so a row can be pasted as it stands', () => {
    const line = render(auditResult({}), [
      step('measure', ['orchescope', 'trace', '--', 'a b']),
    ])[0];
    assert.equal(line, "run             orchescope trace -- 'a b'");
  });

  /*
   * A closed loop has nothing waiting on the reader, and a row inviting them to reopen a report is not
   * a thing the loop is waiting on. The loop's own five rows already say every step is done.
   */
  it('contributes nothing when every step is done', () => {
    assert.deepEqual(render(auditResult({}), [step('goal', null), step('rerun', null)], null), []);
  });
});
