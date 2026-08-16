import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Component, Finding, MetricDelta, ReconciliationDelta } from '@orchescope/schema';
import {
  componentDigest,
  findingDigest,
  metricDeltaDigest,
  nextActionDigest,
  reconciliationDigest,
} from '../src/digest.ts';

/**
 * The text a client renders.
 *
 * A tool used to put its whole answer in `structuredContent` and a count in the text block, so a client
 * that renders text showed its reader nothing and a model that did not know to look reported that it had
 * found two findings and nothing about them. What these tests hold is that a line carries the fields a
 * reader would otherwise have had to open the payload for, and that it says what it does not know
 * instead of printing a number that was never measured.
 */

const finding = (overrides: Partial<Finding> = {}): Finding =>
  ({
    id: 'OSC-REL-0003',
    ruleId: 'retry-around-non-idempotent-operation',
    category: 'reliability',
    severity: 'high',
    basis: 'discovered',
    confidence: 0.85,
    polarity: 'risk',
    title: 'Retry around issue_refund can repeat an effect',
    components: ['tool:issue_refund'],
    goalReadiness: { eligible: true, reason: 'bounded', requiresRuntimeEvidence: false },
    ...overrides,
  }) as Finding;

describe('findingDigest', () => {
  it('names the identifier, the severity, the title and the components on one line', () => {
    const line = findingDigest(finding());
    for (const fragment of [
      'OSC-REL-0003',
      'high',
      'reliability',
      'Retry around issue_refund can repeat an effect',
      'tool:issue_refund',
      'discovered',
      '0.85',
    ]) {
      assert.ok(line.includes(fragment), `the line does not carry ${fragment}: ${line}`);
    }
  });

  it('says a finding is goal eligible only when it is', () => {
    assert.match(findingDigest(finding()), /Goal eligible/);
    assert.doesNotMatch(
      findingDigest(
        finding({
          goalReadiness: {
            eligible: false,
            reason: 'needs a design decision',
            requiresRuntimeEvidence: false,
            requiresHumanReview: false,
          },
        }),
      ),
      /Goal eligible/,
    );
  });

  it('counts the components it does not name rather than truncating silently', () => {
    const many = finding({ components: ['a:1', 'b:2', 'c:3', 'd:4', 'e:5'] });
    assert.match(findingDigest(many), /a:1, b:2, c:3 and 2 more/);
  });
});

describe('componentDigest', () => {
  const component = (presence: Component['presence']): Component =>
    ({
      id: 'tool:issue_refund',
      kind: 'tool',
      displayName: 'issue_refund',
      basis: 'discovered',
      confidence: 0.9,
      presence,
      sourceLocations: [{ file: 'src/tools/refund.ts', startLine: 12 }],
    }) as Component;

  /*
   * Presence is the central fact of a reconciliation and a pair of booleans states it only to a reader
   * who already knows which one means what.
   */
  it('says presence in words rather than as two flags', () => {
    assert.match(
      componentDigest(component({ static: true, runtime: true, manifest: false })),
      /declared and exercised/,
    );
    assert.match(
      componentDigest(component({ static: true, runtime: false, manifest: false })),
      /declared, never exercised/,
    );
    assert.match(
      componentDigest(component({ static: false, runtime: true, manifest: false })),
      /exercised, never declared/,
    );
  });

  it('names where the component was found', () => {
    assert.match(
      componentDigest(component({ static: true, runtime: false, manifest: false })),
      /src\/tools\/refund\.ts:12/,
    );
  });
});

describe('metricDeltaDigest', () => {
  const delta = (overrides: Partial<MetricDelta> = {}): MetricDelta =>
    ({
      metric: 'durationMs.p95',
      unit: 'ms',
      baseline: 400,
      candidate: 320,
      baselineSamples: 3,
      candidateSamples: 3,
      direction: 'improved',
      ...overrides,
    }) as MetricDelta;

  it('carries both sample sizes, because a direction without them is not a claim this tool makes', () => {
    const line = metricDeltaDigest(delta());
    assert.match(line, /3 baseline samples/);
    assert.match(line, /3 candidate samples/);
  });

  /*
   * A metric the comparison holds no value for is the case the field report caught being banked as a
   * zero. Printing nothing there would read as zero all over again.
   */
  it('says a side carries no value rather than printing it as absent', () => {
    const { baseline: _measured, ...unmeasured } = delta({ direction: 'indeterminate' });
    assert.match(metricDeltaDigest(unmeasured as MetricDelta), /no value to 320 ms/);
  });

  it('carries the caveat when the evidence does not support the direction', () => {
    assert.match(
      metricDeltaDigest(delta({ caveat: 'one run on each side' })),
      /one run on each side/,
    );
  });
});

describe('reconciliationDigest', () => {
  it('names the components in each group rather than counting them', () => {
    const delta = {
      declaredNotExercised: { components: ['tool:get_context'], edges: [], runIds: ['run_1'] },
      exercisedNotDeclared: { components: ['model:openai/gpt-4o'], edges: [] },
      contradictions: [
        {
          componentId: 'tool:search',
          kind: 'read_only_hint',
          declared: 'read only',
          observed: 'wrote twice',
          evidence: ['ev_1'],
        },
      ],
      duplicateSideEffects: [
        {
          key: 'http_post api.example.com/refund',
          componentId: 'tool:issue_refund',
          occurrences: 2,
          totalOccurrences: 2,
          retryAttempts: [1],
          idempotencyKeyPresent: false,
          runIds: ['run_1'],
          evidence: ['ev_2'],
        },
      ],
      joins: {
        byCodeLocation: 1,
        byRuntimeName: 0,
        byKindAndName: 0,
        onNameAlone: [],
        ambiguous: [],
      },
      coverage: {
        declaredComponents: 2,
        exercisedComponents: 1,
        declaredEdges: 0,
        exercisedEdges: 0,
      },
    } as ReconciliationDelta;
    const lines = reconciliationDigest(delta);
    assert.match(lines.join('\n'), /tool:get_context/);
    assert.match(lines.join('\n'), /model:openai\/gpt-4o/);
    assert.match(lines.join('\n'), /declared read only, observed wrote twice/);
    assert.match(lines.join('\n'), /no idempotency key was present/);
  });
});

describe('nextActionDigest', () => {
  it('carries the command and the tool that does the same thing', () => {
    const lines = nextActionDigest({
      kind: 'command',
      argv: ['orchescope', 'goal', 'create', 'OSC-REL-0003'],
      tool: { name: 'create_improvement_goal', arguments: { findingId: 'OSC-REL-0003' } },
    });
    assert.match(lines[0] ?? '', /orchescope goal create OSC-REL-0003/);
    assert.match(lines[0] ?? '', /create_improvement_goal/);
  });

  it('says the loop is closed rather than saying nothing', () => {
    assert.match(nextActionDigest(null)[0] ?? '', /loop is closed/);
  });
});
