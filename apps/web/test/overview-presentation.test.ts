/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOverviewPresentation } from '../src/presentation/overview-presentation.ts';
import { bundle, component, finding } from './fixture.ts';
import { reportWithRun } from './overview-fixture.ts';

describe('buildOverviewPresentation', () => {
  it('says what was found and what to run, and draws no picture, in the no run regime', () => {
    const presentation = buildOverviewPresentation(
      bundle({
        graph: { ...bundle().graph, components: [component({ id: 'agent:a' })] },
        summary: { ...bundle().summary, componentCount: 1 },
      }),
    );
    // Overview is one answer. The slots that used to answer the same question three more ways are
    // gone, and their content is on the screens it already lived on.
    assert.deepEqual(Object.keys(presentation), ['preamble', 'headline', 'delta', 'context']);
    // The model goes on the page before any number, because every count here is meaningless to a reader
    // who does not know that this tool read their code and, where a run exists, watched the system work.
    assert.match(presentation.preamble.sentence, /^We read your code\.$/);
    assert.match(presentation.preamble.shape, /^1 agent$/);
    // The declared count is fully known without any run and is stated. What is not drawn is a rail of
    // that many identical marks: it carries one bit of information, its own length, which the count
    // gives in full, and it used to take half a screen to say nothing.
    assert.equal(presentation.delta.state, 'unmeasured');
    assert.equal(presentation.delta.declared, 1);
    assert.ok(!('meter' in presentation.delta), 'the no run regime still builds a rail');
    assert.deepEqual(presentation.delta.refusal.commands[0]?.slice(0, 2), ['orchescope', 'trace']);
  });

  it('leads with what was found rather than with how much we could look at', () => {
    // `7 of 21 never ran` is a fact about the quality of our own measurement. A count of problems is a
    // fact about the reader's system, it has a breakdown worth drawing, and it has a most serious
    // member worth naming, so it is what the screen opens on and the join is a tile further down.
    const presentation = buildOverviewPresentation(
      reportWithRun({
        findings: [
          finding({ id: 'OSC-REL-0001', severity: 'high' }),
          finding({ id: 'OSC-REL-0002', severity: 'low' }),
          finding({ id: 'OSC-STR-0001', severity: 'info', polarity: 'strength' }),
        ],
      }),
    );
    assert.equal(presentation.headline.worst?.id, 'OSC-REL-0001');
    assert.equal(presentation.headline.mixes.risk.total, 2);
    assert.equal(presentation.headline.mixes.strength.total, 1);
    assert.equal(presentation.headline.refusal, null);
    // The one thing to do sits with the one thing it is about. It used to be a tile of its own, three
    // hundred pixels away, naming something different.
    assert.notEqual(presentation.headline.action, null);
  });

  it('opens on the good news when there is no bad news to open on', () => {
    const presentation = buildOverviewPresentation(
      reportWithRun({ findings: [finding({ id: 'OSC-STR-0001', polarity: 'strength' })] }),
    );
    assert.equal(presentation.headline.worst?.id, 'OSC-STR-0001');
    assert.equal(presentation.headline.refusal, null);
  });

  it('refuses the headline outright when neither side holds anything', () => {
    const presentation = buildOverviewPresentation(bundle());
    assert.notEqual(presentation.headline.refusal, null);
    assert.match(presentation.headline.refusal?.title ?? '', /Nothing in it is worth reporting/);
  });

  /*
   * `observability-coverage` is the only finding in the whole bundle on `flask`, `express` and
   * `axios`, so the hero staged our own blind spot as the most serious thing found: a severity, a
   * basis, an evidence count, a title, an impact sentence and a disclosure, saying what the preamble
   * and the next action had each already said. It stays a finding and stays in the count. It is not
   * the thing the screen leads with.
   */
  it('never leads with a finding about our own coverage', () => {
    const presentation = buildOverviewPresentation(
      bundle({
        findings: [finding({ id: 'OSC-OBS-0001', ruleId: 'observability-coverage' })],
      }),
    );
    assert.equal(presentation.headline.worst, null);
    assert.notEqual(presentation.headline.refusal, null);
    assert.equal(presentation.headline.mixes.risk.total, 1, 'the finding is still counted');
  });

  it('leads with a finding about the reader whenever there is one', () => {
    const presentation = buildOverviewPresentation(
      bundle({
        findings: [
          finding({ id: 'OSC-OBS-0001', ruleId: 'observability-coverage', severity: 'high' }),
          finding({ id: 'OSC-REL-0001', ruleId: 'unbounded-retry', severity: 'low' }),
        ],
      }),
    );
    assert.equal(presentation.headline.worst?.id, 'OSC-REL-0001');
  });

  it('carries the shares the screen draws, and refuses one with no total', () => {
    // A repository the scan opened no file in has no share to state, and a bar drawn at empty there
    // would say the scan looked and failed rather than that it had nothing to look at.
    const empty = buildOverviewPresentation(bundle());
    assert.equal(empty.context.readFiles.percent, null);
  });

  it('refuses the delta outright when the repository declares nothing to measure', () => {
    const presentation = buildOverviewPresentation(bundle());
    assert.equal(presentation.delta.state, 'refused');
    assert.match(presentation.delta.refusal.title, /did not find a system/);
    assert.deepEqual(presentation.delta.refusal.commands[0]?.slice(0, 2), ['orchescope', 'init']);
  });
});
