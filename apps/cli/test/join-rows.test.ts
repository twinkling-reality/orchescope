import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutFor, renderRow } from '../src/terminal/document-grid.ts';
import { joinRegion } from '../src/terminal/join-rows.ts';
import { reconciliation } from './audit-fixture.ts';

const render = (delta: Parameters<typeof joinRegion>[0], verbose = true): readonly string[] => {
  const layout = layoutFor(80);
  return joinRegion(delta, verbose).map((row) => renderRow(row, layout));
};

describe('the glance', () => {
  it('hides the system region entirely', () => {
    assert.deepEqual(render(reconciliation({}), false), []);
    assert.deepEqual(render(undefined, false), []);
  });

  it('explains component execution beside a strict zero relation rate', () => {
    const lines = render(
      reconciliation({
        edgeExerciseRate: 0,
        behavioralAccount: {
          status: 'complete',
          acceptedSpans: 16,
          droppedSpans: 0,
          rejectedSpans: 0,
          executedComponents: 6,
          componentExecutions: 16,
          executedByKind: [{ kind: 'agent', count: 6 }],
          observedStructuralRelations: 2,
          qualifiedDeclaredRelations: 0,
          refusedObservedRelations: 2,
          noIndependentRelationObservation: false,
          refusals: [],
          evidence: [],
          evidenceOmitted: 0,
        },
      }),
      false,
    );
    assert.deepEqual(lines, [
      'behavior        6 parts executed in accepted subset of 16 spans',
      'behavior        2 independent structural relations observed',
      'behavior        0 declared relations qualified for the strict exercise rate',
    ]);
  });

  it('bounds a zero-relation statement to an incomplete accepted subset', () => {
    const lines = render(
      reconciliation({
        edgeExerciseRate: 0,
        behavioralAccount: {
          status: 'incomplete',
          acceptedSpans: 7,
          droppedSpans: 2,
          rejectedSpans: 1,
          executedComponents: 3,
          componentExecutions: 6,
          executedByKind: [{ kind: 'agent', count: 3 }],
          observedStructuralRelations: 0,
          qualifiedDeclaredRelations: 0,
          refusedObservedRelations: 0,
          noIndependentRelationObservation: false,
          refusals: [],
          evidence: [],
          evidenceOmitted: 0,
        },
      }),
      false,
    );
    assert.ok(lines.some((line) => line.includes('accepted subset reported 0')));
    assert.ok(lines.some((line) => line.includes('2 spans dropped, 1 span rejected')));
    assert.equal(
      lines.some((line) => line.includes('no independent')),
      false,
    );
  });
});

describe('verbose', () => {
  it('uses plain language for the fraction and the four deltas', () => {
    assert.deepEqual(render(reconciliation({})), [
      'system          14 of 21 parts in the code showed up in a run',
      'system          [##############.......] 14/21',
      'system          7 parts in the code never ran',
      'system          1 part ran without an exact static identity match',
      'system          0 places where the code and a run disagreed',
      'system          1 outside effect that happened twice in one run',
    ]);
  });

  it('omits the meter when the total is too wide to draw honestly', () => {
    const tiny = render(reconciliation({ exercised: 3, declared: 953 }));
    assert.equal(tiny[0], 'system          3 of 953 parts in the code showed up in a run');
    assert.equal(
      tiny.some((line) => line.includes('[')),
      false,
    );
  });

  it('names the span attribute that kept code location joins unavailable', () => {
    const lines = render(
      reconciliation({
        missingSpanAttributes: [
          {
            attribute: 'code.file.path',
            purpose: 'code_location',
            observedComponents: 21,
          },
        ],
      }),
    );
    assert.equal(
      lines[2],
      'system          21 parts lack code.file.path; exact source identity unavailable',
    );
  });

  it('labels kind-and-name joins as heuristic rather than exact source matches', () => {
    const lines = render(reconciliation({ byKindAndName: 2 }));
    assert.ok(
      lines.some((line) => line.includes('2 parts joined by heuristic kind and name only')),
    );
  });

  it('holds every row inside the width whatever the counts grow to', () => {
    const layout = layoutFor(80);
    const huge = joinRegion(
      reconciliation({ exercised: 1, declared: 999_999, notExercised: 999_998 }),
      true,
    ).map((row) => renderRow(row, layout));
    for (const line of huge) assert.ok(line.length <= 80, line);
  });
});
