import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  type ChatScan,
  chatComponentIds as idsOf,
  chatRefusalReasons as refusalReasons,
  chatWorkspace as workspaceFor,
  disposeChatWorkspaces,
  scanChatWorkspace as scan,
} from './langchain-openai-chat-fixture.ts';

after(disposeChatWorkspaces);

describe('direct LangChain OpenAI chat-model discovery', () => {
  it('accepts exact direct aliases and namespace calls with source-settled literal endpoints', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
from langchain_openai import ChatOpenAI as OpenAIChat
import langchain_openai as lc

first = ChatOpenAI(model="gpt-direct", base_url="https://api.openai.com/v1")
second = OpenAIChat(model="gpt-alias", openai_api_base="https://api.deepseek.com/v1")
third = lc.ChatOpenAI(model="gpt-namespace", base_url="https://api.groq.com/openai/v1")
fourth = ChatOpenAI(model_name="gpt-model-name", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    const ids = idsOf(result);
    assert.ok(ids.includes('model:openai/gpt-direct'));
    assert.ok(ids.includes('model:deepseek/gpt-alias'));
    assert.ok(ids.includes('model:groq/gpt-namespace'));
    assert.ok(ids.includes('model:openai/gpt-model-name'));
    assert.ok(ids.includes('provider:openai'));
    assert.ok(ids.includes('provider:deepseek'));
    assert.ok(ids.includes('provider:groq'));
    assert.equal(result.graph.edges.filter((edge) => edge.kind === 'served_by_provider').length, 4);
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'invokes_model'),
      false,
    );
    assert.equal(result.graph.coverage.topology?.status, 'complete');
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 0);
  });

  it('resolves the target-shaped dynamic choice through an exact frozen dataclass fallback', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/core/constants.py',
      `from dataclasses import dataclass

@dataclass(frozen=True)
class ModelConfig:
    gpt_5_mini: str = "gpt-5-mini"

models = ModelConfig()
`,
    );
    workspace.write(
      'src/agent/agents.py',
      `from langchain_openai import ChatOpenAI
from src.core.constants import models

def get_llm(model: str | None = None, **kwargs) -> ChatOpenAI:
    return ChatOpenAI(
        model=model or models.gpt_5_mini,
        api_key=settings.OPENAI_API_KEY,
        **kwargs,
    )
`,
    );
    const result = await scan(workspace);
    const model = result.graph.components.find(
      (component) => component.id === 'model:openai/gpt-5-mini',
    );
    assert.ok(model, `missing target fallback among ${idsOf(result).join(', ')}`);
    assert.equal(model.metadata['configurationSelection'], 'possible');
    assert.equal(model.metadata['modelValueBasis'], 'static_default');
    assert.equal(
      idsOf(result).some((id) => id.includes('unspecified')),
      false,
    );
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'invokes_model'),
      false,
    );
    for (const [file, line] of [
      ['src/agent/agents.py', 1],
      ['src/agent/agents.py', 2],
      ['src/agent/agents.py', 5],
      ['src/agent/agents.py', 6],
      ['src/core/constants.py', 1],
      ['src/core/constants.py', 3],
      ['src/core/constants.py', 4],
      ['src/core/constants.py', 5],
      ['src/core/constants.py', 7],
    ] as const) {
      assert.ok(
        model.sourceLocations.some(
          (location) => location.file === file && location.startLine === line,
        ),
        `the target model is missing evidence at ${file}:${line}`,
      );
    }
    const relation = result.graph.edges.find(
      (edge) => edge.kind === 'served_by_provider' && edge.from === 'model:openai/gpt-5-mini',
    );
    assert.ok(relation !== undefined);
    for (const location of model.sourceLocations) {
      assert.ok(
        relation.sourceLocations.some(
          (candidate) =>
            candidate.file === location.file &&
            candidate.startLine === location.startLine &&
            candidate.startColumn === location.startColumn,
        ),
        `the relation dropped model evidence at ${location.file}:${location.startLine}`,
      );
    }
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.ok(refusalReasons(result).some((reason) => reason.includes('model selection')));
    assert.ok(refusalReasons(result).some((reason) => reason.includes('keyword population')));
    assert.ok(refusalReasons(result).some((reason) => reason.includes('library default')));
  });

  it('retains an unqualified literal model when a custom or dynamic provider cannot be settled', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

custom = ChatOpenAI(model="gpt-custom", base_url="https://models.example.test/v1")
dynamic = ChatOpenAI(model="gpt-dynamic", base_url=runtime_endpoint)
client = ChatOpenAI(model="gpt-client", root_client=custom_client)
`,
    );
    const result = await scan(workspace);
    assert.ok(idsOf(result).includes('model:gpt-custom'));
    assert.ok(idsOf(result).includes('model:gpt-dynamic'));
    assert.ok(idsOf(result).includes('model:gpt-client'));
    assert.equal(
      idsOf(result).some((id) => id.startsWith('provider:')),
      false,
    );
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'served_by_provider'),
      false,
    );
    assert.ok(
      refusalReasons(result).some((reason) => reason.includes('recognized model-provider')),
    );
    assert.ok(refusalReasons(result).some((reason) => reason.includes('custom HTTP client')));
  });

  it('keeps provider-only, fully unresolved and library-default output shapes distinct', async () => {
    const providerOnly = workspaceFor();
    providerOnly.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
model = ChatOpenAI(model=runtime_model, base_url="https://api.openai.com/v1")
`,
    );
    const unresolved = workspaceFor();
    unresolved.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
model = ChatOpenAI(model=runtime_model, base_url=runtime_endpoint)
`,
    );
    const libraryDefault = workspaceFor();
    libraryDefault.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
model = ChatOpenAI(model="gpt-default")
`,
    );
    const [providerResult, unresolvedResult, defaultResult] = await Promise.all([
      scan(providerOnly),
      scan(unresolved),
      scan(libraryDefault),
    ]);
    assert.deepEqual(idsOf(providerResult), ['provider:openai']);
    assert.deepEqual(idsOf(unresolvedResult), []);
    assert.ok(idsOf(defaultResult).includes('provider:openai'));
    assert.ok(idsOf(defaultResult).includes('model:openai/gpt-default'));
    assert.equal(
      idsOf(defaultResult).some((id) => id.includes('unspecified')),
      false,
    );
    assert.ok(
      defaultResult.graph.edges.some(
        (edge) => edge.kind === 'served_by_provider' && edge.from === 'model:openai/gpt-default',
      ),
    );
    const model = defaultResult.graph.components.find(
      (component) => component.id === 'model:openai/gpt-default',
    );
    assert.equal(model?.metadata['configurationSelection'], 'possible');
    assert.ok(refusalReasons(defaultResult).some((reason) => reason.includes('library default')));
  });

  it('settles exact keyword splats while preserving their possible runtime status and refusal', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

options = {
    "model": "deepseek-chat",
    "base_url": "https://api.deepseek.com/v1",
}
model = ChatOpenAI(**options)
computed = ChatOpenAI(**{
    dynamic_key(): "hidden",
    "model": "deepseek-reasoner",
    "base_url": "https://api.deepseek.com/v1",
})
`,
    );
    const result = await scan(workspace);
    const model = result.graph.components.find(
      (component) => component.id === 'model:deepseek/deepseek-chat',
    );
    assert.ok(model !== undefined);
    assert.equal(model.metadata['configurationSelection'], 'possible');
    const computed = result.graph.components.find(
      (component) => component.id === 'model:deepseek/deepseek-reasoner',
    );
    assert.ok(computed !== undefined);
    assert.equal(computed.metadata['configurationSelection'], 'possible');
    assert.ok(refusalReasons(result).some((reason) => reason.includes('keyword population')));
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
  });

  it('records a completed-zero exact import population without inventing components', async () => {
    const workspace = workspaceFor();
    workspace.write('src/models.py', 'from langchain_openai import ChatOpenAI\n');
    const result = await scan(workspace);
    const run = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:model-sdk',
    );
    assert.equal(run?.status, 'completed');
    assert.equal(run?.applicability?.relevantImports, 1);
    assert.equal(run?.componentsFound, 0);
    assert.equal(result.graph.coverage.topology?.inspectedInputs, 1);
    assert.equal(result.graph.coverage.topology?.status, 'complete');
  });

  it('counts duplicate semantic components and relations once while merging call evidence', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
first = ChatOpenAI(model="same", base_url="https://api.openai.com/v1")
second = ChatOpenAI(model="same", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    const run = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:model-sdk',
    );
    const relations = result.graph.edges.filter((edge) => edge.kind === 'served_by_provider');
    assert.equal(result.graph.components.length, 2);
    assert.equal(run?.componentsFound, 2);
    assert.equal(relations.length, 1);
    assert.equal(
      result.graph.coverage.topology?.producers.find(
        (producer) => producer.adapterId === 'adapter:model-sdk',
      )?.relationsFound,
      1,
    );
    assert.equal(result.graph.coverage.topology?.explicitRelations, 1);
    assert.deepEqual(
      [
        ...new Set(
          relations[0]?.sourceLocations
            .filter((location) => location.file === 'src/models.py')
            .map((location) => location.startLine),
        ),
      ],
      [1, 2, 3],
    );
  });

  it('deduplicates model and provider populations across raw and ChatOpenAI producers', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from openai import OpenAI
from langchain_openai import ChatOpenAI

client = OpenAI()
raw = client.responses.create(model="same", input="hello")
chat = ChatOpenAI(model="same", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    const run = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:model-sdk',
    );
    assert.equal(result.graph.components.length, 2);
    assert.equal(run?.componentsFound, 2);
    assert.equal(result.graph.edges.length, 1);
    assert.equal(
      result.graph.coverage.topology?.producers.find(
        (producer) => producer.adapterId === 'adapter:model-sdk',
      )?.relationsFound,
      1,
    );
    assert.equal(result.graph.coverage.topology?.explicitRelations, 1);
    assert.equal(run?.applicability?.relevantImports, 2);
  });

  it('keeps choice identities, completeness and refusal reasons stable under source ordering', async () => {
    const first = workspaceFor();
    const second = workspaceFor();
    first.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

def first(runtime):
    return ChatOpenAI(model=runtime or "gpt-a", base_url="https://api.openai.com/v1")

def second(runtime):
    return ChatOpenAI(model=runtime or "gpt-b", base_url="https://api.openai.com/v1")
`,
    );
    second.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

def second(runtime):
    return ChatOpenAI(model=runtime or "gpt-b", base_url="https://api.openai.com/v1")

def first(runtime):
    return ChatOpenAI(model=runtime or "gpt-a", base_url="https://api.openai.com/v1")
`,
    );
    const [left, right] = await Promise.all([scan(first), scan(second)]);
    const semantic = (result: ChatScan) => ({
      components: result.graph.components.map((component) => ({
        id: component.id,
        metadata: component.metadata,
        tags: component.tags,
      })),
      edges: result.graph.edges.map((edge) => `${edge.kind}:${edge.from}->${edge.to}`),
      topology: {
        status: result.graph.coverage.topology?.status,
        inspected: result.graph.coverage.topology?.inspectedInputs,
        relations: result.graph.coverage.topology?.explicitRelations,
        unresolved: result.graph.coverage.topology?.unresolvedCount,
        reasons: refusalReasons(result),
      },
    });
    assert.deepEqual(semantic(left), semantic(right));
  });
});
