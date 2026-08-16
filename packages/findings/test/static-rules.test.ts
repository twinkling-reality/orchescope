import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EdgeDraft } from '@orchescope/graph';
import { indexGraph } from '@orchescope/graph';
import type { EdgePolicy, SystemGraph } from '@orchescope/schema';
import { buildGraph, componentDraft, edgeDraft } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import type { Rule, RuleContext } from '../src/rule.ts';
import {
  architectureShapeRule,
  safeRetryRule,
  unsafeRetryRule,
  unusedConfiguredToolRule,
} from '../src/rules/static-policy.ts';

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
  observedRuns: [],
  silentRuns: [],
  benchmarks: [],
  chaosReports: [],
  scenarios: [],
  evidenceById: new Map(),
});

describe('topology-shape', () => {
  const model = componentDraft({ kind: 'model', name: 'gpt-4.1-mini', file: 'src/main.ts' });
  const database = componentDraft({ kind: 'database', name: 'sqlite', file: 'src/store.ts' });

  const strengths = (graph: SystemGraph) => {
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    return outcome.status === 'fired'
      ? outcome.drafts.filter((draft) => draft.polarity === 'strength')
      : [];
  };

  it('reports a good shape when there is an agent and a relation to judge', () => {
    const found = strengths(
      buildGraph([orchestrator, model], [edgeDraft('invokes_model', orchestrator, model)]),
    );
    assert.equal(found.length, 1);
    assert.match(found[0]?.title ?? '', /reachable, acyclic and narrow/);
  });

  /**
   * The claim is vacuously true of a graph with no agent in it, and on a repository that is not an agent system
   * it read as an endorsement of one. A real 924 file codebase produced exactly this shape: databases and
   * entry points, no agent, and a strength saying the topology was fine.
   */
  it('stays quiet when nothing agentic was found, however well shaped the rest is', () => {
    assert.deepEqual(strengths(buildGraph([database], [])), []);
  });

  it('stays quiet when there is an agent but no relation at all', () => {
    assert.deepEqual(strengths(buildGraph([orchestrator], [])), []);
  });
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
        observedRuns: [],
        silentRuns: [],
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

/**
 * Grouping, measured against what a real repository produces.
 *
 * `openai/openai-agents-python` produced 439 findings, 211 from one rule and 193 from another, which is not a
 * report anybody reads. Two hundred instances of one pattern is one problem with two hundred sites, and the
 * count has to survive the collapse or the scale is lost instead of the noise.
 */
describe('findings that repeat', () => {
  const toolsWithNoCaller = (count: number): SystemGraph =>
    buildGraph(
      [
        orchestrator,
        ...Array.from({ length: count }, (_unused, index) =>
          componentDraft({ kind: 'tool', name: `tool_${index}`, file: `src/tools/${index}.ts` }),
        ),
      ],
      [],
    );

  const evaluate = (graph: SystemGraph) =>
    evaluateRules({
      scanId: 'scan_0000000000000000',
      generatedAt: '2026-01-01T00:00:00.000Z',
      graph: indexGraph(graph),
      context: {
        delta: undefined,
        observedRuns: [],
        silentRuns: [],
        benchmarks: [],
        chaosReports: [],
        scenarios: [],
        evidenceById: new Map(),
      },
      rules: [unusedConfiguredToolRule],
    }).findingSet.findings;

  it('becomes one finding carrying the occurrence count', () => {
    const findings = evaluate(toolsWithNoCaller(40));
    assert.equal(findings.length, 1, 'forty instances of one pattern are one finding');
    const finding = findings[0];
    assert.match(finding?.title ?? '', /^40 tools are defined/);
    assert.equal(
      finding?.metrics.find((metric) => metric.name === 'occurrences')?.value,
      40,
      'the count has to survive the collapse',
    );
  });

  it('states how many components it withheld rather than stopping silently', () => {
    const finding = evaluate(toolsWithNoCaller(40))[0];
    const withheld = finding?.metrics.find((metric) => metric.name === 'componentsWithheld');
    assert.equal(withheld?.value, 15, 'forty components, twenty five listed');
    assert.equal(withheld?.sampleSize, 40);
    assert.equal(finding?.components.length, 25);
    assert.match(
      finding?.explanation ?? '',
      /15 of the 40 affected components are not listed here/,
    );
  });

  it('says nothing about occurrences when the pattern happened once', () => {
    const finding = evaluate(toolsWithNoCaller(1))[0];
    assert.equal(finding?.title, 'tool_0 is defined and nothing calls it');
    assert.deepEqual(
      finding?.metrics.filter((metric) => metric.name === 'occurrences'),
      [],
    );
  });

  it('names the proportion of tools it is talking about, with the sample size', () => {
    const finding = evaluate(toolsWithNoCaller(3))[0];
    const metric = finding?.metrics.find((metric) => metric.name === 'toolsWithoutCaller');
    assert.equal(metric?.value, 3);
    assert.equal(metric?.sampleSize, 3);
    assert.match(finding?.explanation ?? '', /the caller is somewhere Orchescope did not read/);
  });
});

describe('the order findings are reported in', () => {
  it('never lets a repeated low finding sit above a high one', () => {
    const noisy = Array.from({ length: 40 }, (_unused, index) =>
      componentDraft({ kind: 'tool', name: `tool_${index}`, file: `src/tools/${index}.ts` }),
    );
    const graph = buildGraph(
      [orchestrator, refund, ...noisy],
      [
        edgeDraft('calls_tool', orchestrator, refund, {
          policy: {
            retry: { maxAttempts: 3, bounded: true, backoff: 'exponential', idempotency: 'absent' },
          },
        } as Partial<EdgeDraft>),
      ],
    );
    const findings = evaluateRules({
      scanId: 'scan_0000000000000000',
      generatedAt: '2026-01-01T00:00:00.000Z',
      graph: indexGraph(graph),
      context: {
        delta: undefined,
        observedRuns: [],
        silentRuns: [],
        benchmarks: [],
        chaosReports: [],
        scenarios: [],
        evidenceById: new Map(),
      },
      rules: [unsafeRetryRule, unusedConfiguredToolRule],
    }).findingSet.findings;

    assert.equal(findings.length, 2);
    assert.equal(findings[0]?.severity, 'high');
    assert.equal(findings[1]?.severity, 'low');
    assert.match(findings[1]?.title ?? '', /^40 tools/);
  });

  it('puts the finding that can become a goal first when the severity is the same', () => {
    const ruleFor = (id: string, eligible: boolean): Rule => ({
      id,
      category: 'reliability',
      summary: id,
      evaluate: () => ({
        status: 'fired',
        drafts: [
          {
            ruleId: id,
            category: 'reliability',
            polarity: 'risk',
            severity: 'medium',
            confidence: 0.9,
            basis: 'discovered',
            title: id,
            explanation: 'one sentence.',
            impact: 'one sentence.',
            components: ['agent:orchestrator'],
            evidence: [orchestrator.evidence[0]?.id ?? ''],
            goalEligible: eligible,
            goalReason: eligible ? 'A bounded edit.' : 'A decision for the owner.',
          },
        ],
      }),
    });

    const findings = evaluateRules({
      scanId: 'scan_0000000000000000',
      generatedAt: '2026-01-01T00:00:00.000Z',
      graph: indexGraph(buildGraph([orchestrator], [])),
      context: {
        delta: undefined,
        observedRuns: [],
        silentRuns: [],
        benchmarks: [],
        chaosReports: [],
        scenarios: [],
        evidenceById: new Map(),
      },
      rules: [ruleFor('a-decision', false), ruleFor('a-bounded-edit', true)],
    }).findingSet.findings;

    assert.deepEqual(
      findings.map((finding) => finding.title),
      ['a-bounded-edit', 'a-decision'],
    );
  });
});

describe('topology-shape reachability', () => {
  const stranded = componentDraft({ kind: 'tool', name: 'stranded', file: 'src/tools/away.ts' });
  const model = componentDraft({ kind: 'model', name: 'gpt-4.1-mini', file: 'src/main.ts' });

  const unreachable = (graph: SystemGraph) => {
    const outcome = architectureShapeRule.evaluate(contextFor(graph));
    return outcome.status === 'fired'
      ? outcome.drafts.filter((draft) => draft.occurrence?.key === 'unreachable')
      : [];
  };

  /**
   * Two hundred and eight components in one repository were reported unreachable, each one carrying the claim that
   * the wiring was missing or the component was left over. Neither was true: the entry point was outside the
   * repository, because the repository is a library. The observation stands and the inference does not, so the
   * third cause is named and the proportion is reported with its sample size.
   */
  it('names every cause of an unreachable component, including one outside this repository', () => {
    const drafts = unreachable(
      buildGraph(
        [orchestrator, model, stranded],
        [edgeDraft('invokes_model', orchestrator, model)],
      ),
    );
    assert.equal(drafts.length, 1);
    assert.match(drafts[0]?.explanation ?? '', /the entry point is outside this repository/);
    const metric = drafts[0]?.metrics?.find((entry) => entry.name === 'unreachableComponents');
    assert.equal(metric?.value, 1);
    assert.equal(
      metric?.sampleSize,
      2,
      'the agent and the tool participate in control flow, the model does not',
    );
  });

  it('stays quiet when every component that participates in control flow is reached', () => {
    assert.deepEqual(
      unreachable(
        buildGraph([orchestrator, refund], [edgeDraft('calls_tool', orchestrator, refund)]),
      ),
      [],
    );
  });
});
