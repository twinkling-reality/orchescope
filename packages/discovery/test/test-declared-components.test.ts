import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock, partOfAuditedSystem } from '@orchescope/domain';
import type { SystemGraph } from '@orchescope/schema';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';
import { DEFAULT_ADAPTERS } from '../src/registry.ts';

/**
 * What each adapter does with a repository whose only source is a test file.
 *
 * The invariant that a developer's tooling is not the system under audit was honoured by four adapters
 * out of thirteen, and the nine that ignored it were most of the graph on every framework this build
 * reads: 835 of 903 `pydantic-ai` components, 662 of 899 `openai-agents` ones, 448 of 526 on `langgraph`.
 * On one application built with `pydantic-ai` it was ten of the sixteen agents reported, three of them
 * copies of one `_make_test_agent` helper and two of them local variables in a test about teams.
 *
 * The thirteen reach the invariant two ways and both are correct for what they read. An adapter that
 * would record a false fact declines to read the file at all: a test harness reaches the same clients the
 * system reaches and it reaches them at fakes, so a `FakeD1` over `node:sqlite` is not a database the
 * repository has. An adapter that would record a true fact about something out of scope reads it and
 * marks it, because a test that declares an agent has declared one and a count that silently omits it
 * answers a question nobody asked.
 *
 * So the assertion is the invariant rather than either mechanism: nothing a rule reads may come out of a
 * repository whose only source is a test file. Each fixture is scanned twice, once written where the
 * system lives and once written where its tests live, and the first scan is what proves the second is
 * measuring something.
 *
 * Enumerated from the registry, since an adapter added later is an adapter this asks about without anyone
 * remembering to add it, and being remembered by nine authors out of thirteen is how the invariant came
 * to be honoured by four.
 */

const traversal = {
  maxFileBytes: 512 * 1024,
  maxFiles: 500,
  followSymlinks: false,
  excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  excludePrefixes: [],
};

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>): Promise<SystemGraph> => {
  const workspace = createTempWorkspace('orchescope-test-declared-');
  workspaces.push(workspace);
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const handle = createDeadline(120_000, clock.monotonicMs);
  try {
    const { graph } = await discover({
      root: workspace.root,
      projectName: 'fixture',
      orchescopeVersion: '0.1.0',
      clock,
      deadline: handle,
      traversal,
      concurrency: 4,
    });
    return graph;
  } finally {
    handle.dispose();
  }
};

const PYPROJECT = (name: string, dependencies: readonly string[]): string =>
  `[project]\nname = "${name}"\nversion = "1.0.0"\ndependencies = [\n${dependencies
    .map((entry) => `  "${entry}",`)
    .join('\n')}\n]\n`;

const PACKAGE_JSON = (name: string, dependencies: Record<string, string> = {}): string =>
  `${JSON.stringify({ name, version: '1.0.0', private: true, type: 'module', dependencies }, null, 2)}\n`;

/**
 * One repository per adapter: what stays put, and the one file that moves.
 *
 * The manifest declares the framework exactly as a repository using it would, so an adapter that declines
 * for want of a dependency is not what is being measured. `sourcePath` and `testPath` hold the same bytes
 * and differ only in where a reader would look for them, which is the whole of what this asks about.
 */
type Fixture = {
  readonly adapterId: string;
  readonly fixed: Readonly<Record<string, string>>;
  readonly sourcePath: string;
  readonly testPath: string;
  readonly code: string;
};

const FIXTURES: readonly Fixture[] = [
  {
    adapterId: 'adapter:openai-agents',
    fixed: { 'pyproject.toml': PYPROJECT('agents-app', ['openai-agents']) },
    sourcePath: 'src/desk.py',
    testPath: 'tests/test_desk.py',
    code: `from agents import Agent

support = Agent(name="Support", instructions="Answer the customer.")
`,
  },
  {
    adapterId: 'adapter:langgraph',
    fixed: {
      'package.json': PACKAGE_JSON('graph-app', { '@langchain/langgraph': '^0.4.0' }),
    },
    sourcePath: 'src/graph.ts',
    testPath: 'src/graph.test.ts',
    code: `import { StateGraph, START, END } from '@langchain/langgraph';

const graph = new StateGraph({ channels: {} });
graph.addNode('planner', planner);
graph.addNode('writer', writer);
graph.addEdge(START, 'planner');
graph.addEdge('planner', 'writer');
graph.addEdge('writer', END);
export const app = graph.compile();
`,
  },
  {
    adapterId: 'adapter:langchain-v1-create-agent',
    fixed: { 'pyproject.toml': PYPROJECT('langchain-app', ['langchain>=1.0']) },
    sourcePath: 'src/support.py',
    testPath: 'tests/test_support.py',
    code: `from langchain.agents import create_agent

support_agent = create_agent(model="openai:gpt-4.1-mini", tools=[], name="support")
`,
  },
  {
    adapterId: 'adapter:crewai',
    fixed: { 'pyproject.toml': PYPROJECT('crew-app', ['crewai']) },
    sourcePath: 'src/team.py',
    testPath: 'tests/test_team.py',
    code: `from crewai import Agent, Crew, Task

researcher = Agent(role="Researcher", goal="Find sources", backstory="A careful reader.")
crew = Crew(agents=[researcher], tasks=[Task(description="Answer", agent=researcher)])
`,
  },
  {
    adapterId: 'adapter:pydantic-ai',
    fixed: { 'pyproject.toml': PYPROJECT('pai-app', ['pydantic-ai>=1.0']) },
    sourcePath: 'src/support.py',
    testPath: 'tests/test_support.py',
    code: `from pydantic_ai import Agent

support_agent = Agent('openai:gpt-4.1-mini', instructions='Answer the customer.')


@support_agent.tool_plain
def business_hours() -> str:
    """Return the hours support is staffed."""
    return "09:00 to 17:00"
`,
  },
  {
    adapterId: 'adapter:vercel-ai-sdk',
    fixed: { 'package.json': PACKAGE_JSON('sdk-app', { ai: '^7.0.0' }) },
    sourcePath: 'src/answer.ts',
    testPath: 'src/answer.test.ts',
    code: `import { generateText } from 'ai';

export const answer = (prompt: string) =>
  generateText({ model: 'openai/gpt-4o-mini', prompt, tools: {} });
`,
  },
  {
    adapterId: 'adapter:model-sdk',
    fixed: { 'package.json': PACKAGE_JSON('sdk-raw', { openai: '^6.0.0' }) },
    sourcePath: 'src/ask.ts',
    testPath: 'src/ask.test.ts',
    code: `import OpenAI from 'openai';

const client = new OpenAI();

export const answer = (prompt: string) =>
  client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
  });
`,
  },
  {
    adapterId: 'adapter:mcp',
    fixed: { 'pyproject.toml': PYPROJECT('mcp-app', ['mcp>=1.0']) },
    sourcePath: 'src/calculator.py',
    testPath: 'tests/test_calculator.py',
    code: `from mcp.server import FastMCP

mcp = FastMCP("Calculator")


@mcp.tool(name="calculator")
def calculator(number1: float, number2: float) -> str:
    return "0"
`,
  },
  {
    adapterId: 'adapter:search-index',
    fixed: { 'pyproject.toml': PYPROJECT('search-app', ['azure-search-documents']) },
    sourcePath: 'app/search.py',
    testPath: 'tests/test_search.py',
    code: `from azure.search.documents.aio import SearchClient

search_client = SearchClient(endpoint=ENDPOINT, index_name="gptkbindex", credential=CRED)


async def retrieve(question: str):
    return await search_client.search(search_text=question, top=3)
`,
  },
  {
    adapterId: 'adapter:effects',
    fixed: { 'package.json': PACKAGE_JSON('effects-app') },
    sourcePath: 'src/charge.ts',
    testPath: 'src/charge.test.ts',
    code: `export const charge = (body: unknown) =>
  fetch('https://pay.example.com/v1/charges', { method: 'POST', body: JSON.stringify(body) });
`,
  },
  {
    adapterId: 'adapter:prompts',
    fixed: { 'package.json': PACKAGE_JSON('prompt-app', { openai: '^6.0.0' }) },
    sourcePath: 'src/prompt.ts',
    testPath: 'src/prompt.test.ts',
    code: `import OpenAI from 'openai';

const client = new OpenAI();

const INSTRUCTIONS =
  'You are a careful support assistant. Follow the policy exactly and never invent an order.';

export const answer = (value: string) =>
  client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: \`\${INSTRUCTIONS}

Context:
\${value}\` }],
  });
`,
  },
  {
    adapterId: 'adapter:workers-bindings',
    fixed: {
      'package.json': PACKAGE_JSON('worker-app'),
      'wrangler.toml': `name = "events-worker"
main = "src/index.ts"
compatibility_date = "2024-12-18"

[[d1_databases]]
binding = "EVENTS_DB"
database_name = "app-events"
database_id = "c13a8424-bc2c-486c-8b50-9b8748a88b72"
`,
    },
    sourcePath: 'src/index.ts',
    testPath: 'src/index.test.ts',
    code: `export const overview = async (env: Env): Promise<unknown> =>
  env.EVENTS_DB.prepare('SELECT value_json FROM settings WHERE key = ?1').first();
`,
  },
  {
    adapterId: 'adapter:implementation-reach',
    fixed: { 'pyproject.toml': PYPROJECT('reach-app', ['pydantic-ai>=1.0', 'httpx']) },
    sourcePath: 'src/desk.py',
    testPath: 'tests/test_desk.py',
    code: `import httpx
from pydantic_ai import Agent, RunContext

support_agent = Agent('openai:gpt-4.1-mini', instructions='Answer the customer.')


@support_agent.tool
async def lookup_order(ctx: RunContext[None], order_id: str) -> str:
    """Look up an order in the order service."""
    return httpx.get("https://orders.example.com/v1/orders").text
`,
  },
];

/**
 * The one adapter with nothing to assert here, for a stated reason rather than because nobody wrote one.
 *
 * `manifest` reads `.orchescope/manifest.yaml`, which a person writes on purpose to describe their own
 * system. A manifest inside a test directory is not a shape that occurs, and a declaration a person made
 * deliberately is not something to set aside on the strength of where the file sits.
 */
const NOTHING_TO_DECLARE: readonly string[] = ['adapter:manifest'];

/**
 * What one adapter contributed that carries a place in the source.
 *
 * Relations count, and for `implementation-reach` they are all of it: that adapter declares no component
 * of its own and joins ones other adapters declared, so measuring it on components alone would measure
 * nothing and pass.
 */
const contributedBy = (graph: SystemGraph, adapterId: string) => ({
  components: graph.components.filter(
    (component) =>
      component.discoveredBy.includes(adapterId) && component.sourceLocations.length > 0,
  ),
  edges: graph.edges.filter(
    (edge) => edge.discoveredBy.includes(adapterId) && edge.sourceLocations.length > 0,
  ),
});

describe('a repository whose only source is a test file', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.adapterId} judges nothing it read from one`, async () => {
      const asSource = await scan({ ...fixture.fixed, [fixture.sourcePath]: fixture.code });
      const fromSource = contributedBy(asSource, fixture.adapterId);
      assert.ok(
        fromSource.components.length + fromSource.edges.length > 0,
        `${fixture.adapterId} contributed nothing from ${fixture.sourcePath}, so moving that file to a test directory proves nothing. The scan produced ${asSource.components.map((component) => component.id).join(', ') || 'no component'}`,
      );

      const asTest = await scan({ ...fixture.fixed, [fixture.testPath]: fixture.code });
      const fromTest = contributedBy(asTest, fixture.adapterId);
      assert.deepEqual(
        fromTest.components
          .filter(partOfAuditedSystem)
          .map((component) => `${component.id} at ${component.sourceLocations[0]?.file}`),
        [],
        `${fixture.adapterId} read ${fixture.testPath} and left what it found in the population the rules judge, so a fixture is reported as though the repository shipped it`,
      );
      assert.deepEqual(
        fromTest.edges
          .filter((edge) => edge.declaredInTest !== true)
          .map((edge) => `${edge.id} at ${edge.sourceLocations[0]?.file}`),
        [],
        `${fixture.adapterId} drew these relations inside ${fixture.testPath} and did not mark them, so a rule whose population is relations judges a fixture`,
      );
    });
  }

  /*
   * The half that makes this a check rather than a list. An adapter added without a repository here is an
   * adapter nothing asks, which is the position nine of the thirteen were in.
   */
  it('has a repository for every adapter that declares a component', () => {
    const covered = new Set([...FIXTURES.map((entry) => entry.adapterId), ...NOTHING_TO_DECLARE]);
    const missing = DEFAULT_ADAPTERS.map((adapter) => adapter.id).filter((id) => !covered.has(id));
    assert.deepEqual(
      missing,
      [],
      `${missing.join(', ')} can declare a component and nothing here asks what it does with a test file`,
    );
  });

  it('counts what it set aside in the coverage block', async () => {
    const graph = await scan({
      'pyproject.toml': PYPROJECT('pai-app', ['pydantic-ai>=1.0']),
      'tests/test_support.py': `from pydantic_ai import Agent

support_agent = Agent('openai:gpt-4.1-mini', instructions='Answer the customer.')
`,
    });
    const marked = graph.components.filter((component) => component.declaredInTest === true);
    assert.ok(marked.length > 0, 'the fixture produced nothing to count');
    assert.equal(
      graph.coverage.componentsDeclaredInTest,
      marked.length,
      'the coverage block has to carry the count, because a population smaller than the graph with no number beside it is a difference a reader cannot see',
    );
  });

  /**
   * The case the marking has to get right, and the reason it is derived where the locations merge.
   *
   * A model named by the system and by a test that exercises it is one component carrying both locations,
   * and it is a model the system invokes. Asked of the first location alone the answer depends on which
   * file the scan reached first, and asked of any single adapter's view it depends on which adapter ran.
   */
  it('does not set aside a component the source declares as well', async () => {
    const code = `from pydantic_ai import Agent

support_agent = Agent('openai:gpt-4.1-mini', instructions='Answer the customer.')
`;
    const graph = await scan({
      'pyproject.toml': PYPROJECT('both', ['pydantic-ai>=1.0']),
      'src/support.py': code,
      'tests/test_support.py': code,
    });
    const model = graph.components.find(
      (component) => component.id === 'model:openai/gpt-4.1-mini',
    );
    assert.ok(model !== undefined, 'the model was not discovered at all');
    assert.equal(
      model.sourceLocations.length,
      2,
      'this asserts nothing unless both declarations reached one component',
    );
    assert.notEqual(
      model.declaredInTest,
      true,
      'a component the source declares is part of the system however many tests also declare it',
    );
    assert.equal(partOfAuditedSystem(model), true);
  });
});
