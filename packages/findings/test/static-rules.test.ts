import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INFERRED_ENTRY_POINT_TAG } from '@orchescope/domain';
import type { EdgeDraft } from '@orchescope/graph';
import { indexGraph } from '@orchescope/graph';
import type { EdgePolicy, SystemGraph } from '@orchescope/schema';
import { buildGraph, componentDraft, edgeDraft } from '@orchescope/testkit';
import { evaluateRules } from '../src/engine.ts';
import type { Rule, RuleContext } from '../src/rule.ts';
import {
  approvalBoundaryRule,
  architectureShapeRule,
  missingTimeoutRule,
  promptInjectionBoundaryRule,
  safeRetryRule,
  unboundedRetryRule,
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

const graphWith = (
  policy: EdgePolicy | undefined,
  target = refund,
  metadata: Readonly<Record<string, string>> = {},
): SystemGraph =>
  buildGraph(
    [orchestrator, target],
    [
      edgeDraft('calls_tool', orchestrator, target, {
        ...(policy === undefined ? {} : { policy }),
        ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
      } as Partial<EdgeDraft>),
    ],
  );

const post = componentDraft({
  kind: 'external_service',
  name: 'payments.example.com',
  file: 'src/pay.ts',
  sideEffect: 'non_idempotent_write',
});

/**
 * The shape every retry in the field takes: a loop around a helper, and the request inside the helper.
 *
 * The frame carries the tag discovery puts on an entry point it minted rather than read, which is what
 * makes it transparent to the question "what does this retry actually repeat".
 */
const retryThroughFrame = (operation: ReturnType<typeof componentDraft>): SystemGraph => {
  const frame = componentDraft({
    kind: 'entrypoint',
    name: 'sendPayment',
    file: 'src/pay.ts',
    tags: ['entrypoint', INFERRED_ENTRY_POINT_TAG],
  });
  return buildGraph(
    [orchestrator, frame, operation],
    [
      edgeDraft('calls_service', orchestrator, frame, {
        policy: {
          retry: { maxAttempts: 3, bounded: true, backoff: 'fixed', idempotency: 'absent' },
        },
      } as Partial<EdgeDraft>),
      edgeDraft('calls_service', frame, operation),
    ],
  );
};

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
    /*
     * Classified and undecided, which the draft has to state: a component with no class at all was never
     * looked at, and the rule now keeps the two apart.
     */
    const undecided = componentDraft({
      kind: 'tool',
      name: 'send_thing',
      file: 'src/send.ts',
      sideEffect: 'unknown',
    });
    const outcome = unsafeRetryRule.evaluate(
      contextFor(
        graphWith(
          {
            retry: { maxAttempts: 2, bounded: true, backoff: 'fixed', idempotency: 'unknown' },
          },
          undecided,
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

  /*
   * A retry ends where the author wrote it, which is usually a helper rather than the request the helper
   * makes. Discovery mints a frame for that helper to hold the effect, nobody classifies a frame, and the
   * guard refusing to judge an unclassified component therefore refused on every input a field run gave
   * it while the write one hop further was classified `non_idempotent_write` all along.
   */
  it('reads the operation behind the frame the retry names', () => {
    const outcome = unsafeRetryRule.evaluate(contextFor(retryThroughFrame(post)));
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 1);
    assert.ok(
      outcome.drafts[0]?.title.includes('payments.example.com'),
      `the finding named the frame rather than the operation: ${outcome.drafts[0]?.title}`,
    );
    assert.ok(outcome.drafts[0]?.components.includes('external_service:payments.example.com'));
  });

  it('still refuses when nothing behind the frame was ever classified', () => {
    const unclassified = componentDraft({
      kind: 'external_service',
      name: 'payments.example.com',
      file: 'src/pay.ts',
    });
    const outcome = unsafeRetryRule.evaluate(contextFor(retryThroughFrame(unclassified)));
    assert.equal(outcome.drafts.length, 0, 'absent is not the same answer as unknown');
  });

  it('does not read through a component the repository declared', () => {
    /*
     * A frame is the name of a line of code and a tool is a boundary its author declared. Reading past
     * the second would attribute an operation to a component whose contract is that it decides for
     * itself what to do.
     */
    const declared = componentDraft({ kind: 'tool', name: 'pay', file: 'src/pay.ts' });
    const graph = buildGraph(
      [orchestrator, declared, post],
      [
        edgeDraft('calls_tool', orchestrator, declared, {
          policy: {
            retry: { maxAttempts: 3, bounded: true, backoff: 'fixed', idempotency: 'absent' },
          },
        } as Partial<EdgeDraft>),
        edgeDraft('calls_service', declared, post),
      ],
    );
    assert.equal(unsafeRetryRule.evaluate(contextFor(graph)).drafts.length, 0);
  });

  /**
   * A component can stand for more than one call, and then it cannot answer for any of them.
   *
   * A function that posts a job and polls its status builds both addresses at run time, so both requests
   * are one component named for that function and its class is whichever call was recorded first. Asked
   * about the poll, it answered with the class of the POST, and a pinned repository gained a finding
   * about a write its loop never makes.
   */
  it('believes the relation about which operation it repeats, over the component', () => {
    const graph = graphWith(
      { retry: { bounded: false, backoff: 'fixed', idempotency: 'unknown' } },
      post,
      { retriedEffect: 'read_only' },
    );
    assert.equal(unsafeRetryRule.evaluate(contextFor(graph)).drafts.length, 0);
  });

  it('still fires when the relation says the repeated call is the write', () => {
    const graph = graphWith(
      { retry: { bounded: false, backoff: 'fixed', idempotency: 'unknown' } },
      post,
      { retriedEffect: 'non_idempotent_write' },
    );
    assert.equal(unsafeRetryRule.evaluate(contextFor(graph)).status, 'fired');
  });
});

/**
 * The sentence a reader goes to the line to check.
 *
 * It said "a loop with a catch" whatever the relation came from, which was already untrue of an explicit
 * retry helper and became untrue of a loop that reads the response rather than catching.
 */
describe('how unbounded-retry says the retry was recognised', () => {
  const unbounded = { retry: { bounded: false, backoff: 'none', idempotency: 'unknown' } } as const;
  const explanationFor = (metadata: Readonly<Record<string, string>>): string => {
    const outcome = unboundedRetryRule.evaluate(contextFor(graphWith(unbounded, lookup, metadata)));
    return outcome.drafts[0]?.explanation ?? '';
  };

  it('names the helper when the retry is a call to one', () => {
    const explanation = explanationFor({ retryHelper: 'pRetry' });
    assert.match(explanation, /a call to pRetry/);
    assert.doesNotMatch(explanation, /loop with a catch/);
  });

  it('names what the loop showed when the retry is a loop', () => {
    const explanation = explanationFor({
      retryShape: 'loop-with-check',
      reattemptEvidence: 'it waits with sleep before the next pass',
    });
    assert.match(explanation, /a loop where it waits with sleep before the next pass/);
    assert.doesNotMatch(explanation, /catch/);
  });

  /*
   * A decorated function has no loop and no helper call, so both of the sentences above would send a
   * reader to a line holding neither.
   */
  it('names the declaration when a library stated the retry', () => {
    const explanation = explanationFor({
      retryShape: 'decorated-function',
      retryDeclaration: "a function decorated with tenacity's retry",
      reattemptEvidence: "a function decorated with tenacity's retry",
    });
    assert.match(explanation, /discovered as a function decorated with tenacity's retry/);
    assert.doesNotMatch(explanation, /a loop where/);
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

/**
 * Who the approval boundary rule is about.
 *
 * The risk it names is a model deciding on its own to invoke a consequential operation. Firing on every
 * consequential operation instead raised, across the pinned corpus, four React components issuing
 * `DELETE` behind a user's click, a continuous integration script posting to GitHub, and a sandbox event
 * sink. Each is a real write and none is an agent doing anything.
 */
describe('side-effect-approval-boundary reachability', () => {
  const charge = componentDraft({
    kind: 'external_service',
    name: 'api.stripe.com',
    file: 'src/pay.ts',
    sideEffect: 'financial',
  });
  const uiDelete = componentDraft({
    kind: 'external_service',
    name: 'the host AppSidebar builds at run time',
    file: 'components/app-sidebar.tsx',
    sideEffect: 'destructive',
  });
  const sidebar = componentDraft({
    kind: 'entrypoint',
    name: 'AppSidebar',
    file: 'components/app-sidebar.tsx',
  });

  const outcomeFor = (graph: SystemGraph) => approvalBoundaryRule.evaluate(contextFor(graph));

  it('fires on an operation an agent can reach', () => {
    const outcome = outcomeFor(
      buildGraph(
        [orchestrator, refund, charge],
        [edgeDraft('calls_tool', orchestrator, refund), edgeDraft('calls_service', refund, charge)],
      ),
    );
    assert.equal(outcome.status, 'fired');
    assert.deepEqual(
      outcome.drafts
        .filter((draft) => draft.polarity === 'risk')
        .flatMap((draft) => draft.components)
        .sort(),
      ['external_service:api.stripe.com', 'tool:issue_refund'],
    );
  });

  it('stays quiet about a write no agent, tool or server reaches', () => {
    const outcome = outcomeFor(
      buildGraph([sidebar, uiDelete], [edgeDraft('calls_service', sidebar, uiDelete)]),
    );
    assert.notEqual(outcome.status, 'fired');
    assert.equal(outcome.drafts.length, 0);
  });

  /*
   * Declining is not the same as not looking, and a reader who cannot see the difference has been told
   * less than was known.
   */
  it('says how many consequential operations it declined to report, and why', () => {
    const outcome = outcomeFor(
      buildGraph(
        [orchestrator, refund, sidebar, uiDelete],
        [
          edgeDraft('calls_tool', orchestrator, refund),
          edgeDraft('calls_service', sidebar, uiDelete),
        ],
      ),
    );
    assert.equal(outcome.status, 'fired');
    assert.match(outcome.detail ?? '', /1 consequential operation was left unreported/);
    assert.match(
      outcome.detail ?? '',
      /nothing this scan discovered as an agent, tool or MCP server/,
    );
  });

  /*
   * A tool is model invocable by definition, so it is its own root. A repository that declares tools and
   * has not wired an agent to them yet is the subject of a different rule, not an exemption from this one.
   */
  it('treats a tool as reachable even with no agent wired to it', () => {
    const outcome = outcomeFor(buildGraph([refund], []));
    assert.equal(outcome.status, 'fired');
    assert.deepEqual(outcome.drafts[0]?.components, ['tool:issue_refund']);
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

  /*
   * Nothing in a repository reaches the server its author's editor is configured to talk to, and that is
   * correct rather than a defect. Reported as one, it becomes a finding against the wrong party, which is
   * what a 220 component application got for holding a `.mcp.json`.
   */
  it('does not blame a repository for not reaching a developer tooling server', () => {
    const editorServer = componentDraft({
      kind: 'mcp_server',
      name: 'orchescope',
      file: '.mcp.json',
      details: { for: 'mcp_server', transport: 'stdio', role: 'developer_tooling' },
    });
    const drafts = unreachable(
      buildGraph(
        [orchestrator, refund, editorServer],
        [edgeDraft('calls_tool', orchestrator, refund)],
      ),
    );
    assert.deepEqual(drafts, []);
  });

  it('still reports a server the repository implements and cannot reach', () => {
    const ownServer = componentDraft({
      kind: 'mcp_server',
      name: 'inventory',
      file: 'src/server.ts',
      details: { for: 'mcp_server', transport: 'stdio', role: 'implemented' },
    });
    const drafts = unreachable(
      buildGraph(
        [orchestrator, refund, ownServer],
        [edgeDraft('calls_tool', orchestrator, refund)],
      ),
    );
    assert.equal(drafts.length, 1);
    assert.match(drafts[0]?.title ?? '', /inventory/);
  });
});

/**
 * One call site, one finding, and no absence asserted by a rule that did not look.
 *
 * In all three repositories where both retry rules fired across a thirty six repository sweep, their
 * components and source locations were byte identical. From the outside that reads as one problem counted
 * twice, and it doubled the medium severity count wherever it happened. Separately, both rules asserted an
 * absence, and neither had looked: one named an operation whose sink derives a content addressed key and
 * enforces it with `ON CONFLICT DO NOTHING`, and the other named a codebase that declares its own attempt
 * ceiling.
 */
describe('the two retry rules together', () => {
  const unsafe: EdgePolicy = {
    retry: { bounded: false, backoff: 'unknown', idempotency: 'unknown' },
  };

  it('report one call site once, with the stronger claim keeping it', () => {
    const context = contextFor(graphWith(unsafe));
    const unsafeDrafts = unsafeRetryRule.evaluate(context);
    const unboundedDrafts = unboundedRetryRule.evaluate(context);
    assert.equal(unsafeDrafts.drafts.length, 1, 'the specific rule keeps the call site');
    assert.deepEqual(unboundedDrafts.drafts, [], 'the general rule does not repeat it');
    assert.match(
      unboundedDrafts.detail ?? '',
      /retry-around-non-idempotent-operation reports instead/,
    );
  });

  it('still reports an unbounded retry the other rule has nothing to say about', () => {
    const outcome = unboundedRetryRule.evaluate(contextFor(graphWith(unsafe, lookup)));
    assert.equal(outcome.drafts.length, 1, 'a read only target is not the other rule s business');
    assert.match(outcome.drafts[0]?.title ?? '', /no attempt ceiling/);
  });

  it('asserts no missing key when the operation deduplicates its own effect', () => {
    const outcome = unsafeRetryRule.evaluate(
      contextFor(
        graphWith(unsafe, refund, { deduplicatesAtSink: 'its statement deduplicates on conflict' }),
      ),
    );
    assert.deepEqual(outcome.drafts, []);
    assert.match(outcome.detail ?? '', /deduplicates its own effect/);
  });

  /*
   * `unknown` is the answer discovery gives when it read a write shaped operation and could not tell.
   * Absent is the answer it gives when nothing asked. Reading the second as the first reported a polled
   * HTTP read as possibly unsafe to repeat, because the function it named was an inferred entry point no
   * classifier had ever looked at.
   */
  it('says nothing about an operation no classifier ever looked at', () => {
    const unclassified = componentDraft({
      kind: 'entrypoint',
      name: 'poll_status',
      file: 'src/poll.py',
    });
    const outcome = unsafeRetryRule.evaluate(contextFor(graphWith(unsafe, unclassified)));
    assert.deepEqual(outcome.drafts, []);
  });

  it('asserts no missing ceiling when the operation declares one', () => {
    const outcome = unboundedRetryRule.evaluate(
      contextFor(
        graphWith(unsafe, lookup, { attemptCeiling: 'it declares DELIVERY_MAX_ATTEMPTS' }),
      ),
    );
    assert.deepEqual(outcome.drafts, []);
    assert.match(outcome.detail ?? '', /declares its own ceiling/);
  });

  /*
   * `clear` is a claim: this was checked and was fine. Over an empty population that claim is not weaker
   * than it should be, it is false. One build reported that every discovered retry had an attempt ceiling
   * in a repository where the rule had discovered no retry at all, and a build that had genuinely checked
   * a hundred of them said the same sentence.
   */
  it('does not report an empty population as a population it checked', () => {
    const outcome = unboundedRetryRule.evaluate(contextFor(graphWith(undefined)));
    assert.equal(outcome.status, 'not_applicable');
    assert.match(outcome.detail ?? '', /no retry was examined/);
  });

  it('says how many it looked at when it looked at some and found them well formed', () => {
    const bounded: EdgePolicy = {
      retry: { maxAttempts: 3, bounded: true, backoff: 'fixed', idempotency: 'unknown' },
    };
    const outcome = unboundedRetryRule.evaluate(contextFor(graphWith(bounded, lookup)));
    assert.equal(outcome.status, 'clear');
    assert.match(outcome.detail ?? '', /1 retry examined/);
  });
});

/**
 * A sentence a rule writes about what it decided not to report.
 *
 * `3 consequential operations was left unreported` and `2 runs was recorded` both reached readers. A tool
 * that reasons about grammar less carefully than it reasons about evidence invites a reader to weigh the
 * rest of its output the same way.
 *
 * Two things have to agree here and they agree with different nouns. The verb belongs to the subject,
 * which is singular in every version of this sentence, and the object belongs to the operations, which
 * are as many as were declined. Agreeing both with the count read as `no agent, tool or MCP server reach
 * it` whenever more than one was declined, which is wrong twice in five words.
 */
describe('the sentence a rule writes about what it left alone', () => {
  const declinedFor = (count: number) => {
    const writes = Array.from({ length: count }, (_unused, index) =>
      componentDraft({
        kind: 'external_service',
        name: `writer-${index}`,
        file: `src/write-${index}.ts`,
        sideEffect: 'destructive',
      }),
    );
    /* Reachable from nothing, which is the population this rule declines to report on. */
    return approvalBoundaryRule.evaluate(contextFor(buildGraph(writes, []))).detail ?? '';
  };

  it('agrees with a count of one', () => {
    assert.match(declinedFor(1), /1 consequential operation was left unreported/);
    assert.match(declinedFor(1), /reaches it$/);
  });

  it('agrees with a count of more than one', () => {
    assert.match(declinedFor(3), /3 consequential operations were left unreported/);
    assert.match(declinedFor(3), /reaches them$/);
  });
});

/**
 * A remediation has to name something the reader has.
 *
 * A model behind a published package is configured at its client. One reached by a plain request has no
 * client at all, and telling that reader to set a timeout at the client names a thing absent from the file
 * the finding points at, so the goal cut from it asks an agent to change something it cannot find.
 */
describe('the fix offered for a model call with no timeout', () => {
  const stepsFor = (metadata: Record<string, string>) => {
    const caller = componentDraft({ kind: 'agent', name: 'planner', file: 'src/plan.ts' });
    const model = componentDraft({
      kind: 'model',
      name: 'openai/gpt-4.1-mini',
      file: 'src/plan.ts',
      metadata,
    });
    const outcome = missingTimeoutRule.evaluate(
      contextFor(buildGraph([caller, model], [edgeDraft('invokes_model', caller, model)])),
    );
    return outcome.drafts[0]?.recommendation;
  };

  it('names the abort signal when a JavaScript request reached the model', () => {
    const recommendation = stepsFor({ reachedOver: 'http', language: 'typescript' });
    assert.match(recommendation?.summary ?? '', /no client to configure/);
    assert.ok(
      recommendation?.steps.some((step) => /abort signal/.test(step)),
      `no achievable step among ${JSON.stringify(recommendation?.steps)}`,
    );
  });

  /*
   * Python has no abort signal to pass, so the sentence that serves a `fetch` sends a Python reader
   * looking for something their language does not have. One remediation covering both ecosystems is the
   * same defect as one covering both a client and a request, one level down.
   */
  it('names the timeout argument when a Python request reached the model', () => {
    const recommendation = stepsFor({ reachedOver: 'http', language: 'python' });
    assert.match(recommendation?.summary ?? '', /no client to configure/);
    assert.ok(
      recommendation?.steps.some((step) => /timeout argument/.test(step)),
      `no achievable step among ${JSON.stringify(recommendation?.steps)}`,
    );
    assert.ok(!recommendation?.steps.some((step) => /abort signal/.test(step)));
  });

  it('names the client when there is one to configure', () => {
    const recommendation = stepsFor({});
    assert.ok(recommendation?.steps.some((step) => /Set it at the client/.test(step)));
  });

  it('falls to the signal when a stored scan names no language', () => {
    const recommendation = stepsFor({ reachedOver: 'http' });
    assert.ok(recommendation?.steps.some((step) => /abort signal/.test(step)));
  });
});

/**
 * A rule that could not be cleared.
 *
 * `EdgePolicy.timeoutMs` is what this rule filters on, and until the deadline join every adapter that
 * reads source wrote it nowhere: the only producer in the repository was a hand written manifest. So the
 * rule fired on every repository with a model call in it and no change to any source file, in any
 * language, could answer it, while the goal cut from it asked for exactly that change. A rule needs a
 * test that fires it, a test that proves it stays quiet without evidence, and a test that proves it can
 * be cleared at all. It is the third that was missing, and the third is the one that fails without the
 * join.
 */
describe('model-call-without-timeout', () => {
  const planner = componentDraft({ kind: 'agent', name: 'planner', file: 'src/plan.ts' });
  const model = componentDraft({
    kind: 'model',
    name: 'openai/gpt-4.1-mini',
    file: 'src/plan.ts',
  });
  const invocation = (extra: Partial<EdgeDraft>) =>
    contextFor(buildGraph([planner, model], [edgeDraft('invokes_model', planner, model, extra)]));

  it('fires when the relation declares no deadline', () => {
    const outcome = missingTimeoutRule.evaluate(invocation({}));
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts[0]?.polarity, 'risk');
  });

  it('declines when no model invocation was discovered', () => {
    const outcome = missingTimeoutRule.evaluate(contextFor(buildGraph([planner], [])));
    assert.equal(outcome.status, 'not_applicable');
  });

  it('is cleared by a deadline on the relation', () => {
    const outcome = missingTimeoutRule.evaluate(invocation({ policy: { timeoutMs: 60_000 } }));
    assert.equal(outcome.drafts[0]?.polarity, 'strength');
  });

  it('says whether the deadline was written at the call or at its client', () => {
    const outcome = missingTimeoutRule.evaluate(
      invocation({
        policy: { timeoutMs: 60_000 },
        metadata: { timeoutDeclaredAt: 'client' },
      }),
    );
    assert.match(outcome.drafts[0]?.explanation ?? '', /1 at the client/);
  });

  it('says nothing about where a deadline was written when the relation does not record it', () => {
    const outcome = missingTimeoutRule.evaluate(invocation({ policy: { timeoutMs: 60_000 } }));
    assert.doesNotMatch(outcome.drafts[0]?.explanation ?? '', /call site|client/);
  });
});

/**
 * A status word is a claim, and over an empty population it is a false one.
 *
 * `clear` says this was checked and was fine. Said about a repository where the adapter built no prompt
 * component at all, it reports a limit of this build as a property of the repository, and every sibling
 * rule with an empty population says `not_applicable` in the same document.
 */
describe('what a rule says when it had nothing to look at', () => {
  const promptDraft = (interpolates: boolean) =>
    componentDraft({
      kind: 'prompt',
      name: 'system',
      file: 'src/prompt.ts',
      details: { for: 'prompt', interpolatesUntrustedInput: interpolates },
    });

  it('prompt-injection-boundary declines rather than reporting clear', () => {
    const outcome = promptInjectionBoundaryRule.evaluate(
      contextFor(buildGraph([orchestrator], [])),
    );
    assert.equal(outcome.status, 'not_applicable');
  });

  /*
   * This asserted `clear` until a retrieval application showed what the word costs. The rule joins two
   * populations and 0.4.0 taught it to decline over an empty first one; the second was still answering
   * an all clear having looked in a set it could not see into. A repository whose search results reach
   * its prompt four lines away reads here as one that retrieves nothing, because no adapter in this
   * build claims its search client.
   */
  it('prompt-injection-boundary declines over a source population it could not look in', () => {
    const outcome = promptInjectionBoundaryRule.evaluate(
      contextFor(buildGraph([orchestrator, promptDraft(true)], [])),
    );
    assert.equal(outcome.status, 'not_applicable');
    assert.match(outcome.detail ?? '', /1 prompt interpolates a value/);
    assert.match(outcome.detail ?? '', /no adapter for/);
  });

  it('prompt-injection-boundary fires once both populations are there', () => {
    const outcome = promptInjectionBoundaryRule.evaluate(
      contextFor(buildGraph([orchestrator, promptDraft(true), lookup], [])),
    );
    assert.equal(outcome.status, 'fired');
    assert.equal(outcome.drafts[0]?.polarity, 'risk');
  });

  it('prompt-injection-boundary stays quiet about a prompt that interpolates nothing', () => {
    const outcome = promptInjectionBoundaryRule.evaluate(
      contextFor(buildGraph([orchestrator, promptDraft(false), lookup], [])),
    );
    assert.equal(outcome.status, 'not_applicable');
  });

  it('topology-shape says how much it looked at rather than nothing at all', () => {
    const outcome = architectureShapeRule.evaluate(contextFor(buildGraph([orchestrator], [])));
    assert.notEqual(outcome.status, 'fired');
    assert.match(outcome.detail ?? '', /1 declared component examined/);
  });

  it('topology-shape declines on a graph with nothing declared in it', () => {
    const outcome = architectureShapeRule.evaluate(contextFor(buildGraph([], [])));
    assert.equal(outcome.status, 'not_applicable');
  });

  /*
   * The rule this one mirrors could fire only for a repository that wrote the answer into its own
   * manifest. Proving a rule capable of firing is a different test from proving it fires on the right
   * thing, and this is the first half.
   */
  it('bounded-retry-with-declared-idempotency declines when no retry was discovered', () => {
    const outcome = safeRetryRule.evaluate(contextFor(buildGraph([orchestrator, refund], [])));
    assert.equal(outcome.status, 'not_applicable');
  });

  it('bounded-retry-with-declared-idempotency counts the retries it passed', () => {
    const outcome = safeRetryRule.evaluate(
      contextFor(graphWith({ retry: { bounded: true, backoff: 'fixed', idempotency: 'unknown' } })),
    );
    assert.equal(outcome.status, 'clear');
    assert.match(outcome.detail ?? '', /1 discovered retry examined/);
  });
});

/**
 * One entry per place a finding points at.
 *
 * A finding names the components it is about, and two of them are often the same line: discovery mints a
 * frame to hold an effect and the service that effect reaches at the same call, so both carry it. The
 * list repeated it, which reads as two call sites, and worse, the repeats were counted against the
 * ceiling of ten, so places past the tenth entry were dropped to make room for copies of ones already
 * there. Nine entries for seven places, and ten for eight.
 */
describe('the source locations a finding lists', () => {
  it('names each place once, however many components were minted there', () => {
    const frame = componentDraft({
      kind: 'entrypoint',
      name: 'sendPayment',
      file: 'src/pay.ts',
      line: 12,
      tags: ['entrypoint', INFERRED_ENTRY_POINT_TAG],
    });
    const service = componentDraft({
      kind: 'external_service',
      name: 'payments.example.com',
      file: 'src/pay.ts',
      line: 12,
      sideEffect: 'non_idempotent_write',
    });
    /*
     * The shape a retry around an inline request takes: discovery mints the frame and the service at the
     * same call, and the relation runs from one to the other, so both endpoints of the finding carry the
     * same line.
     */
    const graph = buildGraph(
      [frame, service],
      [
        edgeDraft('calls_service', frame, service, {
          policy: { retry: { bounded: false, backoff: 'none', idempotency: 'unknown' } },
        } as Partial<EdgeDraft>),
      ],
    );
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
      rules: [unsafeRetryRule],
    });
    const finding = result.findingSet.findings.find(
      (entry) => entry.ruleId === 'retry-around-non-idempotent-operation',
    );
    assert.ok(finding !== undefined, 'the retry finding did not survive the engine');
    const listed = finding.sourceLocations.map(
      (location) => `${location.file}:${location.startLine}`,
    );
    assert.deepEqual(
      listed,
      [...new Set(listed)],
      `a place was listed twice: ${listed.join(', ')}`,
    );
    assert.deepEqual(listed, ['src/pay.ts:12'], 'two components at one call are one place');
  });
});
