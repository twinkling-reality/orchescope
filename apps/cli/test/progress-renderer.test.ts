import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createProgressRenderer } from '../src/terminal/progress-renderer.ts';
import { createStyle } from '../src/terminal/style.ts';

/**
 * The transient region.
 *
 * Two properties are worth more than the wording of any line it draws. The first is that the erase
 * really erases: an assertion on the literal characters that follow the escape passes against the bug
 * where the escape byte is missing, and that bug is what put those characters at the head of every
 * phase line in a real terminal. So the assertion here is on the byte. The second is that motion is a
 * terminal affordance and nothing else: a pipe, a log and a run under CI get the durable record on
 * standard output and no sediment on standard error.
 */

/** The byte a terminal reads as the start of a control sequence. */
const ESCAPE = '\u001b';
const ERASE = `\r${ESCAPE}[2K`;

const harness = (overrides: { readonly animate?: boolean; readonly verbose?: boolean } = {}) => {
  const written: string[] = [];
  let clock = 0;
  const renderer = createProgressRenderer({
    style: createStyle('plain'),
    animate: overrides.animate ?? true,
    verbose: overrides.verbose ?? false,
    columns: 80,
    write: (text) => {
      written.push(text);
    },
    monotonicMs: () => clock,
  });
  return {
    renderer,
    written,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    joined: () => written.join(''),
  };
};

describe('the erase sequence', () => {
  it('carries the escape byte, so the erase actually runs', () => {
    const bench = harness();
    bench.renderer.sink({ type: 'phase_started', phase: 'discover', label: 'discovering' });
    bench.advance(200);
    bench.renderer.sink({ type: 'phase_progress', phase: 'discover', completed: 3, total: 10 });
    const output = bench.joined();
    assert.ok(output.includes(ESCAPE), 'the erase sequence was written without its escape byte');
    assert.ok(output.includes(ERASE));
    assert.equal(
      output.includes('\r[2K'),
      false,
      'the erase sequence was written as printable characters',
    );
  });

  it('erases before it stops, so nothing of the transient line survives', () => {
    const bench = harness();
    bench.renderer.sink({ type: 'phase_started', phase: 'discover', label: 'discovering' });
    bench.advance(200);
    bench.renderer.sink({ type: 'phase_progress', phase: 'discover', completed: 1 });
    bench.renderer.stop();
    assert.ok(bench.joined().endsWith(ERASE));
  });
});

describe('the first frame gate', () => {
  /*
   * A loader for something that did not take time is a small lie, and it is also the whole of the
   * sediment problem: a phase that finishes inside the gate draws nothing, so there is nothing to erase
   * and nothing to leave behind.
   */
  it('draws nothing for a phase that finishes before the gate', () => {
    const bench = harness();
    bench.renderer.sink({ type: 'phase_started', phase: 'discover', label: 'discovering' });
    bench.advance(40);
    bench.renderer.sink({
      type: 'phase_finished',
      phase: 'discover',
      label: 'discovering',
      summary: '3 components',
      durationMs: 40,
    });
    assert.equal(bench.joined(), '');
  });

  it('draws once the work has run long enough to be worth reporting', () => {
    const bench = harness();
    bench.renderer.sink({ type: 'phase_started', phase: 'discover', label: 'discovering' });
    bench.advance(120);
    bench.renderer.sink({ type: 'phase_progress', phase: 'discover', completed: 5, total: 20 });
    assert.match(bench.joined(), /discovering 5\/20/);
  });
});

describe('what a run that is not a terminal gets', () => {
  it('writes nothing at all, while the work runs and after it', () => {
    const bench = harness({ animate: false });
    bench.renderer.sink({ type: 'phase_started', phase: 'discover', label: 'discovering' });
    bench.advance(5000);
    bench.renderer.sink({ type: 'phase_progress', phase: 'discover', completed: 900, total: 1200 });
    bench.renderer.sink({
      type: 'phase_finished',
      phase: 'discover',
      label: 'discovering',
      summary: '987 components',
      durationMs: 5000,
    });
    bench.renderer.stop();
    assert.equal(bench.joined(), '');
  });

  it('keeps one durable line per phase under verbose, because a log wants the record', () => {
    const bench = harness({ animate: false, verbose: true });
    bench.renderer.sink({ type: 'phase_started', phase: 'discover', label: 'discovering' });
    bench.advance(8400);
    bench.renderer.sink({
      type: 'phase_finished',
      phase: 'discover',
      label: 'discovering',
      summary: '987 components, 243 edges',
      durationMs: 8400,
    });
    bench.renderer.sink({
      type: 'phase_skipped',
      phase: 'reconcile',
      label: 'reconciling runtime evidence',
      reason: 'no run with trace data is stored',
    });
    const lines = bench
      .joined()
      .split('\n')
      .filter((line) => line !== '');
    assert.equal(lines[0], 'phase           discovering: 987 components, 243 edges  8.4s');
    /*
     * A skipped phase says it was skipped and why, and the line is bounded like every other line built
     * from data this process did not write. A log is still output, and output is always bounded.
     */
    assert.match(lines[1] ?? '', /^phase {11}reconciling runtime evidence: skipped, no run/);
    for (const line of lines) assert.ok(line.length <= 79, `an unbounded phase line: ${line}`);
  });
});

describe('a determinate count', () => {
  it('appears only when the phase reported a total, and never as a percentage', () => {
    const bench = harness();
    bench.renderer.sink({ type: 'phase_started', phase: 'discover', label: 'discovering' });
    bench.advance(200);
    bench.renderer.sink({ type: 'phase_progress', phase: 'discover', completed: 7 });
    const withoutTotal = bench.joined();
    assert.equal(withoutTotal.includes('%'), false);
    assert.match(withoutTotal, /discovering 7\b/);
    assert.equal(/discovering 7\//.test(withoutTotal), false);

    bench.advance(200);
    bench.renderer.sink({ type: 'phase_progress', phase: 'discover', completed: 8, total: 20 });
    assert.match(bench.joined(), /discovering 8\/20/);
  });
});

describe('a warning is not progress', () => {
  /*
   * The transient line is erased before anything durable is written and drawn again afterwards. Without
   * that, a warning built from repository data lands in the middle of a half drawn spinner line, which
   * is the interleaving the log sink used to produce on every run that logged anything.
   */
  it('erases the transient line, writes its own, and draws the transient line again', () => {
    const bench = harness();
    bench.renderer.sink({ type: 'phase_started', phase: 'discover', label: 'discovering' });
    bench.advance(200);
    bench.renderer.sink({ type: 'phase_progress', phase: 'discover', completed: 1 });
    bench.written.length = 0;
    bench.advance(200);
    bench.renderer.emitLine('warning: a manifest entry was ignored');
    const output = bench.joined();
    assert.ok(output.startsWith(ERASE), 'the durable line was written over a half drawn one');
    assert.match(output, /warning: a manifest entry was ignored\n/);
    assert.ok(
      output.endsWith(`${ERASE}${bench.written[bench.written.length - 1]?.slice(ERASE.length)}`),
      'the transient line was not drawn again',
    );
    assert.match(output.split('\n')[1] ?? '', /discovering 1/);
  });

  it('bounds and sanitises a line built from repository data', () => {
    const bench = harness({ animate: false });
    bench.renderer.emitLine(`warning: ${'x'.repeat(400)}${ESCAPE}[31m stop`);
    const [line] = bench.joined().split('\n');
    assert.ok((line?.length ?? 0) <= 79, `an unbounded line reached the terminal: ${line?.length}`);
    assert.equal((line ?? '').includes(ESCAPE), false, 'a control byte reached the terminal');
  });
});
