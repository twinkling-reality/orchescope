/// <reference types="node" />

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildAgentPrompt,
  describeAcceptanceCheck,
  goalToJson,
  goalToMarkdown,
} from '../src/prompt.ts';
import { goal } from './fixture.ts';

describe('describeAcceptanceCheck', () => {
  it('describes every kind of check', () => {
    assert.match(
      describeAcceptanceCheck({
        kind: 'metric_improvement',
        metric: 'retries',
        comparator: 'lt',
        relativeThreshold: 0.25,
      }),
      /retries lt 25\.0% relative/,
    );
    assert.match(
      describeAcceptanceCheck({ kind: 'metric_not_worse', metric: 'latency', tolerance: 0.05 }),
      /no worse than baseline within 0\.05/,
    );
    assert.equal(
      describeAcceptanceCheck({ kind: 'scenario_passes', scenarioId: 'happy' }),
      'scenario happy passes',
    );
    // The identifier is deliberately absent. A finding identifier is a per category sequence number
    // over one scan's findings and is renumbered whenever the set changes, so quoting it here would
    // name whichever finding had since inherited it.
    const resolved = describeAcceptanceCheck({
      kind: 'finding_resolved',
      findingId: 'OSC-PERF-0001',
    });
    assert.equal(resolved, 'the finding this goal was created from is no longer reported');
    assert.ok(!resolved.includes('OSC-PERF-0001'));
    assert.equal(
      describeAcceptanceCheck({ kind: 'command_succeeds', command: ['pnpm', 'test'] }),
      'command succeeds: pnpm test',
    );
    assert.equal(
      describeAcceptanceCheck({ kind: 'manual_review', instruction: 'read the diff' }),
      'manual review: read the diff',
    );
  });

  it('quotes command arguments that need it', () => {
    assert.equal(
      describeAcceptanceCheck({ kind: 'command_succeeds', command: ['echo', 'two words'] }),
      "command succeeds: echo 'two words'",
    );
  });

  it('combines a relative and an absolute threshold', () => {
    assert.match(
      describeAcceptanceCheck({
        kind: 'metric_improvement',
        metric: 'cost',
        comparator: 'lte',
        relativeThreshold: 0.1,
        absoluteThreshold: 2,
      }),
      /10\.0% relative or 2 absolute/,
    );
  });
});

describe('buildAgentPrompt', () => {
  it('carries the problem, the evidence, the boundary and the rollback', () => {
    const prompt = buildAgentPrompt(goal());
    for (const heading of [
      'PROBLEM',
      'EVIDENCE',
      'AFFECTED COMPONENTS',
      'SOURCE LOCATIONS',
      'YOU MAY ONLY WRITE TO',
      'YOU MUST NOT',
      'BEHAVIOUR THAT MUST NOT CHANGE',
      'ACCEPTANCE CRITERIA',
      'VALIDATION',
      'ROLLBACK',
    ]) {
      assert.ok(prompt.includes(heading), `expected the prompt to contain ${heading}`);
    }
    assert.ok(prompt.includes('The refund tool retries without a ceiling.'));
    assert.ok(prompt.includes('src/tools/refund.ts'));
    assert.ok(prompt.includes('Revert the commit'));
    assert.ok(prompt.includes('Retries per task: 14 [observed]'));
  });

  it('names the goal and the finding it came from', () => {
    const prompt = buildAgentPrompt(goal({ id: 'OSC-GOAL-0007', findingId: 'OSC-RELY-0002' }));
    assert.ok(prompt.startsWith('Improvement goal OSC-GOAL-0007:'));
    assert.ok(prompt.includes('Derived from finding OSC-RELY-0002'));
  });

  it('tells the reader not to widen the scope', () => {
    assert.ok(buildAgentPrompt(goal()).includes('Do not widen the scope.'));
  });

  it('says so explicitly when a list is empty rather than omitting the section', () => {
    const prompt = buildAgentPrompt(
      goal({
        sourceLocations: [],
        scope: {
          allowedWritePaths: ['src/a.ts'],
          prohibitedChanges: [],
          invariants: [],
          requiredApprovals: [],
        },
      }),
    );
    assert.ok(prompt.includes('SOURCE LOCATIONS\n(none recorded)'));
    assert.ok(prompt.includes('YOU MUST NOT\n(none recorded)'));
  });

  it('includes the approval section only when approvals are required', () => {
    assert.ok(buildAgentPrompt(goal()).includes('APPROVALS REQUIRED BEFORE MERGING'));
    const none = buildAgentPrompt(
      goal({
        scope: {
          allowedWritePaths: ['src/a.ts'],
          prohibitedChanges: [],
          invariants: [],
          requiredApprovals: [],
        },
      }),
    );
    assert.equal(none.includes('APPROVALS REQUIRED BEFORE MERGING'), false);
  });

  it('ends with exactly one newline', () => {
    const prompt = buildAgentPrompt(goal());
    assert.ok(prompt.endsWith('\n'));
    assert.equal(prompt.endsWith('\n\n'), false);
  });

  it('renders the validation commands so they can be pasted', () => {
    assert.ok(buildAgentPrompt(goal()).includes('orchescope scenario run refund-happy-path'));
  });
});

describe('goalToMarkdown', () => {
  it('starts with a heading naming the goal', () => {
    assert.ok(goalToMarkdown(goal()).startsWith('# OSC-GOAL-0001 '));
  });

  it('marks empty lists rather than leaving a blank section', () => {
    const markdown = goalToMarkdown(goal({ sourceLocations: [] }));
    assert.ok(markdown.includes('## Source locations\n\n_None recorded._'));
  });

  it('includes validation results when the goal has been evaluated', () => {
    const markdown = goalToMarkdown(
      goal({
        validationResults: [
          {
            comparisonId: 'cmp_0000000000000001',
            at: '2026-07-24T02:00:00.000Z',
            verdict: 'improved',
          },
        ],
      }),
    );
    assert.ok(markdown.includes('## Validation results'));
    assert.ok(markdown.includes('cmp_0000000000000001: improved'));
  });
});

describe('goalToJson', () => {
  it('round trips through JSON', () => {
    const original = goal();
    assert.deepEqual(JSON.parse(goalToJson(original)), original);
  });

  it('is indented and newline terminated', () => {
    const json = goalToJson(goal());
    assert.ok(json.includes('\n  "id"'));
    assert.ok(json.endsWith('\n'));
  });
});
