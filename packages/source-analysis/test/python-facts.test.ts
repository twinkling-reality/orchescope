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
  it('distinguishes a generator from an ordinary or nested-generator factory', async () => {
    const facts = await analyze(`
def ordinary():
    return Agent()

def generated():
    yield other
    return Agent()

def outer():
    def nested():
        yield other
    return Agent()

`);
    const definitions = new Map(
      facts.definitions.map((definition) => [definition.name, definition]),
    );
    assert.equal(definitions.get('ordinary')?.generator, undefined);
    assert.equal(definitions.get('generated')?.generator, true);
    assert.equal(definitions.get('outer')?.generator, undefined);
    assert.equal(definitions.get('outer.nested')?.generator, true);
  });

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

  it('keeps function imports inside their lexical runtime scope', async () => {
    const facts = await analyze(`
def owner():
    import openai as sdk
    return sdk.OpenAI()

def sibling():
    return sdk.OpenAI()

def imported_after_use():
    client = sdk.OpenAI()
    import openai as sdk
    return client

def outer():
    import openai as nested_sdk
    def nested():
        return nested_sdk.OpenAI()
    return nested()
`);
    const scoped = facts.imports.filter((entry) => entry.module === 'openai');
    assert.deepEqual(
      scoped.map((entry) => [entry.local, entry.enclosing]),
      [
        ['sdk', 'owner'],
        ['sdk', 'imported_after_use'],
        ['nested_sdk', 'outer'],
      ],
    );
    const calls = facts.calls.filter((candidate) =>
      dotted(candidate.calleePath).endsWith('OpenAI'),
    );
    assert.equal(calls.length, 4);
    assert.equal(calls[0]?.origin?.module, 'openai');
    assert.equal(calls[1]?.origin, undefined);
    assert.equal(calls[2]?.origin, undefined);
    assert.equal(calls[3]?.origin?.module, 'openai');
  });

  it('retains global and nonlocal ownership on Python writes', async () => {
    const facts = await analyze(`
agent = Agent()

def replace_global():
    global agent
    agent = foreign
    del agent

def outer():
    worker = Agent()
    def replace_nonlocal():
        nonlocal worker
        worker = foreign
        worker += foreign
    return worker
`);
    const writes = new Map(
      facts.definitions
        .filter((definition) => definition.bindingScope !== undefined)
        .map((definition) => [definition.name, definition.bindingScope]),
    );
    assert.equal(writes.get('agent'), 'global');
    assert.equal(writes.get('worker'), 'nonlocal');
    assert.equal(
      facts.definitions.find(
        (definition) => definition.name === 'worker' && definition.bindingScope === 'nonlocal',
      )?.bindingOwner,
      'outer',
    );
    assert.deepEqual(
      facts.definitions.find(
        (definition) => definition.name === 'worker' && definition.bindingScope === 'nonlocal',
      )?.bindingOwnerLocation,
      facts.definitions.find(
        (definition) => definition.kind === 'function' && definition.name === 'outer',
      )?.location,
    );
    assert.ok(
      facts.assignments.some(
        (assignment) =>
          assignment.target[0] === 'agent' &&
          assignment.operation === 'delete' &&
          assignment.bindingScope === 'global',
      ),
    );
    assert.ok(
      facts.assignments.some(
        (assignment) => assignment.target[0] === 'worker' && assignment.bindingScope === 'nonlocal',
      ),
    );
  });

  it('resolves a nonlocal write to an enclosing loop-target binding', async () => {
    const facts = await analyze(`
def outer(values):
    for agent in values:
        pass
    def replace():
        nonlocal agent
        agent = foreign
`);
    const outer = facts.definitions.find(
      (definition) => definition.kind === 'function' && definition.name === 'outer',
    );
    const replacement = facts.definitions.find(
      (definition) => definition.name === 'agent' && definition.bindingScope === 'nonlocal',
    );
    assert.deepEqual(replacement?.bindingOwnerLocation, outer?.location);
  });

  it('retains branch ownership on client definitions and their uses', async () => {
    const facts = await analyze(`
from openai import OpenAI

def choose(flag, endpoint):
    if flag:
        client = OpenAI(base_url=endpoint)
        client.responses.create(model="dynamic")
    else:
        client = OpenAI()
        client.responses.create(model="default")
    client.responses.create(model="joined")
`);
    const clients = facts.definitions.filter(
      (definition) => definition.kind === 'variable' && definition.name === 'client',
    );
    assert.deepEqual(
      clients.map((definition) => definition.branches?.map((branch) => branch.branch)),
      [['consequence'], ['alternative']],
    );
    const uses = facts.calls.filter((call) => dotted(call.calleePath).endsWith('responses.create'));
    assert.deepEqual(
      uses.map((call) => call.branches?.map((branch) => branch.branch) ?? []),
      [['consequence'], ['alternative'], []],
    );
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
    assert.equal(loop.countsPasses, true);
    assert.ok(loop.headerNames?.includes('attempt'));
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

  it('retains deletion of a member as a source write', async () => {
    const facts = await analyze(`
def reset(executor):
    del executor.agent
`);
    assert.deepEqual(facts.assignments, [
      {
        target: ['executor', 'agent'],
        value: { kind: 'unknown', nodeType: 'delete' },
        location: {
          file: 'src/agents/triage.py',
          startLine: 3,
          startColumn: 4,
          endLine: 3,
          endColumn: 22,
        },
        operation: 'delete',
        lexicalOwnerLocation: {
          file: 'src/agents/triage.py',
          startLine: 2,
          startColumn: 0,
          endLine: 3,
          endColumn: 22,
        },
        enclosing: 'reset',
      },
    ]);
  });

  it('distinguishes subscript writes from direct member replacement', async () => {
    const facts = await analyze(`
def reset(executor, key, replacement):
    executor.agent[key] = replacement
    del executor.agent[key]
`);
    assert.equal(facts.assignments.length, 2);
    for (const assignment of facts.assignments) {
      assert.deepEqual(assignment.target, ['executor', 'agent']);
      assert.equal(assignment.targetIncludesSubscript, true);
    }
    assert.equal(facts.assignments[0]?.operation, undefined);
    assert.equal(facts.assignments[1]?.operation, 'delete');
  });

  it('retains augmented, tuple and list member writes separately', async () => {
    const facts = await analyze(`
def reset(executor, replacement, runtime_tool):
    executor.tools += [runtime_tool]
    executor.agent, executor.tools = replacement, []
    [executor.agent, executor.tools] = [replacement, []]
    del executor.agent, executor.tools
    del (executor.agent, executor.tools)
`);
    assert.equal(facts.assignments.length, 9);
    assert.deepEqual(facts.assignments[0]?.value, {
      kind: 'array',
      items: [{ kind: 'identifier', name: 'runtime_tool' }],
      complete: true,
    });
    for (const assignment of facts.assignments.slice(1, 5)) {
      assert.deepEqual(assignment.value, {
        kind: 'unknown',
        nodeType: 'destructuring_assignment',
      });
    }
    assert.deepEqual(
      facts.assignments.map((assignment) => ({
        target: assignment.target,
        operation: assignment.operation,
      })),
      [
        { target: ['executor', 'tools'], operation: undefined },
        { target: ['executor', 'agent'], operation: undefined },
        { target: ['executor', 'tools'], operation: undefined },
        { target: ['executor', 'agent'], operation: undefined },
        { target: ['executor', 'tools'], operation: undefined },
        { target: ['executor', 'agent'], operation: 'delete' },
        { target: ['executor', 'tools'], operation: 'delete' },
        { target: ['executor', 'agent'], operation: 'delete' },
        { target: ['executor', 'tools'], operation: 'delete' },
      ],
    );
    assert.equal(
      facts.assignments.some((assignment) => assignment.targetIncludesSubscript === true),
      false,
    );
  });

  it('expands parenthesized, deletion-list and starred member targets', async () => {
    const facts = await analyze(`
def reset(support, values):
    (support.agent, support.tools) = values
    (support.agent, (support.tools, support.meta)) = values
    del [support.agent, support.tools]
    (support.agent, *support.tools) = values
    [*support.tools, support.agent] = values
`);
    assert.deepEqual(
      facts.assignments.map((assignment) => ({
        target: assignment.target,
        operation: assignment.operation,
      })),
      [
        { target: ['support', 'agent'], operation: undefined },
        { target: ['support', 'tools'], operation: undefined },
        { target: ['support', 'agent'], operation: undefined },
        { target: ['support', 'tools'], operation: undefined },
        { target: ['support', 'meta'], operation: undefined },
        { target: ['support', 'agent'], operation: 'delete' },
        { target: ['support', 'tools'], operation: 'delete' },
        { target: ['support', 'agent'], operation: undefined },
        { target: ['support', 'tools'], operation: undefined },
        { target: ['support', 'tools'], operation: undefined },
        { target: ['support', 'agent'], operation: undefined },
      ],
    );
    for (const assignment of facts.assignments.filter(
      (candidate) => candidate.operation !== 'delete',
    )) {
      assert.deepEqual(assignment.value, {
        kind: 'unknown',
        nodeType: 'destructuring_assignment',
      });
    }
  });

  it('unwraps parenthesized receivers without inventing destructured definitions', async () => {
    const facts = await analyze(`
def reset(support, replacement, values):
    (support).agent = replacement
    (support).agent += replacement
    del (support).agent
    [x] = values
    (x,) = values
    [*x] = values
    ((x,),) = values
    (*support.tools,) = values
`);
    assert.deepEqual(
      facts.assignments.map((assignment) => ({
        target: assignment.target,
        operation: assignment.operation,
      })),
      [
        { target: ['support', 'agent'], operation: undefined },
        { target: ['support', 'agent'], operation: undefined },
        { target: ['support', 'agent'], operation: 'delete' },
        { target: ['x'], operation: undefined },
        { target: ['x'], operation: undefined },
        { target: ['x'], operation: undefined },
        { target: ['x'], operation: undefined },
        { target: ['support', 'tools'], operation: undefined },
      ],
    );
    assert.equal(
      facts.definitions.some(
        (definition) => definition.kind === 'variable' && definition.name === 'x',
      ),
      false,
    );
    assert.ok(
      facts.assignments
        .filter((assignment) => assignment.target[0] === 'x')
        .every((assignment) => assignment.sourceReferences?.[0]?.[0] === 'values'),
    );
  });

  it('retains parameter default captures as reduced source values', async () => {
    const facts = await analyze(`
def outer(prompt):
    def mutate(alias=prompt, fixed="system"):
        return alias
    return mutate()
`);
    const mutate = facts.definitions.find(
      (definition) =>
        (definition.kind === 'function' || definition.kind === 'method') &&
        definition.name.endsWith('.mutate'),
    );
    assert.deepEqual(
      mutate?.parameters?.map((parameter) => ({
        name: parameter.name,
        defaultValue: parameter.defaultValue,
      })),
      [
        { name: 'alias', defaultValue: { kind: 'identifier', name: 'prompt' } },
        { name: 'fixed', defaultValue: { kind: 'string', value: 'system' } },
      ],
    );
  });

  it('marks a call that invokes a returned callable', async () => {
    const facts = await analyze(`
def factory():
    return operation

factory()()
factory()
`);
    const calls = facts.calls.filter((call) => call.calleePath[0] === 'factory');
    assert.equal(calls[0]?.invokesReturnedCallable, true);
    assert.equal(calls[1]?.invokesReturnedCallable, undefined);
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
