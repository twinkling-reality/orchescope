/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PresentationRefusal } from '../src/presentation/presentation-refusal.ts';
import { buildSectionPresentations } from '../src/presentation/section-presentation.ts';
import { bundle, component, finding, goal, run } from './fixture.ts';

const commandText = (refusal: PresentationRefusal): readonly string[] =>
  refusal.commands.map((argv) => argv.join(' '));

describe('buildSectionPresentations', () => {
  it('keeps every depth screen and every slot present on an empty report', () => {
    const presentations = buildSectionPresentations(bundle());
    assert.deepEqual(Object.keys(presentations), [
      'map',
      'findings',
      'performance',
      'resilience',
      'scenarios',
      'comparisons',
      'goals',
    ]);
    for (const presentation of Object.values(presentations)) {
      assert.deepEqual(Object.keys(presentation), [
        'summary',
        'summaryRefusal',
        'primaryRefusal',
        'detailRefusal',
      ]);
      assert.ok(presentation.summaryRefusal !== null);
      assert.ok(presentation.primaryRefusal !== null);
      assert.ok(presentation.detailRefusal !== null);
    }
  });

  /*
   * This replaces an assertion that every refusal on every slot carried at least one command. That
   * assertion held while all three slots rendered the same object, and it is the shape the design
   * record forbids: "the commands are named once, on the band ... Four copies of one command is a
   * screen that reads as four faults instead of one absence."
   *
   * So the guarantee is inverted rather than dropped. The screen still always names a command, and
   * a slot below the band may only name one that the band did not already give.
   */
  it('names a command on the band of every screen that refuses', () => {
    for (const [screen, presentation] of Object.entries(buildSectionPresentations(bundle()))) {
      assert.ok(presentation.summaryRefusal !== null, screen);
      assert.ok(presentation.summaryRefusal.commands.length > 0, screen);
    }
  });

  it('never repeats the band command in the slots below it', () => {
    for (const [screen, presentation] of Object.entries(buildSectionPresentations(bundle()))) {
      const named = new Set(commandText(presentation.summaryRefusal!));
      for (const refusal of [presentation.primaryRefusal, presentation.detailRefusal]) {
        for (const command of commandText(refusal!)) {
          assert.ok(!named.has(command), `${screen} repeats \`${command}\` below the band`);
        }
      }
    }
  });

  it('gives every slot on a screen its own words', () => {
    for (const [screen, presentation] of Object.entries(buildSectionPresentations(bundle()))) {
      const refusals = [
        presentation.summaryRefusal!,
        presentation.primaryRefusal!,
        presentation.detailRefusal!,
      ];
      const titles = new Set(refusals.map((refusal) => refusal.title));
      const reasons = new Set(refusals.map((refusal) => refusal.reason));
      assert.equal(titles.size, 3, `${screen} repeats a refusal title`);
      assert.equal(reasons.size, 3, `${screen} repeats a refusal reason`);
    }
  });

  it('fills only the slots supported by the report evidence', () => {
    const report = bundle({
      graph: { ...bundle().graph, components: [component({ id: 'agent:a' })] },
      findings: [finding({ id: 'OSC-REL-0001' })],
      goals: [goal()],
    });
    const presentations = buildSectionPresentations(report);
    assert.equal(presentations.map.summaryRefusal, null);
    assert.equal(presentations.map.primaryRefusal, null);
    assert.equal(presentations.findings.summaryRefusal, null);
    assert.equal(presentations.findings.primaryRefusal, null);
    assert.ok(presentations.findings.detailRefusal !== null);
    assert.equal(presentations.goals.summaryRefusal, null);
    assert.equal(presentations.goals.primaryRefusal, null);
    assert.equal(presentations.goals.detailRefusal, null);
    assert.ok(presentations.performance.summaryRefusal !== null);
    assert.ok(presentations.performance.primaryRefusal !== null);
  });

  /*
   * A report can carry runs and still pin no time to any part. The band then states a wall clock
   * while the ranking below it has nothing to rank, which is a second absence rather than the same
   * one, so that slot names the command the band is not naming.
   */
  it('gives the ranking its own command when the band is not refusing', () => {
    const report = bundle({ runs: [run()] });
    const { performance } = buildSectionPresentations(report);
    assert.equal(performance.summaryRefusal, null);
    assert.ok(performance.primaryRefusal !== null);
    assert.ok(performance.primaryRefusal.commands.length > 0);
  });
});
