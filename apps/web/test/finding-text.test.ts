/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { basisDescriptors, describeBasis, describeSeverity, severityRank } from '../src/basis.ts';
import { buildFindingText } from '../src/finding-text.ts';
import { finding } from './fixture.ts';

describe('buildFindingText', () => {
  it('carries the identity, the severity and the evidence class', () => {
    const text = buildFindingText(
      finding({ id: 'OSC-PERF-0001', severity: 'high', basis: 'observed', confidence: 0.82 }),
      (id) => id,
    );
    assert.ok(text.startsWith('OSC-PERF-0001 title for OSC-PERF-0001'));
    assert.ok(text.includes('Severity high'));
    assert.ok(text.includes('Evidence class Observed'));
    assert.ok(text.includes('confidence 0.82'));
  });

  it('names components with the display name the reader saw and with the identifier', () => {
    const text = buildFindingText(
      finding({ id: 'OSC-PERF-0002', components: ['tool:refund'] }),
      () => 'Refund tool',
    );
    assert.ok(text.includes('- Refund tool (tool:refund)'));
  });

  it('records the sample size and the evidence class of every measurement', () => {
    const text = buildFindingText(
      finding({
        id: 'OSC-PERF-0003',
        metrics: [
          {
            name: 'retries',
            value: 14,
            unit: 'retries',
            sampleSize: 20,
            basis: 'observed',
            comparisonValue: 2,
          },
        ],
      }),
      (id) => id,
    );
    assert.ok(text.includes('retries: 14 retries'));
    assert.ok(text.includes('compared with 2 retries'));
    assert.ok(text.includes('sample size 20'));
    assert.ok(text.includes('observed'));
  });

  it('always lists the evidence identifiers so a claim can be checked', () => {
    const text = buildFindingText(
      finding({ id: 'OSC-PERF-0004', evidence: ['ev_000000000000000a', 'ev_000000000000000b'] }),
      (id) => id,
    );
    assert.ok(text.includes('- ev_000000000000000a'));
    assert.ok(text.includes('- ev_000000000000000b'));
  });

  it('labels effort and change risk as judgements rather than measurements', () => {
    const text = buildFindingText(
      finding({
        id: 'OSC-PERF-0005',
        recommendation: {
          summary: 'Bound the retry.',
          steps: ['Set a ceiling.'],
          effort: 'small',
          risk: 'low',
        },
      }),
      (id) => id,
    );
    assert.ok(text.includes('1. Set a ceiling.'));
    assert.ok(text.includes('design judgements, not measurements'));
  });

  it('includes the suggested experiment with a pasteable command', () => {
    const text = buildFindingText(
      finding({
        id: 'OSC-PERF-0006',
        suggestedExperiment: {
          description: 'Rerun under a slow tool.',
          command: ['orchescope', 'chaos', 'happy path'],
          expectedSignal: 'Retries stay below four.',
        },
      }),
      (id) => id,
    );
    assert.ok(text.includes("orchescope chaos 'happy path'"));
    assert.ok(text.includes('Expected signal: Retries stay below four.'));
  });

  it('reports goal readiness and any conflict rather than hiding either', () => {
    const text = buildFindingText(
      finding({
        id: 'OSC-PERF-0007',
        conflictsWith: ['OSC-RELY-0001'],
        goalReadiness: {
          eligible: false,
          reason: 'needs runtime evidence',
          requiresRuntimeEvidence: true,
          requiresHumanReview: false,
        },
      }),
      (id) => id,
    );
    assert.ok(text.includes('CONFLICTS WITH OSC-RELY-0001'));
    assert.ok(text.includes('not eligible: needs runtime evidence'));
  });

  it('ends with exactly one newline', () => {
    const text = buildFindingText(finding({ id: 'OSC-PERF-0008' }), (id) => id);
    assert.ok(text.endsWith('\n'));
    assert.equal(text.endsWith('\n\n'), false);
  });
});

describe('evidence class vocabulary', () => {
  // The evidence class is carried by its own word rather than by a colour or a glyph, so what has to
  // hold is that no two classes can be confused for each other by a reader who only sees the word.
  it('describes all six classes the schema allows, each named by a word of its own', () => {
    const descriptors = basisDescriptors();
    assert.equal(descriptors.length, 6);
    assert.deepEqual(
      descriptors.map((descriptor) => descriptor.value),
      ['observed', 'discovered', 'inferred', 'estimated', 'simulated', 'model_interpreted'],
    );
    const labels = new Set(descriptors.map((descriptor) => descriptor.label));
    assert.equal(
      labels.size,
      descriptors.length,
      'two evidence classes share a label, so the word cannot tell them apart',
    );
    for (const descriptor of descriptors) {
      assert.ok(descriptor.label.length > 0);
      assert.ok(descriptor.meaning.length > 0);
    }
  });

  it('separates the classes that came from watching the system run', () => {
    assert.equal(describeBasis('observed').measured, true);
    assert.equal(describeBasis('simulated').measured, true);
    assert.equal(describeBasis('estimated').measured, false);
    assert.equal(describeBasis('model_interpreted').measured, false);
  });

  it('names an unrecognised class instead of dropping it', () => {
    const descriptor = describeBasis('telepathy');
    assert.equal(descriptor.value, 'telepathy');
    assert.equal(descriptor.label, 'Unknown basis');
  });
});

describe('severity vocabulary', () => {
  it('ranks severities from critical down to info', () => {
    assert.ok(severityRank('critical') > severityRank('high'));
    assert.ok(severityRank('high') > severityRank('medium'));
    assert.ok(severityRank('medium') > severityRank('low'));
    assert.ok(severityRank('low') > severityRank('info'));
  });

  // Two alert hues cover five severities, so hue alone cannot separate them and is never asked to.
  // The mark has to do it, which means all five forms have to differ and so do all five words.
  it('gives every severity a distinct mark and a distinct word, neither of them a colour', () => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'];
    const marks = severities.map((severity) => describeSeverity(severity).mark);
    assert.equal(new Set(marks).size, marks.length, 'two severities draw the same mark');
    const labels = severities.map((severity) => describeSeverity(severity).label);
    assert.equal(new Set(labels).size, labels.length, 'two severities share a word');
  });

  it('ranks an unknown severity below every known one and marks it as belonging to no rank', () => {
    assert.equal(severityRank('catastrophic'), 0);
    const descriptor = describeSeverity('catastrophic');
    assert.equal(descriptor.label, 'catastrophic');
    assert.equal(descriptor.mark, 'unranked');
    for (const known of ['critical', 'high', 'medium', 'low', 'info']) {
      assert.notEqual(describeSeverity(known).mark, descriptor.mark);
    }
  });
});
