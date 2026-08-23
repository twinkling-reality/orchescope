import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adapterRun, scanLangChainV1 } from './langchain-v1-scan.ts';

const agentsFromLangChainV1 = (result: Awaited<ReturnType<typeof scanLangChainV1>>) =>
  result.graph.components.filter(
    (component) =>
      component.kind === 'agent' &&
      component.discoveredBy.includes('adapter:langchain-v1-create-agent'),
  );

describe('LangChain v1 create_agent identity', () => {
  it('settles literal, direct-alias and namespace identities from exact imports', async () => {
    const result = await scanLangChainV1({
      'src/literal.py': `from langchain.agents import create_agent

create_agent(model="openai:gpt-4.1-mini", tools=[], name="literal-support")
`,
      'src/alias.py': `from langchain.agents import create_agent as make_agent

alias_support = make_agent(model="openai:gpt-4.1-mini", tools=[])
`,
      'src/namespace.py': `import langchain.agents as agent_factories

namespace_support = agent_factories.create_agent(model="openai:gpt-4.1-mini", tools=[])
`,
      'src/package_namespace.py': `from langchain import agents as agent_factories

package_support = agent_factories.create_agent(model="openai:gpt-4.1-mini", tools=[])
`,
    });

    assert.deepEqual(
      agentsFromLangChainV1(result)
        .map((component) => component.id)
        .sort(),
      [
        'agent:alias_support',
        'agent:literal-support',
        'agent:namespace_support',
        'agent:package_support',
      ],
    );
    assert.equal(adapterRun(result)?.status, 'completed');
    assert.equal(adapterRun(result)?.applicability?.relevantImports, 4);

    const literal = result.graph.components.find(
      (component) => component.id === 'agent:literal-support',
    );
    assert.ok(literal !== undefined);
    const literalEvidence = result.evidence.filter((evidence) =>
      literal.evidence.includes(evidence.id),
    );
    assert.deepEqual(
      literalEvidence
        .flatMap((evidence) => (evidence.kind === 'source_span' ? [evidence.symbol] : []))
        .sort(),
      [
        'agent identity: literal-support',
        'langchain.agents.create_agent call',
        'langchain.agents.create_agent import',
      ],
    );
    assert.deepEqual(
      literal.sourceLocations
        .map((location) => location.startLine)
        .sort((left, right) => left - right),
      [1, 3, 3],
    );
  });

  it('uses one uniquely enclosing method and records its implementation and binding', async () => {
    const result = await scanLangChainV1({
      'src/system.py': `import requests
from agents import function_tool
from langchain.agents import create_agent


@function_tool
def invoke_assistant():
    return assistant()


class Agents:
    @staticmethod
    def assistant():
        requests.post("https://example.com/actions")
        return create_agent(model="openai:gpt-4.1-mini", tools=[])
`,
    });

    const assistant = result.graph.components.find(
      (component) => component.id === 'agent:assistant',
    );
    assert.ok(assistant !== undefined);
    assert.deepEqual(
      assistant.sourceLocations
        .map((location) => location.startLine)
        .sort((left, right) => left - right),
      [3, 13, 15],
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.from === 'tool:invoke_assistant' &&
          edge.to === assistant.id &&
          edge.discoveredBy.includes('adapter:implementation-reach'),
      ),
      'the enclosing method binding did not resolve from another implementation body',
    );
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.from === assistant.id && edge.discoveredBy.includes('adapter:implementation-reach'),
      ),
      'the method body was not registered as the agent implementation span',
    );
  });

  it('reproduces the target method identity without inventing dynamic endpoints', async () => {
    const result = await scanLangChainV1({
      'src/agent/agents.py': `from langchain.agents import create_agent
from src.tools import TOOLS


def get_llm():
    return object()


class Agents:
    @staticmethod
    def assistant():
        return create_agent(
            model=get_llm(),
            tools=TOOLS,
            state_schema=State,
            system_prompt=load_prompt("assistant"),
        )
`,
    });

    assert.deepEqual(
      agentsFromLangChainV1(result).map((component) => component.id),
      ['agent:assistant'],
    );
    assert.equal(
      result.graph.components.some(
        (component) =>
          component.discoveredBy.includes('adapter:langchain-v1-create-agent') &&
          (component.kind === 'model' || component.kind === 'tool'),
      ),
      false,
    );
    const topology = result.graph.coverage.topology;
    assert.equal(topology?.status, 'incomplete');
    assert.equal(topology?.unresolvedCount, 3);
    assert.deepEqual(
      topology?.unresolved
        .map((entry) => entry.location?.startLine)
        .sort((left, right) => (left ?? 0) - (right ?? 0)),
      [13, 14, 16],
    );
    const producer = topology?.producers.find(
      (entry) => entry.adapterId === 'adapter:langchain-v1-create-agent',
    );
    assert.deepEqual(producer, {
      adapterId: 'adapter:langchain-v1-create-agent',
      status: 'incomplete',
      inspectedInputs: 1,
      relationsFound: 0,
    });
  });

  it('refuses foreign, local, shadowed, type-only and submodule lookalike origins', async () => {
    const foreign = await scanLangChainV1({
      'src/app.py': `from another.agents import create_agent
agent = create_agent(model="openai:gpt", tools=[])
`,
    });
    assert.deepEqual(agentsFromLangChainV1(foreign), []);
    assert.equal(adapterRun(foreign)?.status, 'not_applicable');

    const local = await scanLangChainV1({
      'langchain/__init__.py': '',
      'langchain/agents.py': `def create_agent(**kwargs):
    return kwargs
`,
      'src/app.py': `from langchain.agents import create_agent
agent = create_agent(model="openai:gpt", tools=[])
`,
    });
    assert.deepEqual(agentsFromLangChainV1(local), []);
    assert.equal(adapterRun(local)?.status, 'not_applicable');

    const shadowed = await scanLangChainV1({
      'src/app.py': `from langchain.agents import create_agent

def create_agent(**kwargs):
    return kwargs

agent = create_agent(model="openai:gpt", tools=[])
`,
    });
    assert.deepEqual(agentsFromLangChainV1(shadowed), []);
    assert.equal(adapterRun(shadowed)?.status, 'completed');
    assert.match(
      shadowed.graph.coverage.topology?.unresolved[0]?.reason ?? '',
      /exact unshadowed langchain\.agents runtime binding/,
    );

    const typeOnly = await scanLangChainV1({
      'src/app.py': `from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from langchain.agents import create_agent
    typed = create_agent(model="openai:gpt", tools=[])
`,
    });
    assert.deepEqual(agentsFromLangChainV1(typeOnly), []);
    assert.equal(adapterRun(typeOnly)?.status, 'not_applicable');

    const lookalike = await scanLangChainV1({
      'src/app.py': `from langchain.agents.experimental import create_agent
agent = create_agent(model="openai:gpt", tools=[])
`,
    });
    assert.deepEqual(agentsFromLangChainV1(lookalike), []);
    assert.equal(adapterRun(lookalike)?.status, 'not_applicable');
  });

  it('refuses direct and namespace imports shadowed by callable parameters', async () => {
    const result = await scanLangChainV1({
      'src/app.py': `from langchain.agents import create_agent
import langchain.agents as agent_factories

def direct_factory(create_agent):
    return create_agent(model="openai:gpt", tools=[], name="false-direct")

def namespace_factory(agent_factories):
    return agent_factories.create_agent(model="openai:gpt", tools=[], name="false-namespace")
`,
    });

    assert.deepEqual(agentsFromLangChainV1(result), []);
    assert.equal(
      result.graph.components.some((component) =>
        component.discoveredBy.includes('adapter:langchain-v1-create-agent'),
      ),
      false,
    );
    assert.equal(adapterRun(result)?.status, 'completed');
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 2);
    assert.ok(
      result.graph.coverage.topology?.unresolved.every((entry) =>
        entry.reason.includes('exact unshadowed langchain.agents runtime binding'),
      ),
    );
  });

  it('refuses an identity-free call and repeated calls sharing one enclosing owner', async () => {
    const result = await scanLangChainV1({
      'src/app.py': `from langchain.agents import create_agent

create_agent(model="openai:gpt", tools=[])


def build():
    create_agent(model="openai:gpt", tools=[])
    return create_agent(model="openai:gpt", tools=[])
`,
    });

    assert.deepEqual(agentsFromLangChainV1(result), []);
    const refusals = result.graph.coverage.topology?.unresolved.filter(
      (entry) => entry.kind === 'node_registration',
    );
    assert.equal(refusals?.length, 3);
    assert.ok(refusals?.every((entry) => entry.location !== undefined));
  });

  it('cites exact cross-module dynamic prompt authority and wiring on the prompt edge', async () => {
    const result = await scanLangChainV1({
      'src/prompts.py': `from langchain.agents.middleware import dynamic_prompt

@dynamic_prompt
def wired(request):
    return f"Answer briefly for {request.runtime.context.user_role}."
`,
      'src/app.py': `from langchain.agents import create_agent
from .prompts import wired

MIDDLEWARE = [wired]

assistant = create_agent(
    model="openai:gpt-4.1-mini",
    tools=[],
    name="assistant",
    middleware=MIDDLEWARE,
)
`,
    });

    const prompt = result.graph.components.find((component) => component.kind === 'prompt');
    assert.ok(prompt);
    const edge = result.graph.edges.find(
      (candidate) => candidate.kind === 'uses_prompt' && candidate.to === prompt.id,
    );
    assert.ok(edge);
    const exactLocations = (evidenceIds: readonly string[]) =>
      result.evidence
        .flatMap((record) =>
          evidenceIds.includes(record.id) && record.kind === 'source_span'
            ? [`${record.location.file}:${record.location.startLine}`]
            : [],
        )
        .sort();
    const authorityAndWiring = [
      'src/app.py:1',
      'src/app.py:2',
      'src/app.py:4',
      'src/app.py:6',
      'src/prompts.py:1',
      'src/prompts.py:3',
      'src/prompts.py:4',
      'src/prompts.py:5',
    ];
    assert.deepEqual(exactLocations(prompt.evidence), authorityAndWiring);
    assert.deepEqual(exactLocations(edge.evidence), authorityAndWiring);
  });

  it('requires dynamic middleware list and item definitions to precede their use', async () => {
    const result = await scanLangChainV1({
      'src/accepted.py': `from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt

@dynamic_prompt
def wired(request):
    return "Accepted prompt."

MIDDLEWARE = [wired]
accepted = create_agent(model="openai:gpt", tools=[], middleware=MIDDLEWARE)
`,
      'src/list_after.py': `from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt

@dynamic_prompt
def wired(request):
    return "List defined too late."

after = create_agent(model="openai:gpt", tools=[], middleware=LATE)
LATE = [wired]
`,
      'src/item_after.py': `from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt

after = create_agent(model="openai:gpt", tools=[], middleware=[wired])

@dynamic_prompt
def wired(request):
    return "Item defined too late."
`,
      'src/same_line.py': `from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt

@dynamic_prompt
def wired(request):
    return "Same-line list defined too late."

after = create_agent(model="openai:gpt", tools=[], name="same-line", middleware=LATE); LATE = [wired]
`,
      'src/ambiguous_authority.py': `from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt
from langchain.agents.middleware import dynamic_prompt

@dynamic_prompt
def wired(request):
    return "Authority without one exact import citation is refused."

agent = create_agent(model="openai:gpt", tools=[], middleware=[wired])
`,
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]?.sourceLocations[0]?.file, 'src/accepted.py');
    const refusedFiles = result.graph.coverage.topology?.unresolved
      .filter(
        (entry) =>
          entry.scope === 'prompt_use' &&
          /middleware\.dynamic_prompt: prompt value is computed/u.test(entry.reason),
      )
      .map((entry) => entry.location?.file)
      .sort();
    assert.equal(result.graph.coverage.topology?.promptUseUnresolvedCount, 4);
    assert.deepEqual(refusedFiles, ['src/item_after.py', 'src/list_after.py', 'src/same_line.py']);
    assert.equal(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.scope === 'prompt_use' &&
          entry.location?.file === 'src/ambiguous_authority.py' &&
          /middleware\.dynamic_prompt\.wired/u.test(entry.reason),
      ),
      true,
    );
  });
});
