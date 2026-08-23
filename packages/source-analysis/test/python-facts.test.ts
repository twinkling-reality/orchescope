import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dotted,
  findEntry,
  identifierItems,
  numberValue,
  objectArgument,
  stringValue,
} from '../src/facts.ts';
import { analyzePython } from '../src/python/analyze.ts';

const analyze = (text: string, file = 'src/agents/triage.py') =>
  analyzePython({ file, text, contentHash: 'b'.repeat(64) });

describe('python fact extraction', () => {
  it('records plain, aliased and from imports', async () => {
    const facts = await analyze(`
import openai
import anthropic as claude
from agents import Agent, function_tool
from .tools import refund as issue_refund
`);
    assert.deepEqual(facts.parseErrors, []);
    const byLocal = new Map(facts.imports.map((entry) => [entry.local, entry]));
    assert.equal(byLocal.get('openai')?.module, 'openai');
    assert.equal(byLocal.get('openai')?.imported, '*');
    assert.equal(byLocal.get('claude')?.module, 'anthropic');
    assert.equal(byLocal.get('Agent')?.module, 'agents');
    assert.equal(byLocal.get('Agent')?.imported, 'Agent');
    assert.equal(byLocal.get('issue_refund')?.module, '.tools');
    assert.equal(byLocal.get('issue_refund')?.imported, 'refund');
  });

  it('folds keyword arguments into an object argument', async () => {
    const facts = await analyze(`
from agents import Agent

triage = Agent(
    name="triage",
    instructions="Route the request to the right worker and never invent an order number.",
    tools=[lookup_account, check_inventory],
    handoffs=[refund_agent],
    model_settings={"temperature": 0.2},
)
`);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'Agent');
    assert.ok(call, 'expected an Agent call');
    assert.equal(call.origin?.module, 'agents');
    const entries = objectArgument(call);
    assert.equal(stringValue(findEntry(entries, 'name')?.value), 'triage');
    assert.deepEqual(identifierItems(findEntry(entries, 'tools')?.value), [
      'lookup_account',
      'check_inventory',
    ]);
    const settings = findEntry(entries, 'model_settings')?.value;
    assert.equal(settings?.kind, 'object');
    if (settings?.kind === 'object') {
      assert.equal(findEntry(settings.entries, 'temperature')?.value.kind, 'number');
    }
    const variable = facts.definitions.find((definition) => definition.name === 'triage');
    assert.deepEqual(variable?.initializer, ['Agent']);
  });

  /*
   * A keyword object at the index nobody looks at.
   *
   * The parser reports a `**` splat and a comment as named children of the argument list, and both were
   * being counted as positional arguments, so the keyword object moved along one slot per note or
   * passthrough. `create(  # a note\n model=..., timeout=..., **overrides)` reduced to two unknown
   * arguments followed by the keywords, and every adapter that asks a call what it was configured with
   * reads the first argument. Four of the five provider call sites in one field report's target
   * repository were unreadable for this and nothing else: the model was reported as unspecified and the
   * deadline written at the call was invisible.
   */
  it('keeps the keyword object first when a call passes a dictionary through', async () => {
    const facts = await analyze(`
client.embeddings.create(model="text-embedding-3-large", input=text, timeout=60.0, **overrides)
`);
    const call = facts.calls.find(
      (candidate) => dotted(candidate.calleePath) === 'client.embeddings.create',
    );
    assert.ok(call, 'expected the create call');
    const entries = objectArgument(call);
    assert.equal(stringValue(findEntry(entries, 'model')?.value), 'text-embedding-3-large');
    assert.equal(findEntry(entries, 'timeout')?.value.kind, 'number');
  });

  it('keeps the keyword object first when a comment sits among the arguments', async () => {
    const facts = await analyze(`
client.embeddings.create(
    # Azure OpenAI takes the deployment name as the model name
    model=deployment,
    input=text,
    timeout=60.0,
)
`);
    const call = facts.calls.find(
      (candidate) => dotted(candidate.calleePath) === 'client.embeddings.create',
    );
    assert.ok(call, 'expected the create call');
    assert.equal(findEntry(objectArgument(call), 'timeout')?.value.kind, 'number');
  });

  /*
   * A nested call is reduced the way a top level one is, because it is the same shape and a reader asking
   * what it was given cannot know how deeply it sits. Mapping its children one by one left every keyword
   * argument of a nested call unknown, so a policy written `stop_after_attempt(15)` was read and the same
   * policy written `stop_after_attempt(max_attempt_number=15)` was not.
   */
  it('reads the keyword arguments of a call nested inside another call', async () => {
    const facts = await analyze(`
retrying = AsyncRetrying(stop=stop_after_attempt(max_attempt_number=15))
`);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'AsyncRetrying');
    assert.ok(call, 'expected the AsyncRetrying call');
    const stop = findEntry(objectArgument(call), 'stop')?.value;
    assert.equal(stop?.kind, 'call');
    if (stop?.kind !== 'call') return;
    assert.equal(
      numberValue(
        findEntry(stop.args[0]?.kind === 'object' ? stop.args[0].entries : [], 'max_attempt_number')
          ?.value,
      ),
      15,
    );
  });

  it('keeps a positional splat, whose arity nothing here can know', async () => {
    const facts = await analyze(`
handler(*items, name="triage")
`);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'handler');
    assert.ok(call, 'expected the handler call');
    assert.equal(call.args[0]?.kind, 'unknown');
    assert.equal(stringValue(findEntry(objectArgument(call, 1), 'name')?.value), 'triage');
  });

  it('reads a list literal written with a note in it', async () => {
    const facts = await analyze(`
triage = Agent(
    tools=[
        # the two the router needs
        lookup_account,
        check_inventory,
    ],
)
`);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'Agent');
    assert.ok(call, 'expected an Agent call');
    assert.deepEqual(identifierItems(findEntry(objectArgument(call), 'tools')?.value), [
      'lookup_account',
      'check_inventory',
    ]);
  });

  it('records decorated functions with decorator arguments', async () => {
    const facts = await analyze(`
from agents import function_tool

@function_tool(name_override="lookup_account")
async def lookup(account_id: str) -> str:
    return account_id

@function_tool
def plain(x: int) -> int:
    return x
`);
    const decorated = facts.definitions.find((definition) => definition.name === 'lookup');
    assert.equal(decorated?.async, true);
    assert.equal(dotted(decorated?.decorators[0]?.path ?? []), 'function_tool');
    assert.equal(decorated?.decorators[0]?.origin?.module, 'agents');
    const entries = decorated?.decorators[0]?.args[0];
    assert.equal(entries?.kind, 'object');
    if (entries?.kind === 'object') {
      assert.equal(
        stringValue(findEntry(entries.entries, 'name_override')?.value),
        'lookup_account',
      );
    }
    const plain = facts.definitions.find((definition) => definition.name === 'plain');
    assert.equal(dotted(plain?.decorators[0]?.path ?? []), 'function_tool');
    assert.equal(plain?.decorators[0]?.args.length, 0);
  });

  it('resolves attribute call paths and awaited calls', async () => {
    const facts = await analyze(`
import openai

client = openai.OpenAI()

async def ask():
    return await client.chat.completions.create(model="gpt-4o-mini", messages=[])
`);
    const call = facts.calls.find(
      (candidate) => dotted(candidate.calleePath) === 'client.chat.completions.create',
    );
    assert.ok(call, 'expected the completions call');
    assert.equal(call.awaited, true);
    assert.equal(call.enclosing, 'ask');
    assert.equal(stringValue(findEntry(objectArgument(call), 'model')?.value), 'gpt-4o-mini');
    const construction = facts.calls.find(
      (candidate) => dotted(candidate.calleePath) === 'openai.OpenAI',
    );
    assert.equal(construction?.origin?.module, 'openai');
  });

  it('records environment reads through subscript, get and getenv', async () => {
    const facts = await analyze(`
import os

def config():
    a = os.environ["OPENAI_API_KEY"]
    b = os.environ.get("ANTHROPIC_API_KEY")
    c = os.getenv("REGION")
    return a, b, c
`);
    assert.deepEqual(facts.environmentRefs.map((entry) => entry.name).sort(), [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'REGION',
    ]);
    assert.equal(facts.environmentRefs[0]?.enclosing, 'config');
  });

  it('records class definitions with their base classes', async () => {
    const facts = await analyze(`
from agents import Agent

class SupportAgent(Agent):
    async def handle(self, message: str) -> str:
        return message
`);
    const cls = facts.definitions.find((definition) => definition.kind === 'class');
    assert.equal(cls?.name, 'SupportAgent');
    assert.deepEqual(cls?.initializer, ['Agent']);
    const method = facts.definitions.find((definition) => definition.kind === 'method');
    assert.equal(method?.name, 'SupportAgent.handle');
    assert.equal(method?.async, true);
  });

  it('records try and loop constructs with the calls inside them', async () => {
    const facts = await analyze(`
def charge():
    for attempt in range(3):
        try:
            return charge_card(amount=10)
        except TimeoutError:
            continue
    return None
`);
    const tryCatch = facts.controlFlow.find((entry) => entry.kind === 'try_catch');
    assert.ok(tryCatch, 'expected a try construct');
    assert.deepEqual(
      tryCatch.contains.map((path) => dotted(path)),
      ['charge_card'],
    );
    const loop = facts.controlFlow.find((entry) => entry.kind === 'loop');
    assert.ok(loop, 'expected a loop');
    assert.equal(loop.enclosing, 'charge');
  });

  it('records long strings including triple quoted prompts', async () => {
    const facts = await analyze(`
INSTRUCTIONS = """You are a support agent. Answer briefly and never invent an order number."""
SHORT = "hi"
`);
    assert.equal(facts.texts.length, 1);
    assert.match(facts.texts[0]?.value ?? '', /You are a support agent/);
  });

  it('excludes formal documentation strings and retains value-bearing triple quotes', async () => {
    const facts =
      await analyze(`"""You are module documentation. Always answer every system question in this guide."""

def marker(value):
    return value

def documented():
    "You are function documentation with instructions. " "Always answer the user in this guide."
    return None

class Documented:
    (r"""You are class documentation. Your task is to explain this assistant implementation.""")

    @marker
    def method(self):
        u"""You are method documentation. Respond to the user by following these instructions."""
        return None

ASSIGNED = """You are an assigned system prompt. Always answer briefly and use verified context."""

def returned():
    return """You are a returned system prompt. Never invent an answer that is not in context."""

def called(client):
    return client.send(system_prompt="""You are a call argument prompt. Answer the user step by step.""")
`);

    assert.deepEqual(
      facts.texts.map((text) => ({ value: text.value, enclosing: text.enclosing })),
      [
        {
          value:
            'You are an assigned system prompt. Always answer briefly and use verified context.',
          enclosing: undefined,
        },
        {
          value: 'You are a returned system prompt. Never invent an answer that is not in context.',
          enclosing: 'returned',
        },
        {
          value: 'You are a call argument prompt. Answer the user step by step.',
          enclosing: 'called',
        },
      ],
    );
    assert.deepEqual(
      facts.texts.map((text) => text.location.startLine),
      [18, 21, 24],
    );
  });

  it('reports a syntax error without throwing', async () => {
    const facts = await analyze('def broken(:\n    pass\n');
    assert.ok(facts.parseErrors.length > 0);
  });
});

/**
 * The fact model is described as language neutral so that one adapter covers a framework in both ecosystems,
 * and `subscript` was where that stopped being true. `Agent(config=self.agents_config['k'])` recorded
 * `{"kind":"unknown","nodeType":"subscript"}` here while the identical TypeScript recorded a member path, and
 * `subscript` is the most common unknown node type in every Python checkout in the corpus. A literal key
 * selects the entry it names by the language definition, so it is a path. Everything else selects by a value
 * the syntax does not state, and stays unknown.
 */
describe('a subscript argument', () => {
  it('reads a literal key as a member path and refuses every key that is not one', async () => {
    const facts = await analyze(`
from crewai import Agent

def build(self, chosen):
    return Agent(
        literal=self.agents_config['lead_market_analyst'],
        variable=self.agents_config[chosen],
        index=rows[0],
        sliced=rows[1:2],
        several=table['a', 'b'],
        formatted=table[f'{chosen}'],
        nested=self.config['agents']['lead'],
    )
`);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'Agent');
    assert.ok(call, 'expected an Agent call');
    const entries = objectArgument(call);
    assert.deepEqual(findEntry(entries, 'literal')?.value, {
      kind: 'member',
      path: ['self', 'agents_config', 'lead_market_analyst'],
    });
    assert.deepEqual(findEntry(entries, 'nested')?.value, {
      kind: 'member',
      path: ['self', 'config', 'agents', 'lead'],
    });
    for (const key of ['variable', 'index', 'sliced', 'several', 'formatted']) {
      assert.deepEqual(
        findEntry(entries, key)?.value,
        { kind: 'unknown', nodeType: 'subscript' },
        `${key} selects by something the syntax does not state`,
      );
    }
  });
});

/**
 * `DefinitionFact` carried a dotted path when the right hand side was a call and had no field for a value, so
 * `agents_config = 'config/agents.yaml'` in a `@CrewBase` class was a definition with a location and nothing
 * in it. The literal is recorded and never substituted: the class body writing it is unconditionally true,
 * and the decorator replacing the attribute before any method runs is why "this name holds this where it is
 * read" is not.
 */
describe('a definition binding a literal', () => {
  it('records the literal, keeps the initialising call beside it, and lists every candidate', async () => {
    const facts = await analyze(`
class MarketingPostsCrew:
    agents_config = 'config/agents.yaml'
    loaded = yaml.safe_load(file)
    chosen = override or 'config/default.yaml'
    built = f'config/{name}.yaml'
    aliased = other_name

LIMIT = 3
`);
    const byName = new Map(facts.definitions.map((entry) => [entry.name, entry]));

    const configured = byName.get('agents_config');
    assert.equal(configured?.enclosing, 'MarketingPostsCrew');
    assert.deepEqual(configured?.literals, [{ kind: 'string', value: 'config/agents.yaml' }]);

    assert.deepEqual(
      byName.get('loaded')?.initializer,
      ['yaml', 'safe_load'],
      'a call is the syntactic signal that the value is not written here',
    );
    assert.equal(byName.get('loaded')?.literals, undefined);

    assert.deepEqual(byName.get('chosen')?.literals, [
      { kind: 'string', value: 'config/default.yaml' },
    ]);
    assert.deepEqual(
      byName.get('chosen')?.aliasedFrom,
      [['override']],
      'both candidates are listed, because the syntax does not say which is taken',
    );

    assert.equal(
      byName.get('built')?.literals,
      undefined,
      'a path the program assembles is not a path the author wrote',
    );
    assert.equal(byName.get('aliased')?.literals, undefined);
    assert.deepEqual(byName.get('LIMIT')?.literals, [{ kind: 'number', value: 3 }]);
  });
});
