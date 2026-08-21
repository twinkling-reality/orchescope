import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeDelta, indexGraph } from '@orchescope/graph';
import type { RunRecord, SystemGraph } from '@orchescope/schema';
import { buildGraph, componentDraft, edgeDraft } from '@orchescope/testkit';
import { DEFAULT_RULES } from '../src/index.ts';
import type { Rule, RuleContext } from '../src/rule.ts';
import {
  architectureShapeRule,
  missingTimeoutRule,
  promptInjectionBoundaryRule,
  unusedConfiguredToolRule,
} from '../src/rules/static-policy.ts';

/**
 * What a rule does with a population that exists and is entirely fixtures.
 *
 * A rule about the system under audit and a rule about the graph have different populations, and until
 * these the difference was unstated: `configured-tool-has-no-caller` reported 228 tools with no caller on
 * `openai-agents-python` where 214 were fixtures, and on `langgraph` the only three tools this build finds
 * are `get_weather` doubles under `libs/prebuilt/tests`.
 *
 * Narrowing a population is worth less than nothing if the rule then reports the wrong reason for the
 * emptiness. "No tool was discovered" is false about a repository whose tests are full of them, and it
 * sends a reader somewhere they will find nothing, so each of these asserts the sentence and not only the
 * status.
 */

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

const agent = componentDraft({ kind: 'agent', name: 'orchestrator', file: 'src/main.ts' });

const fixtureTool = componentDraft({
  kind: 'tool',
  name: 'get_weather',
  file: 'libs/prebuilt/tests/test_react_agent.py',
});

const shippedTool = componentDraft({ kind: 'tool', name: 'issue_refund', file: 'src/refund.ts' });

const interpolatingPrompt = componentDraft({
  kind: 'prompt',
  name: 'system_prompt',
  file: 'src/prompt.ts',
  details: { for: 'prompt', interpolatesUntrustedInput: true },
});

describe('a population that exists and is entirely declared in tests', () => {
  it('tells configured-tool-has-no-caller that the tools are fixtures, not that there are none', () => {
    const outcome = unusedConfiguredToolRule.evaluate(contextFor(buildGraph([agent, fixtureTool])));
    assert.equal(outcome.status, 'not_applicable');
    assert.match(outcome.detail ?? '', /a test file declares every one of them/);
    assert.doesNotMatch(
      outcome.detail ?? '',
      /no tool was discovered/,
      'the repository declares a tool, and saying otherwise sends a reader looking for something they will not find',
    );
  });

  it('still judges a tool the source declares beside one a test declares', () => {
    const outcome = unusedConfiguredToolRule.evaluate(
      contextFor(buildGraph([agent, fixtureTool, shippedTool])),
    );
    assert.equal(outcome.status, 'fired');
    const named = outcome.drafts.flatMap((draft) => draft.components);
    assert.ok(
      named.some((id) => id.includes('issue_refund')),
      'the tool the repository ships is the one this rule exists to report',
    );
    assert.ok(
      !named.some((id) => id.includes('get_weather')),
      'a fixture reported beside it is the noise that made this rule unreadable at scale',
    );
  });

  it('tells prompt-injection-boundary the sources are fixtures, not that none was discovered', () => {
    const outcome = promptInjectionBoundaryRule.evaluate(
      contextFor(buildGraph([agent, interpolatingPrompt, fixtureTool])),
    );
    assert.equal(outcome.status, 'not_applicable');
    assert.match(outcome.detail ?? '', /declared in a test file/);
  });

  /**
   * The defect the first version of this shipped with, caught by running it on a pinned repository.
   *
   * The reason was derived as the whole population minus the audited one, and on `gpt-researcher` the one
   * source declined over is an MCP server named in a `.mcp.json` for somebody's editor, with no source
   * location at all. The sentence blamed a test file for an exclusion no test file had anything to do
   * with, which is the same defect in miniature as the one this whole change is about: a number reported
   * with a cause nobody established.
   */
  it('does not blame a test file for a component excluded as another tool of the developer', () => {
    const editorServer = componentDraft({
      kind: 'mcp_server',
      name: 'gpt-researcher',
      file: 'src/main.ts',
      details: { for: 'mcp_server', role: 'developer_tooling', transport: 'stdio' },
    });
    const outcome = promptInjectionBoundaryRule.evaluate(
      contextFor(buildGraph([agent, interpolatingPrompt, editorServer])),
    );
    assert.equal(outcome.status, 'not_applicable');
    assert.doesNotMatch(
      outcome.detail ?? '',
      /test file/,
      'no test file is involved, and naming one is a cause this rule never established',
    );
    assert.match(outcome.detail ?? '', /does not belong to the system under audit/);
  });

  it('tells model-call-without-timeout the calls are fixtures', () => {
    const fixtureAgent = componentDraft({
      kind: 'agent',
      name: 'test_agent',
      file: 'tests/test_desk.py',
    });
    const model = componentDraft({ kind: 'model', name: 'gpt-4o', file: 'tests/test_desk.py' });
    const outcome = missingTimeoutRule.evaluate(
      contextFor(
        buildGraph(
          [fixtureAgent, model],
          [
            edgeDraft('invokes_model', fixtureAgent, model, {
              // Where a scan puts it, which is what decides whether the rule can name the cause.
              sourceLocations: [{ file: 'tests/test_desk.py', startLine: 4 }],
            }),
          ],
        ),
      ),
    );
    assert.equal(outcome.status, 'not_applicable');
    assert.match(outcome.detail ?? '', /a test file declares every one of them/);
  });

  it('does not report a fixture as a component no entry point reaches', () => {
    const stranded = componentDraft({
      kind: 'tool',
      name: 'stranded_fixture',
      file: 'tests/test_tools.py',
    });
    const model = componentDraft({ kind: 'model', name: 'gpt-4o', file: 'src/main.ts' });
    const outcome = architectureShapeRule.evaluate(
      contextFor(buildGraph([agent, model, stranded], [edgeDraft('invokes_model', agent, model)])),
    );
    const unreachable = outcome.drafts.filter((draft) => draft.tags?.includes('unreachable'));
    assert.deepEqual(
      unreachable.flatMap((draft) => draft.components),
      [],
      'a tool only a test declares is not wiring the repository is missing',
    );
  });
});

/**
 * Every rule, asked about a repository whose declarations are all fixtures.
 *
 * Option three put the filtering where the question is asked, which meant eight populations decided one
 * at a time by hand. Deciding them by hand is fine; leaving nothing to check them is how this defect class
 * works. A rule added later that forgets to narrow its population fails in the one direction nobody can
 * see, and so did one that was there all along: the reconciliation delta never asked the question, so on
 * `pydantic-ai` with a run in it 871 of the 958 components in the exercise fraction were declared in a
 * test file and `declared-not-exercised` named some five hundred fixtures as declarations no run reached.
 *
 * So the assertion is not per rule and not per population. One system is written twice, once where a
 * system lives and once where its tests live, and every rule the engine evaluates has to answer the second
 * exactly as it answers a repository that declares nothing at all. The shipped scan is what proves the
 * fixture scan is measuring something: a rule that says nothing about either is a rule this proves nothing
 * about, and those are listed below with the reason rather than counted as covered.
 */

const RUN_ID = 'run_0000000000000001';
const observedRun = {
  run: { id: RUN_ID } as RunRecord,
  componentMetrics: [],
};

/**
 * One system, and the only difference is the directory its files are in.
 *
 * Written to reach every rule that reads a declared population: a model call with no deadline, a retry in
 * front of a write nothing makes safe to repeat, a tool nothing calls, a prompt that interpolates beside a
 * source nobody can vouch for, a consequential operation with no approval in front of it, and a datastore
 * that ran holding write access. `runIds` is set because an exercise rate is only computed for a graph that
 * claims a run, and that rate is the one thing `observability-coverage` reads.
 */
const systemIn = (directory: string): SystemGraph => {
  const at = (name: string) => `${directory}/${name}`;
  const orchestrator = componentDraft({ kind: 'agent', name: 'orchestrator', file: at('main.ts') });
  const researcher = componentDraft({ kind: 'agent', name: 'researcher', file: at('worker.ts') });
  const model = componentDraft({ kind: 'model', name: 'gpt-4o', file: at('main.ts') });
  const refund = componentDraft({
    kind: 'tool',
    name: 'issue_refund',
    file: at('refund.ts'),
    sideEffect: 'financial',
  });
  const orphan = componentDraft({ kind: 'tool', name: 'baggage_tool', file: at('tools.ts') });
  const prompt = componentDraft({
    kind: 'prompt',
    name: 'system_prompt',
    file: at('prompt.ts'),
    details: { for: 'prompt', interpolatesUntrustedInput: true },
  });
  const server = componentDraft({
    kind: 'mcp_server',
    name: 'files',
    file: at('mcp.ts'),
    details: { for: 'mcp_server', role: 'implemented', transport: 'stdio' },
  });
  const gateway = componentDraft({
    kind: 'external_service',
    name: 'pay.example.com',
    file: at('pay.ts'),
    sideEffect: 'non_idempotent_write',
  });
  // Ran, and holds write access, which is the pair permissions-broader-than-observed-use matches on.
  const orders = {
    ...componentDraft({
      kind: 'database',
      name: 'orders',
      file: at('store.ts'),
      permissions: [{ kind: 'database' as const, scope: 'orders', mode: 'write' as const }],
    }),
    presence: { static: true, runtime: true, manifest: false },
  };
  const where = [{ file: at('main.ts'), startLine: 1 }];
  return buildGraph(
    [orchestrator, researcher, model, refund, orphan, prompt, server, gateway, orders],
    [
      edgeDraft('invokes_model', orchestrator, model, { sourceLocations: where }),
      edgeDraft('calls_tool', orchestrator, refund, { sourceLocations: where }),
      edgeDraft('hands_off_to', orchestrator, researcher, { sourceLocations: where }),
      edgeDraft('uses_prompt', orchestrator, prompt, { sourceLocations: where }),
      edgeDraft('provides_tool', server, refund, { sourceLocations: where }),
      edgeDraft('calls_service', researcher, gateway, {
        sourceLocations: where,
        policy: {
          retry: { maxAttempts: 3, bounded: true, backoff: 'fixed', idempotency: 'absent' },
        },
      }),
      edgeDraft('queries_database', researcher, orders, { sourceLocations: where }),
    ],
    { runIds: [RUN_ID] },
  );
};

/**
 * The delta comes from the production path rather than a literal, because the defect was in the delta.
 *
 * A hand written delta would have agreed with whatever the test author believed, which is the circularity
 * this repository's corpus exists to break. `computeDelta` is what an audit runs.
 */
const reconciledContext = (graph: SystemGraph): RuleContext => ({
  graph: indexGraph(graph),
  delta: computeDelta({ graph, runs: [], spanToComponent: new Map() }).delta,
  observedRuns: [observedRun],
  silentRuns: [],
  benchmarks: [],
  chaosReports: [],
  scenarios: [],
  evidenceById: new Map(),
});

/** Status and how many findings, which is the whole of what a reader is told about a repository. */
const answerOf = (rule: Rule, graph: SystemGraph): string => {
  const outcome = rule.evaluate(reconciledContext(graph));
  return `${outcome.status}, ${outcome.drafts.length} finding(s)`;
};

/**
 * Rules the fixture above cannot move, each for a reason rather than because nobody wrote a case.
 *
 * What they have in common is that none of them reads a population of declared components. A rule keyed on
 * what a run reported, on a benchmark or on a chaos suite cannot report a fixture, because a fixture is
 * exactly the thing no run reaches.
 */
const NOT_MOVED_BY_A_DECLARATION: Readonly<Record<string, string>> = {
  'exercised-not-declared':
    'its population is components a run named and nothing declared, which carry no source location and so can never be marked',
  'observed-name-carries-no-identity': 'keyed on observed names that matched no declaration',
  'observed-name-matches-many-declarations':
    'keyed on observed names the reconciler matched to several declarations, which no fixture reaches because no run reaches a fixture',
  'declaration-contradicted-by-observation': 'keyed on contradictions a run produced',
  'duplicate-side-effect': 'keyed on the side effect records of a run',
  'independent-calls-run-sequentially': 'keyed on the order a run performed operations in',
  'latency-concentrated-in-one-component': 'keyed on per component durations a run measured',
  'tokens-concentrated-in-one-component': 'keyed on per component token counts a run measured',
  'workers-receive-comparably-large-context': 'keyed on the context sizes a run measured',
  'relation-fails-often': 'keyed on the failure counts a run measured per relation',
  'agent-count-does-not-pay-for-itself': 'keyed on an agent count benchmark',
  'throughput-saturates-under-concurrency': 'keyed on a concurrency benchmark',
  'resilience-under-injected-fault': 'keyed on a chaos suite',
};

describe('every rule, over a repository whose declarations are all fixtures', () => {
  const shipped = systemIn('src');
  const fixtures = systemIn('tests');
  const nothing = buildGraph([], []);

  for (const rule of DEFAULT_RULES) {
    if (NOT_MOVED_BY_A_DECLARATION[rule.id] !== undefined) continue;
    it(`${rule.id} answers as it does on a repository that declares nothing`, () => {
      assert.notEqual(
        answerOf(rule, shipped),
        answerOf(rule, nothing),
        `${rule.id} answers the same on a system and on nothing at all, so what this asserts below is that two silences match. Either the fixture stopped reaching it or it belongs in the table of rules no declaration moves`,
      );
      assert.equal(
        answerOf(rule, fixtures),
        answerOf(rule, nothing),
        `${rule.id} judges a repository whose every declaration is in a test file differently from one that declares nothing, so it is reporting a fixture as though the repository shipped it`,
      );
    });
  }

  /*
   * The half that keeps the table honest. A rule listed as unmovable that this fixture does move is a
   * reason that was true once, and a rule quietly dropping out of the covered set is how a check like this
   * turns into two silences agreeing with each other.
   */
  it('names every rule no declaration moves, and no others', () => {
    const unmoved = DEFAULT_RULES.filter(
      (rule) => answerOf(rule, shipped) === answerOf(rule, nothing),
    ).map((rule) => rule.id);
    assert.deepEqual(
      unmoved.sort(),
      Object.keys(NOT_MOVED_BY_A_DECLARATION).sort(),
      'the rules this fixture cannot move are not the ones recorded as unmovable',
    );
  });
});
