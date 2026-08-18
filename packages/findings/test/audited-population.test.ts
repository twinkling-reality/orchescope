import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexGraph } from '@orchescope/graph';
import type { SystemGraph } from '@orchescope/schema';
import { buildGraph, componentDraft, edgeDraft } from '@orchescope/testkit';
import type { RuleContext } from '../src/rule.ts';
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
