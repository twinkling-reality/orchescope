/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deltaHeadline, type HeadlineSegment, spellCount } from '../src/headline.ts';

const flatten = (segments: readonly HeadlineSegment[]): string =>
  segments
    .map((segment) => (segment.kind === 'count' ? String(segment.value) : segment.text))
    .join('');

describe('spellCount', () => {
  it('spells every count a sentence can carry as a word', () => {
    assert.equal(spellCount(0), 'zero');
    assert.equal(spellCount(1), 'one');
    assert.equal(spellCount(7), 'seven');
    assert.equal(spellCount(12), 'twelve');
  });

  it('refuses a count a reader would rather compare as a numeral', () => {
    assert.equal(spellCount(13), null);
    assert.equal(spellCount(208), null);
  });

  it('refuses anything that is not a whole count', () => {
    assert.equal(spellCount(-1), null);
    assert.equal(spellCount(1.5), null);
    assert.equal(spellCount(Number.NaN), null);
  });
});

describe('deltaHeadline', () => {
  it('leads with what has never run, spelled, when the count is small', () => {
    const segments = deltaHeadline({ declared: 22, neverExercised: 7, exercisedNotDeclared: 1 });
    assert.equal(flatten(segments), 'Seven of the things this repository declares have never run.');
    assert.ok(segments.every((segment) => segment.kind === 'text'));
  });

  // A numeral is the only rendering two reports can be compared across, so past twelve the count
  // becomes a separate segment the caller sets in the mono face.
  it('carries a large count as a numeral segment rather than as prose', () => {
    const segments = deltaHeadline({ declared: 917, neverExercised: 208, exercisedNotDeclared: 0 });
    assert.equal(segments[0]?.kind, 'count');
    assert.equal(flatten(segments), '208 of the things this repository declares have never run.');
  });

  it('uses the singular when exactly one thing has never run', () => {
    const segments = deltaHeadline({ declared: 22, neverExercised: 1, exercisedNotDeclared: 0 });
    assert.equal(flatten(segments), 'One of the things this repository declares has never run.');
  });

  it('states the good case rather than leaving the screen without a sentence', () => {
    const segments = deltaHeadline({ declared: 22, neverExercised: 0, exercisedNotDeclared: 0 });
    assert.equal(
      flatten(segments),
      'Everything this repository declares ran, and nothing ran that it does not declare.',
    );
  });

  it('does not capitalise a spelled count in the middle of a sentence', () => {
    const segments = deltaHeadline({ declared: 22, neverExercised: 0, exercisedNotDeclared: 1 });
    assert.equal(
      flatten(segments),
      'Everything this repository declares ran, and so did one thing it does not declare.',
    );
  });

  it('says that a repository declaring nothing declares nothing, rather than that it all ran', () => {
    assert.equal(
      flatten(deltaHeadline({ declared: 0, neverExercised: 0, exercisedNotDeclared: 0 })),
      'This repository declares nothing for a run to exercise.',
    );
    assert.equal(
      flatten(deltaHeadline({ declared: 0, neverExercised: 0, exercisedNotDeclared: 4 })),
      'Four things ran, and this repository declares none of them.',
    );
    assert.equal(
      flatten(deltaHeadline({ declared: 0, neverExercised: 0, exercisedNotDeclared: 1 })),
      'One thing ran, and this repository declares none of it.',
    );
  });

  it('always produces a sentence that ends in a full stop', () => {
    for (const declared of [0, 1, 22, 917]) {
      for (const neverExercised of [0, 1, 7, 208]) {
        for (const exercisedNotDeclared of [0, 1, 40]) {
          if (neverExercised > declared) {
            continue;
          }
          const sentence = flatten(
            deltaHeadline({ declared, neverExercised, exercisedNotDeclared }),
          );
          assert.ok(sentence.endsWith('.'), `not a sentence: ${sentence}`);
          assert.ok(sentence.length > 20, `too short to say anything: ${sentence}`);
        }
      }
    }
  });
});
