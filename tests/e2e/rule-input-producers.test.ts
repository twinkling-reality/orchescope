import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { discover } from '../../packages/discovery/src/discover.ts';
import { DEFAULT_RULES } from '../../packages/findings/src/index.ts';
import { createDeadline, fixedClock } from '../../packages/domain/src/index.ts';
import {
  type AgentOperation as AgentOperationName,
  AgentOperation,
  ComponentKind,
  EdgeKind,
  EdgePolicy,
} from '../../packages/schema/src/index.ts';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '../../packages/source-analysis/src/index.ts';
import { componentKindFor } from '../../packages/traces/src/index.ts';

/**
 * Every value a rule reads, and the thing that writes it.
 *
 * A rule selects on a component kind, an edge kind, a relation policy field, a metadata key or a field of
 * `details`. Where only some of the producers write what it selects on, nothing errors: the population is
 * partial or empty, the rule answers `not_applicable` over nothing, and the answer is too quiet in a way
 * only a stranger running the product on their own repository ever notices. `EdgePolicy.timeoutMs` was
 * selected by a rule and written by nothing but a hand written manifest. `retrieval` was one of the three
 * untrusted sources `prompt-injection-boundary` joins on, produced by no adapter, so the rule ran on two
 * thirds of its population for two releases and a retrieval application read as one that retrieves
 * nothing. `EdgePolicy.concurrency` was read at the argument index `new Queue(name, opts)` puts options at
 * and never at the one `new Worker(name, processor, opts)` puts them at.
 *
 * Each was found by a person reading an answer that never moved, which is the most expensive way this
 * repository has of learning anything. The check that replaced that for relation policy fields covered one
 * category of five. This is the other four.
 *
 * Both halves are derived rather than listed. What a rule reads comes from the rule's own source, asked
 * against the enumerations the schema declares, so a rule that starts selecting on something new is a rule
 * this asks about without anyone remembering to add it. What a scan can produce comes from scanning a
 * repository, because a grep for the name proves only that something mentions it. The residue is the two
 * tables below, and each entry names the producer that writes the value and why reading source cannot.
 * A value in neither is a failure, which is the state `retrieval` was in.
 *
 * The fixture is the evidence, so a value that stops being producible fails here rather than going quiet.
 * A kind no fixture reaches reads exactly like a kind no adapter writes, which is the correct polarity: it
 * costs somebody the source that proves the claim.
 */

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * Every source whose vocabulary decides what a rule answers.
 *
 * The four rule files, and the graph analysis they reach through. A rule names most of the kinds it
 * selects on directly, and it delegates the rest: `topology-shape` asks `unreachableComponents` which
 * components participate, and `observability-coverage` reads a rate whose denominator `delta.ts` builds
 * from `isObservableKind`. A kind named only in one of those sets is read exactly as hard as one named in
 * a rule, and reading only the rule files is how `guardrail` and `project` sat unproduced in the set that
 * decides an exercise rate while this file passed.
 *
 * Listed as files rather than as rules because what a rule reads is read out of its own text. A rule
 * family added without a line here is a family this asks nothing about, which is why the set is asserted
 * against the engine's own list before anything else runs.
 */
const RULE_SOURCES = [
  'packages/findings/src/rules/static-policy.ts',
  'packages/findings/src/rules/runtime.ts',
  'packages/findings/src/rules/reconciliation.ts',
  'packages/findings/src/rules/experiments.ts',
  'packages/graph/src/analysis.ts',
] as const;

/**
 * The members of a schema union, which is where the closed vocabularies are declared.
 *
 * TypeBox carries them on the value and not on the type, so this is the one cast in the file, and it is
 * the cast that makes the question come from the schema rather than from a list beside it.
 */
const literalsOf = (schema: unknown): readonly string[] =>
  ((schema as { anyOf?: readonly { const: string }[] }).anyOf ?? []).map((member) => member.const);

/**
 * One repository writing everything the adapters that read source can produce.
 *
 * Assembled from what each framework is actually written like rather than from what would be shortest,
 * because an adapter reads the second and not the first. Nine adapters apply here at once.
 */
const FIXTURE: Readonly<Record<string, string>> = {
  'pyproject.toml': `[project]
name = "producer-fixture"
version = "1.0.0"
dependencies = [
  "pydantic-ai>=1.0",
  "crewai",
  "mcp>=1.0",
  "azure-search-documents",
  "tenacity",
  "httpx",
]
`,
  'package.json': `${JSON.stringify(
    {
      name: 'producer-fixture',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: {
        openai: '^6.0.0',
        bullmq: '^5.0.0',
        axios: '^1.7.0',
        'p-retry': '^6.0.0',
        '@langchain/langgraph': '^0.4.0',
      },
    },
    null,
    2,
  )}\n`,
  // An agent, a tool the tool itself declares needs approval, and the model and provider its string names.
  'src/desk.py': `from dataclasses import dataclass

from pydantic_ai import Agent, RunContext


@dataclass
class Deps:
    customer_id: int


support_agent = Agent(
    'openai:gpt-4.1-mini',
    deps_type=Deps,
    instructions='Answer the customer and judge the risk of the request.',
)


@support_agent.tool(requires_approval=True)
async def issue_refund(ctx: RunContext[Deps], order_id: str) -> str:
    """Refund a charge against the payment gateway."""
    return order_id
`,
  // A group, which is the only shape that produces the kind and the relation that contains its members.
  'crew/team.py': `from crewai import Agent, Crew, Task

researcher = Agent(role="Researcher", goal="Find sources", backstory="A careful reader.")
writer = Agent(role="Writer", goal="Draft the answer", backstory="A concise writer.")

crew = Crew(agents=[researcher, writer], tasks=[Task(description="Answer", agent=researcher)])
`,
  'src/calculator_mcp.py': `from mcp.server import FastMCP

mcp = FastMCP("Calculator")


@mcp.tool(name="calculator")
def calculator(number1: float, number2: float, operator: str) -> str:
    return "0"
`,
  'app/search.py': `from azure.search.documents.aio import SearchClient

search_client = SearchClient(endpoint=ENDPOINT, index_name="gptkbindex", credential=CRED)


async def retrieve(question: str):
    return await search_client.search(search_text=question, top=3)
`,
  // A retry whose whole policy the library states, which is where a declaration rather than a shape is read.
  'app/charge.py': `import httpx
from tenacity import retry, stop_after_attempt, wait_random_exponential


@retry(stop=stop_after_attempt(5), wait=wait_random_exponential())
def charge(body):
    return httpx.post("https://pay.example.com/v1/charges", json=body)
`,
  // A model reached by a plain request, which is the path that records the language its remediation needs.
  'app/ask_raw.py': `import httpx


def ask(prompt: str):
    return httpx.post(
        "https://api.openai.com/v1/chat/completions",
        json={"model": "gpt-4o", "messages": [{"role": "user", "content": prompt}]},
    )
`,
  'src/ask.ts': `import OpenAI from 'openai';

const client = new OpenAI();

export async function answer(prompt: string) {
  return client.chat.completions.create(
    { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] },
    { timeout: 20000 },
  );
}
`,
  // A worker states its concurrency where these libraries put options, which is last, and a queue is written to.
  'src/jobs.ts': `import { Queue, Worker } from 'bullmq';

export const deliveries = new Queue('emails');

export const enqueue = () => deliveries.add('deliver', { id: 1 });

export const worker = new Worker('emails', async () => undefined, { concurrency: 4 });
`,
  // A graph, which is where one agent hands off to the next.
  'src/graph.ts': `import { StateGraph, START, END } from '@langchain/langgraph';

const graph = new StateGraph({ channels: {} });

graph.addNode('planner', planner);
graph.addNode('researcher', researcher);
graph.addNode('writer', writer);

graph.addEdge(START, 'planner');
graph.addEdge('planner', 'researcher');
graph.addEdge('researcher', 'writer');
graph.addEdge('writer', END);

export const app = graph.compile();
`,
  // A retry whose sink deduplicates, which is the evidence that stops a rule asserting the absence of a key.
  'src/outbox.ts': `export const enqueueDelivery = async (): Promise<void> => {
  const statement =
    'INSERT INTO delivery_outbox (id, source_key) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING id';
  await fetch('https://outbox.example.com/query', { method: 'POST', body: statement });
};

export const enqueueWithRetry = async (): Promise<void> => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await enqueueDelivery();
      return;
    } catch {
      void attempt;
    }
  }
};
`,
  'src/deliver.ts': `import pRetry from 'p-retry';

export const postDelivery = async (): Promise<void> => {
  await fetch('https://delivery.example.com/v1/deliveries', { method: 'POST' });
};

export const deliver = () => pRetry(postDelivery, { retries: 4 });
`,
  'src/client.ts': `import axios from 'axios';

export const send = () => axios.post('https://api.example.com/orders', {});
`,
  'packages/worker/wrangler.toml': `name = "events-worker"
main = "src/index.ts"
compatibility_date = "2024-12-18"

[[d1_databases]]
binding = "EVENTS_DB"
database_name = "app-events"
database_id = "c13a8424-bc2c-486c-8b50-9b8748a88b72"
`,
  'packages/worker/src/index.ts': `export const overview = async (env: Env): Promise<unknown> =>
  env.EVENTS_DB.prepare('SELECT value_json FROM settings WHERE key = ?1').first();
`,
  'src/prompt.ts': `const INSTRUCTIONS =
  'You are a careful support assistant. Follow the policy exactly and never invent an order.';

export const build = (retrieved: string) => \`\${INSTRUCTIONS}

Context:
\${retrieved}\`;
`,
};

type Produced = {
  readonly componentKinds: ReadonlySet<string>;
  readonly edgeKinds: ReadonlySet<string>;
  readonly policyFields: ReadonlySet<string>;
  readonly metadataKeys: ReadonlySet<string>;
  readonly detailsFields: ReadonlySet<string>;
};

const workspaces: string[] = [];

after(() => {
  for (const root of workspaces) rmSync(root, { recursive: true, force: true });
});

const scanFixture = async (): Promise<Produced> => {
  const root = mkdtempSync(join(tmpdir(), 'orchescope-producers-'));
  workspaces.push(root);
  for (const [path, contents] of Object.entries(FIXTURE)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, contents, { mode: 0o600 });
  }
  const clock = fixedClock(0);
  const handle = createDeadline(240_000, clock.monotonicMs);
  try {
    const { graph } = await discover({
      root,
      projectName: 'producer-fixture',
      orchescopeVersion: '0.1.0',
      clock,
      deadline: handle,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 500,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 4,
    });
    const componentKinds = new Set<string>();
    const edgeKinds = new Set<string>();
    const policyFields = new Set<string>();
    const metadataKeys = new Set<string>();
    const detailsFields = new Set<string>();
    for (const component of graph.components) {
      componentKinds.add(component.kind);
      for (const key of Object.keys(component.metadata)) metadataKeys.add(key);
      for (const key of Object.keys(component.details ?? {})) detailsFields.add(key);
    }
    for (const edge of graph.edges) {
      edgeKinds.add(edge.kind);
      for (const key of Object.keys(edge.metadata)) metadataKeys.add(key);
      for (const key of Object.keys(edge.policy ?? {})) policyFields.add(key);
    }
    return { componentKinds, edgeKinds, policyFields, metadataKeys, detailsFields };
  } finally {
    handle.dispose();
  }
};

/**
 * What the rules select on, read out of their own source.
 *
 * The enumerated kinds are asked for by name: a rule reaching a kind names its literal, so the question is
 * put to the schema's list and answered by the rule's text. Metadata keys and `details` fields are open
 * sets with no enumeration to ask against, so they are read off the two forms a rule has for reaching one.
 * Both over report rather than under: a name in a comment or on a branch nothing reaches costs an entry in
 * a table below, and a name this misses costs a release.
 */
const readByRules = (): {
  readonly componentKinds: readonly string[];
  readonly edgeKinds: readonly string[];
  readonly policyFields: readonly string[];
  readonly metadataKeys: readonly string[];
  readonly detailsFields: readonly string[];
} => {
  const source = RULE_SOURCES.map((path) => readFileSync(join(repositoryRoot, path), 'utf8')).join(
    '\n',
  );
  const named = (values: readonly string[]): readonly string[] =>
    values.filter((value) => source.includes(`'${value}'`));
  const matched = (pattern: RegExp): readonly string[] => [
    ...new Set([...source.matchAll(pattern)].map((match) => match[1] as string)),
  ];
  return {
    componentKinds: named(literalsOf(ComponentKind)),
    edgeKinds: named(literalsOf(EdgeKind)),
    policyFields: Object.keys(EdgePolicy.properties),
    metadataKeys: matched(/metadata\['([A-Za-z0-9_]+)'\]/g),
    detailsFields: matched(/details[?]?\.([A-Za-z0-9_]+)/g),
  };
};

/**
 * Values a rule reads that a run writes and a scan cannot, with the reason each one is not a defect.
 *
 * A claim about what happened is not answerable from source and is not meant to be. What makes an entry
 * here legitimate is that the rule reading it already refuses to answer without runtime evidence, so its
 * population being empty on a scan is the rule declining rather than the rule failing quietly.
 *
 * The component kinds are not listed. They are read back through the mapping a span goes through, so a
 * kind that stops being reachable from a trace stops being an excuse here.
 */
const WRITTEN_BY_A_RUN: Readonly<Record<string, string>> = {
  guarded_by:
    'derived in packages/traces/src/topology.ts from a span whose operation is an approval, which is the only thing that reports an approval gate was passed',
  reads_memory:
    'derived in packages/traces/src/topology.ts from a span whose operation reads a memory store. No framework here declares a memory store in source, so a run naming one is the only evidence there is',
  writes_memory: 'the same span, on the operations that write rather than read',
  performs_side_effect:
    'derived in packages/traces/src/topology.ts from a span that reports an effect. What source declares is the specific operation, a request or a query, and this is the kind a run reports when it says only that an effect happened',
  observedSideEffect:
    'written by reconciliation in packages/graph/src/reconcile.ts from an effect a run performed, which is the observation permissions-broader-than-observed-use exists to compare a declaration against',
};

/**
 * Values a rule reads that only a person declares.
 *
 * A manifest is a first class input rather than a fallback, so a field nothing infers is not a defect on
 * its own. What makes one fatal is a rule a goal can be cut from filtering on it, because then no edit to
 * any file can close the goal. Which rules are in that position is decided by
 * tests/e2e/goal-eligible-rules.test.ts, which clears each of them by editing a repository.
 */
const DECLARED_BY_A_PERSON: Readonly<Record<string, string>> = {
  requiresApproval:
    'approval is declared on the tool by every framework here that declares it at all, reaching the graph as details.approvalRequired, and the relation level field is what a manifest adds; side-effect-approval-boundary treats it as one of four ways an operation can be guarded rather than the only one',
};

/**
 * Values a rule reads that nothing anywhere writes.
 *
 * Empty, and the assertion is that it stays empty. It held `worker` for one release, alongside `guardrail`
 * and `project`, which this file could not see until it started reading the graph analysis a rule delegates
 * to. All three were component kinds nothing produced, and they are gone from the schema: a worker is an
 * agent whose `details.role` says so, and the other two named nothing at all.
 *
 * An entry here costs a rule the part of its population that value stands for, silently, which is the whole
 * shape this file exists to catch. Adding one is recording a defect rather than fixing it, so it wants a
 * reason nobody can write for long.
 */
const WRITTEN_BY_NOTHING: Readonly<Record<string, string>> = {};

describe('the values a rule reads, and what writes them', () => {
  let produced: Produced;
  let read: ReturnType<typeof readByRules>;

  before(async () => {
    produced = await scanFixture();
    read = readByRules();
  });

  /**
   * The fixture is the denominator every assertion below divides by, so a fixture that quietly stopped
   * reaching an adapter would turn this whole file green by looking at less. Asserted on the shape it is
   * meant to produce rather than on an adapter list, since the list is the thing under test.
   */
  /**
   * The file list above is the only part of the question that is written down, so a rule family added in
   * a file nobody added here would be a family this asks nothing about. Every rule the engine evaluates
   * names itself in its own source, so the engine's list is what decides whether the reading is complete.
   */
  it('reads the source of every rule the engine evaluates', () => {
    const source = RULE_SOURCES.map((path) =>
      readFileSync(join(repositoryRoot, path), 'utf8'),
    ).join('\n');
    const unread = DEFAULT_RULES.map((rule) => rule.id).filter((id) => !source.includes(`'${id}'`));
    assert.deepEqual(
      unread,
      [],
      `${unread.join(', ')} is evaluated and its source is not among the files this reads, so nothing here asks what it selects on`,
    );
  });

  /**
   * The fixture is the denominator every assertion below divides by, so a repository that stopped
   * reaching an adapter would turn this whole file green by looking at less. Either the fixture stopped
   * being written the way that framework is written, or the adapter stopped reading it, and the second is
   * the reason this is asserted rather than assumed.
   */
  it('scans a repository that produces what more than one framework declares', () => {
    for (const kind of ['agent', 'agent_group', 'tool', 'mcp_server', 'retrieval', 'database']) {
      assert.ok(
        produced.componentKinds.has(kind),
        `no ${kind} was produced. Either the fixture no longer writes one or the adapter that reads it went quiet, and every question below is now being answered by a smaller repository than the one this file describes. It produced ${[...produced.componentKinds].sort().join(', ')}`,
      );
    }
  });

  it('produces every component kind the rules select on', () => {
    const traceKinds = new Set<string>();
    for (const operation of literalsOf(AgentOperation)) {
      const kind = componentKindFor(operation as AgentOperationName);
      if (kind !== undefined) traceKinds.add(kind);
    }
    const unproduced = read.componentKinds.filter(
      (kind) =>
        !produced.componentKinds.has(kind) &&
        !traceKinds.has(kind) &&
        WRITTEN_BY_NOTHING[kind] === undefined,
    );
    assert.deepEqual(
      unproduced,
      [],
      `a rule selects on the component kinds ${unproduced.join(', ')} and nothing writes them, so the part of its population they stand for is empty on every repository and no reader can tell`,
    );
  });

  it('produces every edge kind the rules select on', () => {
    const unproduced = read.edgeKinds.filter(
      (kind) =>
        !produced.edgeKinds.has(kind) &&
        WRITTEN_BY_A_RUN[kind] === undefined &&
        WRITTEN_BY_NOTHING[kind] === undefined,
    );
    assert.deepEqual(
      unproduced,
      [],
      `a rule selects on the relation kinds ${unproduced.join(', ')} and no scan produces them`,
    );
  });

  it('produces every relation policy field a relation can carry', () => {
    const unproduced = read.policyFields.filter(
      (field) => !produced.policyFields.has(field) && DECLARED_BY_A_PERSON[field] === undefined,
    );
    assert.deepEqual(
      unproduced,
      [],
      `the relation policy fields no adapter reading source produced are ${unproduced.join(', ')}. A field in this position cannot be cleared by editing a repository, so a rule filtering on it can only ever be answered from a manifest`,
    );
  });

  it('produces every metadata key the rules read', () => {
    const unproduced = read.metadataKeys.filter(
      (key) =>
        !produced.metadataKeys.has(key) &&
        WRITTEN_BY_A_RUN[key] === undefined &&
        WRITTEN_BY_NOTHING[key] === undefined,
    );
    assert.deepEqual(
      unproduced,
      [],
      `a rule reads the metadata keys ${unproduced.join(', ')} and nothing writes them, so the branch behind each one is never taken`,
    );
  });

  it('produces every details field the rules filter on', () => {
    const unproduced = read.detailsFields.filter(
      (field) =>
        !produced.detailsFields.has(field) &&
        WRITTEN_BY_A_RUN[field] === undefined &&
        WRITTEN_BY_NOTHING[field] === undefined,
    );
    assert.deepEqual(
      unproduced,
      [],
      `a rule filters on the details fields ${unproduced.join(', ')} and nothing writes them`,
    );
  });

  /**
   * The half that keeps the tables honest. An entry excusing a value the fixture now produces is an
   * excuse nobody needs, and leaving it there is how the next unproduced value gets waved through on a
   * reason that was true once.
   */
  it('excuses nothing a scan can produce', () => {
    const producedAnyway = [
      ...Object.keys(WRITTEN_BY_A_RUN),
      ...Object.keys(DECLARED_BY_A_PERSON),
      ...Object.keys(WRITTEN_BY_NOTHING),
    ].filter(
      (value) =>
        produced.componentKinds.has(value) ||
        produced.edgeKinds.has(value) ||
        produced.policyFields.has(value) ||
        produced.metadataKeys.has(value) ||
        produced.detailsFields.has(value),
    );
    assert.deepEqual(
      producedAnyway,
      [],
      `${producedAnyway.join(', ')} is excused above and a scan produces it, so the reason recorded beside it is no longer true`,
    );
  });
});
