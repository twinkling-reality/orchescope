import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanLangChainV1 } from './langchain-v1-scan.ts';

const legacyComponents = (result: Awaited<ReturnType<typeof scanLangChainV1>>) =>
  result.graph.components.filter((component) =>
    component.discoveredBy.includes('adapter:langchain-legacy-agent'),
  );

const legacyEdges = (result: Awaited<ReturnType<typeof scanLangChainV1>>) =>
  result.graph.edges.filter((edge) => edge.discoveredBy.includes('adapter:langchain-legacy-agent'));

describe('legacy LangChain agent identity', () => {
  it('settles returned AgentExecutor factories at each exact assigned call site', async () => {
    const result = await scanLangChainV1({
      'main.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.tools import tool

@tool
def internet_search(query: str):
    return query

@tool
def process_content(url: str):
    return url

tools = [internet_search, process_content]

def create_agent(llm, tools, system_prompt):
    prompt = object()
    agent = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools)
    return executor

llm = ChatOpenAI(model="gpt-4o-mini")
web_searcher_agent = create_agent(llm, tools, "Search the web and return grounded results.")
insight_agent = create_agent(llm, tools, "Compare the sources and explain the insight.")

def interact(system_prompt):
    personality_agent = create_agent(llm, tools, system_prompt)
    return personality_agent
`,
    });

    assert.deepEqual(
      legacyComponents(result)
        .filter((component) => component.kind === 'agent')
        .map((component) => component.id)
        .sort(),
      ['agent:insight_agent', 'agent:interact.personality_agent', 'agent:web_searcher_agent'],
    );
    assert.deepEqual(
      legacyComponents(result)
        .filter((component) => component.kind === 'tool')
        .map((component) => component.id)
        .sort(),
      ['tool:internet_search', 'tool:process_content'],
    );
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'invokes_model').length, 3);
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'calls_tool').length, 6);
    assert.ok(
      legacyEdges(result).every(
        (edge) => edge.kind !== 'invokes_model' || edge.to === 'model:openai/gpt-4o-mini',
      ),
    );
    const run = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:langchain-legacy-agent',
    );
    assert.equal(run?.status, 'completed');
    assert.equal(run?.componentsFound, 5);
    assert.equal(run?.edgesFound, 9);
    const producer = result.graph.coverage.topology?.producers.find(
      (entry) => entry.adapterId === 'adapter:langchain-legacy-agent',
    );
    assert.deepEqual(producer, {
      adapterId: 'adapter:langchain-legacy-agent',
      status: 'incomplete',
      inspectedInputs: 2,
      relationsFound: 9,
    });
    assert.equal(result.graph.coverage.topology?.controlFlowUnresolvedCount, 1);
    assert.equal(result.graph.coverage.topology?.promptUseUnresolvedCount, 3);
    assert.deepEqual(
      result.graph.coverage.topology?.unresolved
        .filter((entry) => entry.scope === 'prompt_use')
        .map((entry) => entry.location?.startLine),
      [22, 23, 26],
      'each transformed prompt boundary needs its own source call site',
    );
  });

  it('supports exact renamed and namespace legacy imports', async () => {
    const result = await scanLangChainV1({
      'src/aliased.py': `from langchain.agents import AgentExecutor as Executor
from langchain.agents import create_openai_tools_agent as make_agent
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4.1-mini")
raw = make_agent(llm, [], "prompt")
alias_support = Executor(agent=raw, tools=[])
`,
      'src/namespaced.py': `import langchain.agents as legacy
from langchain_openai import ChatOpenAI

def build(llm, tools, prompt):
    raw = legacy.create_openai_tools_agent(llm, tools, prompt)
    executor = legacy.AgentExecutor(agent=raw, tools=tools)
    return executor

llm = ChatOpenAI(model="gpt-4o-mini")
namespace_support = build(llm, [], "prompt")
`,
    });

    assert.deepEqual(
      legacyComponents(result)
        .filter((component) => component.kind === 'agent')
        .map((component) => component.id)
        .sort(),
      ['agent:alias_support', 'agent:namespace_support'],
    );
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'invokes_model').length, 2);
  });

  it('supports a direct exact factory and executor pair without a wrapper', async () => {
    const result = await scanLangChainV1({
      'src/direct.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.tools import tool

@tool
def lookup(value: str):
    return value

llm = ChatOpenAI(model="gpt-4.1-mini")
raw = create_openai_tools_agent(llm, [lookup], "prompt")
support = AgentExecutor(agent=raw, tools=[lookup])
`,
    });

    assert.ok(result.graph.components.some((component) => component.id === 'agent:support'));
    assert.ok(result.graph.components.some((component) => component.id === 'tool:lookup'));
    assert.ok(
      result.graph.edges.some(
        (edge) => edge.from === 'agent:support' && edge.to === 'model:openai/gpt-4.1-mini',
      ),
    );
    assert.ok(
      result.graph.edges.some((edge) => edge.from === 'agent:support' && edge.to === 'tool:lookup'),
    );
  });

  it('refuses unsettled exact imports and computed model or tool populations', async () => {
    const result = await scanLangChainV1({
      'src/refused.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def broken(create_openai_tools_agent, llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    return AgentExecutor(agent=raw, tools=tools)

def factory(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = factory(make_model(), make_tools(), "prompt")
`,
    });

    assert.deepEqual(
      legacyComponents(result)
        .filter((component) => component.kind === 'agent')
        .map((component) => component.id),
      ['agent:support'],
    );
    assert.equal(legacyEdges(result).length, 0);
    const topology = result.graph.coverage.topology;
    assert.equal(topology?.status, 'incomplete');
    assert.ok((topology?.unresolvedCount ?? 0) >= 3);
    assert.ok(
      topology?.unresolved.some((entry) => entry.location?.startLine === 4),
      'the shadowed factory call disappeared instead of becoming a source refusal',
    );
    assert.ok(
      topology?.unresolved.some((entry) => entry.reason.includes('model argument did not settle')),
    );
    assert.ok(
      topology?.unresolved.some((entry) => entry.reason.includes('tool population was computed')),
    );
  });

  it('refuses wrapper calls shadowed by a parameter or a later binding', async () => {
    const result = await scanLangChainV1({
      'src/wrapper_shadow.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

build = foreign_factory
support = build(model, tools, prompt)

def caller(build):
    nested = build(model, tools, prompt)
    return nested
`,
    });

    assert.deepEqual(
      legacyComponents(result).filter((component) => component.kind === 'agent'),
      [],
    );
    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.ok(refusals.some((entry) => entry.location?.startLine === 9));
    assert.ok(refusals.some((entry) => entry.location?.startLine === 12));
  });

  it('refuses an outer wrapper rebound before a nested body is invoked', async () => {
    const result = await scanLangChainV1({
      'src/captured_wrapper.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

def make():
    support = build(model, tools, prompt)
    return support

build = foreign_factory
make()
`,
    });

    assert.deepEqual(
      legacyComponents(result).filter((component) => component.kind === 'agent'),
      [],
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) => entry.location?.startLine === 9),
    );
  });

  it('requires one unchanged executor result on every wrapper return path', async () => {
    const result = await scanLangChainV1({
      'src/alternate_return.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt, alternate):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    if alternate:
        return foreign
    return executor

support = build(model, tools, prompt, flag)
`,
      'src/reassigned_executor.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    executor = foreign
    return executor

support = build(model, tools, prompt)
`,
      'src/competing_factory.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt, choose):
    if choose:
        raw = create_openai_tools_agent(llm, tools, prompt)
    else:
        raw = foreign
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, tools, prompt, flag)
`,
    });

    assert.deepEqual(
      legacyComponents(result).filter((component) => component.kind === 'agent'),
      [],
    );
    assert.ok((result.graph.coverage.topology?.unresolvedCount ?? 0) >= 6);
  });

  it('requires factory, executor and return statements in authoritative order', async () => {
    const result = await scanLangChainV1({
      'src/executor_before_factory.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    executor = AgentExecutor(agent=raw, tools=tools)
    raw = create_openai_tools_agent(llm, tools, prompt)
    return executor

support = build(model, tools, prompt)
`,
      'src/return_before_executor.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    return executor
    executor = AgentExecutor(agent=raw, tools=tools)

support = build(model, tools, prompt)
`,
    });

    assert.deepEqual(
      legacyComponents(result).filter((component) => component.kind === 'agent'),
      [],
    );
  });

  it('refuses implicit wrapper fallthrough and mutation of the tools parameter', async () => {
    const result = await scanLangChainV1({
      'src/conditional_return.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt, enabled):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    if enabled:
        return executor

support = build(model, tools, prompt, flag)
`,
      'src/parameter_mutation.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    tools.append(runtime_tool)
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, tools, prompt)
`,
    });

    assert.deepEqual(
      legacyComponents(result)
        .filter((component) => component.kind === 'agent')
        .map((component) => component.id),
      ['agent:support'],
    );
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'calls_tool').length, 0);
  });

  it('refuses async wrappers whose calls return coroutine objects', async () => {
    const result = await scanLangChainV1({
      'src/async_wrapper.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

async def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, tools, prompt)
`,
      'src/sync_wrapper.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], prompt)
`,
    });

    assert.deepEqual(
      legacyComponents(result)
        .filter((component) => component.kind === 'agent')
        .map((component) => component.id),
      ['agent:support'],
    );
    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.ok(refusals.some((entry) => entry.location?.file === 'src/async_wrapper.py'));
  });

  it('refuses transformed wrappers and wrappers with no local construction call', async () => {
    const result = await scanLangChainV1({
      'src/decorated.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

@replace
def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, tools, prompt)
`,
      'src/exported.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def exported_build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor
`,
    });

    assert.deepEqual(
      legacyComponents(result).filter((component) => component.kind === 'agent'),
      [],
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('cross-module calls are unsupported'),
      ),
    );
  });

  it('refuses a tool population mutated after its bounded declaration', async () => {
    const result = await scanLangChainV1({
      'src/mutated_tools.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.tools import tool

@tool
def lookup(value: str):
    return value

tools = [lookup]

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

tools.append(runtime_tool)
llm = ChatOpenAI(model="gpt-4.1-mini")
support = build(llm, tools, "prompt")
`,
    });

    assert.ok(legacyComponents(result).some((component) => component.id === 'agent:support'));
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'calls_tool').length, 0);
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('tool population was computed'),
      ),
    );
  });

  it('refuses a tool list aliased or passed to an unsettled mutator', async () => {
    const result = await scanLangChainV1({
      'src/escaped_tools.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.tools import tool

@tool
def lookup(value: str):
    return value

tools = [lookup]
tools_alias = tools
mutate(tools)

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

llm = ChatOpenAI(model="gpt-4.1-mini")
support = build(llm, tools, "prompt")
`,
    });

    assert.ok(legacyComponents(result).some((component) => component.id === 'agent:support'));
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'calls_tool').length, 0);
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('tool population was computed'),
      ),
    );
  });

  it('refuses named tool-list mutation after construction while retaining inline lists', async () => {
    const result = await scanLangChainV1({
      'src/post_construction.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

tools = [lookup]
support = build(model, tools, "prompt")
tools.clear()
`,
      'src/post_alias.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

tools = [lookup]
support = build(model, tools, "prompt")
alias = tools
alias.append(runtime_tool)
`,
      'src/inline.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

raw = create_openai_tools_agent(model, [lookup], "prompt")
support = AgentExecutor(agent=raw, tools=[lookup])
`,
    });

    const toolEdges = legacyEdges(result).filter((edge) => edge.kind === 'calls_tool');
    assert.equal(toolEdges.length, 1);
    assert.equal(
      toolEdges[0]?.sourceLocations.some((entry) => entry.file === 'src/inline.py'),
      true,
    );
    assert.equal(
      result.graph.coverage.topology?.unresolved.filter((entry) =>
        entry.reason.includes('tool population was computed'),
      ).length,
      2,
    );
  });

  it('refuses tool populations that escape through containers and assignment values', async () => {
    const result = await scanLangChainV1({
      'src/caller_container.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

tools = [lookup]
holder = {"tools": tools}
mutate(holder)
support = build(model, tools, "prompt")
`,
      'src/caller_assignment.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

tools = [lookup]
registry["tools"] = tools
mutate(registry)
support = build(model, tools, "prompt")
`,
      'src/wrapper_laundering.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

tools = [lookup]
combo = {"tools": tools, "probe": build(model, tools, "prompt")}
mutate(combo)
support = build(model, tools, "prompt")
`,
      'src/outer_call_laundering.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

tools = [lookup]
combo = wrap(build(model, tools, "prompt"), tools)
mutate(combo)
support = build(model, tools, "prompt")
`,
      'src/wrapper_assignment.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    registry["tools"] = tools
    registry["model"] = llm
    registry["prompt"] = prompt
    mutate(registry)
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, tools, "prompt")
`,
      'src/benign_assignment.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

def build(llm, tools, prompt):
    registry["unrelated"] = other
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [lookup], "prompt")
`,
    });

    const toolEdges = legacyEdges(result).filter((edge) => edge.kind === 'calls_tool');
    assert.equal(toolEdges.length, 1);
    assert.equal(
      toolEdges[0]?.sourceLocations.some((entry) => entry.file === 'src/benign_assignment.py'),
      true,
    );
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'invokes_model').length, 0);
    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.ok(
      refusals.filter((entry) => entry.reason.includes('tool population was computed')).length >= 3,
    );
    assert.ok(refusals.some((entry) => entry.reason.includes('model argument did not settle')));
    assert.ok(refusals.some((entry) => entry.scope === 'prompt_use'));
  });

  it('refuses endpoints mutated through a constructed executor binding', async () => {
    const imports = `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.tools import tool

@tool
def lookup(value: str): return value

tools = [lookup]
llm = ChatOpenAI(model="gpt-4.1-mini")

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor
`;
    const result = await scanLangChainV1({
      'src/wrapper_tools_assignment.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
support.tools = []
`,
      'src/wrapper_tools_clear.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
support.tools.clear()
`,
      'src/wrapper_agent_assignment.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
support.agent = foreign_agent
`,
      'src/direct_tools.py': `${imports}
raw = create_openai_tools_agent(llm, tools, "prompt long enough to become a retained system prompt")
support = AgentExecutor(agent=raw, tools=tools)
support.tools.append(runtime_tool)
`,
      'src/direct_agent.py': `${imports}
raw = create_openai_tools_agent(llm, tools, "prompt long enough to become a retained system prompt")
support = AgentExecutor(agent=raw, tools=tools)
support.agent = foreign_agent
`,
      'src/invoked.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
support.invoke({"input": "hello"})
`,
      'src/setattr_tools.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
setattr(support, "tools", [])
`,
      'src/setattr_agent.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
setattr(support, "agent", foreign_agent)
`,
      'src/object_setattr_agent.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
object.__setattr__(support, "agent", foreign_agent)
`,
      'src/set_tools.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
support.set_tools([])
`,
      'src/agent_configure.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
support.agent.configure(foreign_agent)
`,
      'src/alias_set_tools.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
alias = support
alias.set_tools([])
`,
      'src/shadowed_setattr.py': `${imports}
def setattr(target, name, value): return None
support = build(llm, tools, "prompt long enough to become a retained system prompt")
setattr(support, "tools", [])
`,
      'src/dynamic_setattr.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
field = runtime_field
setattr(support, field, foreign)
`,
      'src/delattr_agent.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
delattr(support, "agent")
`,
      'src/builtins_setattr_agent.py': `import builtins
${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
builtins.setattr(support, "agent", foreign)
`,
      'src/delete_agent.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
del support.agent
`,
      'src/read_uses.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
support.agent.invoke({"input": "hello"})
support.tools.count(lookup)
support.get_graph()
`,
      'src/builtins_alias.py': `import builtins as b
${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
b.setattr(support, "agent", foreign)
`,
      'src/setattr_alias.py': `from builtins import setattr as builtin_setattr
${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
builtin_setattr(support, "tools", [])
`,
      'src/rebound_builtins.py': `import builtins
${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
builtins = fake
builtins.setattr(support, "agent", foreign)
`,
      'src/rebound_executor_alias.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
alias = support
alias = foreign
alias.tools.clear()
`,
      'src/parameter_alias_shadow.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
alias = support
def inspect(alias): alias.tools.clear()
inspect(foreign)
`,
      'src/local_alias_shadow.py': `${imports}
support = build(llm, tools, "prompt long enough to become a retained system prompt")
alias = support
def inspect():
    alias = foreign
    alias.tools.clear()
inspect()
`,
    });

    const edges = legacyEdges(result);
    assert.equal(edges.filter((edge) => edge.kind === 'calls_tool').length, 13);
    assert.equal(edges.filter((edge) => edge.kind === 'invokes_model').length, 10);
    const hasRelationFrom = (kind: string, file: string): boolean =>
      edges.some(
        (edge) => edge.kind === kind && edge.sourceLocations.some((entry) => entry.file === file),
      );
    assert.equal(hasRelationFrom('calls_tool', 'src/setattr_tools.py'), false);
    assert.equal(hasRelationFrom('calls_tool', 'src/set_tools.py'), false);
    assert.equal(hasRelationFrom('calls_tool', 'src/alias_set_tools.py'), false);
    assert.equal(hasRelationFrom('invokes_model', 'src/setattr_agent.py'), false);
    assert.equal(hasRelationFrom('invokes_model', 'src/object_setattr_agent.py'), false);
    assert.equal(hasRelationFrom('invokes_model', 'src/agent_configure.py'), false);
    assert.equal(hasRelationFrom('calls_tool', 'src/invoked.py'), true);
    assert.equal(hasRelationFrom('invokes_model', 'src/invoked.py'), true);
    assert.equal(hasRelationFrom('calls_tool', 'src/shadowed_setattr.py'), true);
    assert.equal(hasRelationFrom('calls_tool', 'src/dynamic_setattr.py'), false);
    assert.equal(hasRelationFrom('calls_tool', 'src/delattr_agent.py'), true);
    assert.equal(hasRelationFrom('calls_tool', 'src/builtins_setattr_agent.py'), true);
    assert.equal(hasRelationFrom('calls_tool', 'src/delete_agent.py'), true);
    assert.equal(hasRelationFrom('calls_tool', 'src/read_uses.py'), true);
    assert.equal(hasRelationFrom('invokes_model', 'src/read_uses.py'), true);
    assert.equal(hasRelationFrom('invokes_model', 'src/builtins_alias.py'), false);
    assert.equal(hasRelationFrom('calls_tool', 'src/setattr_alias.py'), false);
    assert.equal(hasRelationFrom('calls_tool', 'src/rebound_builtins.py'), true);
    assert.equal(hasRelationFrom('invokes_model', 'src/rebound_builtins.py'), true);
    for (const file of [
      'src/rebound_executor_alias.py',
      'src/parameter_alias_shadow.py',
      'src/local_alias_shadow.py',
    ]) {
      assert.equal(hasRelationFrom('calls_tool', file), false);
      assert.equal(hasRelationFrom('invokes_model', file), false);
    }
    const promptEdges = result.graph.edges.filter((edge) => edge.kind === 'uses_prompt');
    assert.equal(
      promptEdges.some((edge) =>
        edge.sourceLocations.some(
          (entry) =>
            entry.file === 'src/wrapper_agent_assignment.py' ||
            entry.file === 'src/direct_agent.py',
        ),
      ),
      false,
    );
    assert.ok(
      (result.graph.coverage.topology?.unresolvedCount ?? 0) >= 8,
      'each explicitly replaced endpoint should remain visible as a refusal',
    );
  });

  it('reports executor endpoint replacement at the mutation span', async () => {
    const result = await scanLangChainV1({
      'src/mutated.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], "prompt")
support.tools = []
support.agent = foreign_agent
`,
      'src/unsettled_call.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], "prompt")
support.configure(runtime_options)
`,
      'src/root_clear.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], "prompt")
support.clear()
`,
      'src/agent_update.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], "prompt")
support.agent.update(runtime_options)
`,
    });

    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.ok(
      refusals.some(
        (entry) =>
          entry.reason.includes('tool endpoint assigned or mutated') &&
          entry.location?.startLine === 9,
      ),
    );
    assert.ok(
      refusals.some(
        (entry) =>
          entry.reason.includes('delegated agent endpoint assigned or mutated') &&
          entry.location?.startLine === 10,
      ),
    );
    assert.equal(
      refusals.some(
        (entry) =>
          entry.location?.startLine === 8 &&
          (entry.reason.includes('model argument did not settle') ||
            entry.reason.includes('tool population was computed')),
      ),
      false,
    );
    assert.ok(
      refusals.some(
        (entry) =>
          entry.reason.includes(
            'did not prove that its delegated agent endpoint remained stable',
          ) &&
          entry.location?.file === 'src/unsettled_call.py' &&
          entry.location.startLine === 9,
      ),
    );
    for (const file of ['src/root_clear.py', 'src/agent_update.py']) {
      assert.ok(
        refusals.some(
          (entry) => entry.reason.includes('did not prove') && entry.location?.file === file,
        ),
      );
      assert.equal(
        refusals.some(
          (entry) => entry.reason.includes('assigned or mutated') && entry.location?.file === file,
        ),
        false,
      );
    }
  });

  it('does not present descendant tool methods as proven population mutation', async () => {
    const result = await scanLangChainV1({
      'src/descendant.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], "prompt")
support.tools.registry.clear()
`,
      'src/subscript.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], "prompt")
support.tools[0].clear()
`,
    });

    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    for (const file of ['src/descendant.py', 'src/subscript.py']) {
      assert.ok(
        refusals.some(
          (entry) => entry.location?.file === file && entry.reason.includes('did not prove'),
        ),
      );
      assert.equal(
        refusals.some(
          (entry) => entry.location?.file === file && entry.reason.includes('assigned or mutated'),
        ),
        false,
      );
    }
  });

  it('does not present unrelated executor writes as endpoint mutations', async () => {
    const cases = [
      ['src/attribute.py', 'support.verbose = True'],
      ['src/metadata.py', 'support.metadata = {"owner": "ops"}'],
      ['src/agent_config.py', 'support.agent.config = runtime_options'],
      ['src/agent_cache.py', 'support.agent.cache["key"] = value'],
      ['src/agent_subscript.py', 'support.agent[key] = value'],
      ['src/agent_subscript_delete.py', 'del support.agent[key]'],
      ['src/setattr.py', 'setattr(support, "verbose", True)'],
    ] as const;

    for (const [file, operation] of cases) {
      const result = await scanLangChainV1({
        [file]: `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], "prompt")
${operation}
`,
      });

      const refusals = result.graph.coverage.topology?.unresolved ?? [];
      assert.ok(
        refusals.some(
          (entry) =>
            entry.location?.file === file &&
            entry.location.startLine === 9 &&
            entry.reason.includes('A source operation') &&
            entry.reason.includes('did not prove'),
        ),
      );
      assert.equal(
        refusals.some(
          (entry) => entry.location?.file === file && entry.reason.includes('assigned or mutated'),
        ),
        false,
      );
    }
  });

  it('retains compound endpoint writes as proven mutations', async () => {
    const cases = [
      ['src/augmented.py', 'support.tools += [runtime_tool]', 'tool endpoint'],
      [
        'src/tuple.py',
        'support.agent, support.tools = foreign_agent, []',
        'delegated agent endpoint',
      ],
      ['src/delete_list.py', 'del support.agent, support.tools', 'delegated agent endpoint'],
      ['src/delete_tuple.py', 'del (support.agent, support.tools)', 'delegated agent endpoint'],
      [
        'src/parenthesized_assignment.py',
        '(support.agent, support.tools) = values',
        'delegated agent endpoint',
      ],
      ['src/bracket_delete.py', 'del [support.agent, support.tools]', 'delegated agent endpoint'],
      [
        'src/starred_tuple.py',
        '(support.agent, *support.tools) = values',
        'delegated agent endpoint',
      ],
      [
        'src/starred_list.py',
        '[*support.tools, support.agent] = values',
        'delegated agent endpoint',
      ],
      [
        'src/parenthesized_receiver.py',
        '(support).agent = foreign_agent',
        'delegated agent endpoint',
      ],
      [
        'src/parenthesized_receiver_augmented.py',
        '(support).agent += foreign_agent',
        'delegated agent endpoint',
      ],
      ['src/parenthesized_receiver_delete.py', 'del (support).agent', 'delegated agent endpoint'],
    ] as const;

    for (const [file, operation, endpoint] of cases) {
      const result = await scanLangChainV1({
        [file]: `from langchain.agents import AgentExecutor, create_openai_tools_agent

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

support = build(model, [], "prompt")
${operation}
`,
      });

      const refusals = result.graph.coverage.topology?.unresolved ?? [];
      assert.ok(
        refusals.some(
          (entry) =>
            entry.location?.file === file &&
            entry.location.startLine === 9 &&
            entry.reason.includes(`${endpoint} assigned or mutated`),
        ),
      );
    }
  });

  it('refuses captured model and tool bindings changed before nested invocation', async () => {
    const result = await scanLangChainV1({
      'src/captured_values.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.tools import tool

@tool
def lookup(value: str):
    return value

tools = [lookup]
llm = ChatOpenAI(model="gpt-4.1-mini")

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

def make():
    support = build(llm, tools, "prompt")
    return support

tools.append(runtime_tool)
llm = foreign_model
make()
`,
    });

    assert.ok(legacyComponents(result).some((component) => component.id === 'agent:make.support'));
    assert.equal(legacyEdges(result).length, 0);
    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.ok(refusals.some((entry) => entry.reason.includes('model argument did not settle')));
    assert.ok(refusals.some((entry) => entry.reason.includes('tool population was computed')));
  });

  it('preserves the agent while refusing rebound model and prompt parameters', async () => {
    const result = await scanLangChainV1({
      'src/rebound_parameters.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI

def build(llm, tools, prompt):
    llm = foreign_model
    prompt = "replacement prompt"
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

openai_llm = ChatOpenAI(model="gpt-4.1-mini")
support = build(openai_llm, [], "original prompt")
`,
    });

    assert.ok(legacyComponents(result).some((component) => component.id === 'agent:support'));
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'invokes_model').length, 0);
    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.ok(refusals.some((entry) => entry.reason.includes('model argument did not settle')));
    assert.ok(
      refusals.some((entry) => entry.scope === 'prompt_use' && entry.location?.startLine === 12),
    );
  });

  it('refuses a tool parameter nested in a container that escapes to an unknown call', async () => {
    const result = await scanLangChainV1({
      'src/nested_escape.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.tools import tool

@tool
def lookup(value: str):
    return value

tools = [lookup]

def build(llm, tools, prompt):
    holder = {"tools": tools}
    mutate(holder)
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

llm = ChatOpenAI(model="gpt-4.1-mini")
support = build(llm, tools, "prompt")
`,
    });

    assert.ok(legacyComponents(result).some((component) => component.id === 'agent:support'));
    assert.equal(legacyEdges(result).filter((edge) => edge.kind === 'calls_tool').length, 0);
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('tool population was computed'),
      ),
    );
  });

  it('settles decorated tools at the exact list capture and refuses duplicate entries', async () => {
    const wrapper = `
def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor
`;
    const result = await scanLangChainV1({
      'src/rebound_before.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

lookup = foreign
tools = [lookup]
${wrapper}
support = build(model, tools, "prompt")
`,
      'src/rebound_after.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

tools = [lookup]
lookup = foreign
${wrapper}
support = build(model, tools, "prompt")
`,
      'src/parameter_shadow.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value
${wrapper}
def make(lookup):
    tools = [lookup]
    support = build(model, tools, "prompt")
    return support
`,
      'src/duplicate.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

@tool
def lookup(value: str): return value

tools = [lookup, lookup]
${wrapper}
support = build(model, tools, "prompt")
`,
    });

    const toolEdges = legacyEdges(result).filter((edge) => edge.kind === 'calls_tool');
    assert.equal(toolEdges.length, 1);
    assert.equal(
      toolEdges[0]?.sourceLocations.some((entry) => entry.file === 'src/rebound_after.py'),
      true,
    );
    assert.equal(
      result.graph.coverage.topology?.unresolved.filter((entry) =>
        entry.reason.includes('tool population was computed'),
      ).length,
      3,
    );
  });

  it('uses an exact local decorated tool and does not borrow a shadowed global tool', async () => {
    const result = await scanLangChainV1({
      'src/local_tools.py': `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.tools import tool

def build(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

@tool
def lookup(value: str): return value

def supported():
    @tool
    def local_lookup(value: str): return value
    tools = [local_lookup]
    support = build(model, tools, "prompt")
    return support

def refused():
    def lookup(value: str): return value
    tools = [lookup]
    support = build(model, tools, "prompt")
    return support
`,
    });

    const toolEdges = legacyEdges(result).filter((edge) => edge.kind === 'calls_tool');
    assert.equal(toolEdges.length, 1);
    assert.equal(toolEdges[0]?.to, 'tool:supported.local_lookup');
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.reason.includes('tool population was computed') && entry.location?.startLine === 22,
      ),
    );
  });

  it('does not grant legacy identity to a foreign lookalike', async () => {
    const result = await scanLangChainV1({
      'src/foreign.py': `from local.agents import AgentExecutor, create_openai_tools_agent

raw = create_openai_tools_agent(model, tools, prompt)
support = AgentExecutor(agent=raw, tools=tools)
`,
    });

    assert.deepEqual(legacyComponents(result), []);
    assert.equal(
      result.graph.coverage.adapters.find(
        (entry) => entry.adapterId === 'adapter:langchain-legacy-agent',
      )?.status,
      'not_applicable',
    );
  });

  it('keeps semantic identities stable when unrelated lines move', async () => {
    const source = (
      padding: string,
    ) => `from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
${padding}def create_agent(llm, tools, prompt):
    raw = create_openai_tools_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=raw, tools=tools)
    return executor

llm = ChatOpenAI(model="gpt-4o-mini")
support = create_agent(llm, [], "help")
`;
    const compact = await scanLangChainV1({ 'src/app.py': source('') });
    const moved = await scanLangChainV1({ 'src/app.py': source('\n\n') });
    const ids = (result: typeof compact) =>
      legacyComponents(result)
        .map((component) => component.id)
        .sort();
    assert.deepEqual(ids(compact), ids(moved));
    assert.deepEqual(ids(compact), ['agent:support']);
    assert.doesNotMatch(ids(compact).join('\n'), /\d+-\d+/);
  });
});
