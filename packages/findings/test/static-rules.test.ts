import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EdgeDraft } from '@orchescope/graph';
import { indexGraph } from '@orchescope/graph';
import type { EdgePolicy, SystemGraph } from '@orchescope/schema';
import { buildGraph, componentDraft, edgeDraft } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import type { RuleContext } from '../src/rule.ts';
import { safeRetryRule, unsafeRetryRule } from '../src/rules/static-policy.ts';

/**
 * Rule tests.
 *
 * Each rule gets two cases: one that fires it and one that proves it stays quiet without the evidence it needs. A rule that
 * only has the first kind of test is a rule that might fire on everything.
 */

const orchestrator = componentDraft({ kind: 'agent', name: 'orchestrator', file: 'src/main.ts' });

const refund = componentDraft({
  kind: 'tool',
  name: 'issue_refund',
  file: 'src/tools/refund.ts',
  sideEffect: 'financial',
});

const lookup = componentDraft({
  kind: 'tool',
  name: 'lookup_account',
  file: 'src/tools/account.ts',
  sideEffect: 'read_only',
});

const graphWith = (policy: EdgePolicy | undefined, target = refund): SystemGraph =>
  buildGraph(
    [orchestrator, target],
    [
      edgeDraft(
        'calls_tool',
        orchestrator,
        target,
        policy === undefined ? {} : ({ policy } as Partial<EdgeDraft>),
      ),
    ],
  );

const contextFor = (graph: SystemGraph): RuleContext => ({
  graph: indexGraph(graph),
  delta: undefined,
  runs: [],
  benchmarks: [],
  chaosReports: [],
  scenarios: [],
  evidenceById: new Map(),
});

describe('retry-around-non-idempotent-operation', () => {
  it('fires when a retry wraps a financial effect with no declared key', () => {
    const outcome = unsafeRetryRule.evaluate(
      contextFor(
        graphWith({
          retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'absent' },
        }),
      ),
    );
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
    const draft = outcome.drafts[0];
    assert.equal(draft?.severity, 'high');
    assert.equal(draft?.basis, 'discovered');
    assert.ok(draft?.components.includes('tool:issue_refund'));
    assert.equal(draft?.goalEligible, true);
  });

  it('fires at a lower severity when the effect class itself is unknown', () => {
    const unclassified = componentDraft({ kind: 'tool', name: 'send_thing', file: 'src/send.ts' });
    const outcome = unsafeRetryRule.evaluate(
      contextFor(
        graphWith(
          {
            retry: { maxAttempts: 2, bounded: true, backoff: 'fixed', idempotency: 'unknown' },
          },
          unclassified,
        ),
      ),
    );
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts[0]?.severity, 'medium');
  });

  it('stays quiet when the operation declares a key', () => {
    const outcome = unsafeRetryRule.evaluate(
      contextFor(
        graphWith({
          retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'declared' },
        }),
      ),
    );
    assert.notEqual(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 0);
  });

  it('stays quiet when the operation only reads', () => {
    const outcome = unsafeRetryRule.evaluate(
      contextFor(
        graphWith(
          {
            retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'absent' },
          },
          lookup,
        ),
      ),
    );
    assert.equal(outcome.drafts.length, 0);
  });

  it('stays quiet when there is no retry at all', () => {
    const outcome = unsafeRetryRule.evaluate(contextFor(graphWith(undefined)));
    assert.equal(outcome.drafts.length, 0);
  });
});

describe('bounded-retry-with-declared-idempotency', () => {
  it('reports the correct shape as a strength', () => {
    const outcome = safeRetryRule.evaluate(
      contextFor(
        graphWith({
          retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'declared' },
        }),
      ),
    );
    assert.equal(outcome.status, 'fired');
    const draft = outcome.drafts[0];
    assert.equal(draft?.polarity, 'strength');
    assert.equal(draft?.severity, 'info');
    assert.equal(draft?.goalEligible, false);
    assert.match(draft?.explanation ?? '', /at most 3 times/);
    assert.match(draft?.explanation ?? '', /exponential/);
  });

  it('reports clear, not fired, when a retry exists without a key', () => {
    const outcome = safeRetryRule.evaluate(
      contextFor(
        graphWith({
          retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'absent' },
        }),
      ),
    );
    assert.equal(outcome.status, 'clear');
    assert.equal(outcome.drafts.length, 0);
  });

  it('reports not applicable when nothing retries anything', () => {
    const outcome = safeRetryRule.evaluate(contextFor(graphWith(undefined)));
    assert.equal(outcome.status, 'not_applicable');
  });

  it('does not call an unbounded retry safe, even with a key', () => {
    const outcome = safeRetryRule.evaluate(
      contextFor(
        graphWith({
          retry: { bounded: false, backoff: 'unknown', idempotency: 'declared' },
        }),
      ),
    );
    assert.equal(outcome.status, 'clear');
  });
});

describe('the two retry rules together', () => {
  it('never both fire for the same relation', () => {
    const cases: (EdgePolicy | undefined)[] = [
      undefined,
      { retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'declared' } },
      { retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'absent' } },
      { retry: { bounded: false, backoff: 'unknown', idempotency: 'unknown' } },
    ];
    for (const policy of cases) {
      const context = contextFor(graphWith(policy));
      const unsafe = unsafeRetryRule.evaluate(context).drafts.length;
      const safe = safeRetryRule.evaluate(context).drafts.length;
      assert.ok(unsafe === 0 || safe === 0, `both rules fired for ${JSON.stringify(policy)}`);
    }
  });

  it('produces findings the engine accepts, with capped severity and evidence', () => {
    const graph = graphWith({
      retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'absent' },
    });
    const result = evaluateRules({
      scanId: 'scan_0000000000000000',
      generatedAt: '2026-01-01T00:00:00.000Z',
      graph: indexGraph(graph),
      context: {
        delta: undefined,
        runs: [],
        benchmarks: [],
        chaosReports: [],
        scenarios: [],
        evidenceById: new Map(),
      },
      rules: [unsafeRetryRule, safeRetryRule],
    });

    const findings = result.findingSet.findings;
    assert.equal(findings.length, 1);
    const finding = findings[0];
    assert.match(finding?.id ?? '', /^OSC-REL-\d{4}$/);
    assert.ok((finding?.evidence.length ?? 0) > 0);
    assert.ok((finding?.components.length ?? 0) > 0);
    // Both rules are reported as evaluated, including the one that found nothing.
    assert.equal(result.findingSet.rulesEvaluated.length, 2);
    assert.ok(
      result.findingSet.rulesEvaluated.some(
        (rule) =>
          rule.ruleId === 'bounded-retry-with-declared-idempotency' && rule.status === 'clear',
      ),
    );
  });
});
