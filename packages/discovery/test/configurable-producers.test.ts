import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writePythonProject } from '@orchescope/testkit';
import { effectsAdapter } from '../src/adapters/effects.ts';
import { modelSdkAdapter } from '../src/adapters/model-sdk.ts';
import { searchIndexAdapter } from '../src/adapters/search-index.ts';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const createWorkspace = () => {
  const workspace = createTempWorkspace('orchescope-configurable-producers-');
  workspaces.push(workspace);
  writePythonProject(workspace, {
    name: 'research-app',
    dependencies: [
      'pydantic>=2.0.0',
      'langchain-ollama>=0.3.0',
      'langchain-openai>=0.3.0',
      'duckduckgo-search>=8.0.0',
      'tavily-python>=0.7.0',
      'langchain-community>=0.3.0',
      'requests>=2.0.0',
    ],
  });
  workspace.write('src/research/__init__.py', '');
  return workspace;
};

const scan = async (workspace: ReturnType<typeof createWorkspace>) => {
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'research-app',
      orchescopeVersion: '0.9.0',
      clock,
      deadline,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 100,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 2,
      adapters: [modelSdkAdapter, searchIndexAdapter, effectsAdapter],
    });
  } finally {
    deadline.dispose();
  }
};

const writeTargetShape = (workspace: ReturnType<typeof createWorkspace>): void => {
  workspace.write(
    'src/research/configuration.py',
    `from pydantic import BaseModel, Field

class Configuration(BaseModel):
    local_llm: str = Field(default="llama3.2")
    llm_provider: str = Field(default="ollama")
    search_api: str = Field(default="duckduckgo")
`,
  );
  workspace.write(
    'src/research/lmstudio.py',
    `import langchain_openai as lc

class ChatLMStudio(lc.ChatOpenAI):
    pass
`,
  );
  workspace.write(
    'src/research/graph.py',
    `from langchain_ollama import ChatOllama as OllamaChat
from research.configuration import Configuration
from research.lmstudio import ChatLMStudio as StudioChat

def get_llm(configurable: Configuration):
    first = OllamaChat(model=configurable.local_llm)
    second = StudioChat(model=configurable.local_llm)
    return first, second

def choose_search(config):
    configurable = Configuration.from_runnable_config(config)
    return get_config_value(configurable.search_api)
`,
  );
  workspace.write(
    'src/research/search.py',
    `import requests
from duckduckgo_search import DDGS as DuckSearch
from tavily import TavilyClient as Tavily
from langchain_community.utilities import SearxSearchWrapper as Searx

def duck(query):
    with DuckSearch() as client:
        return client.text(query)

def tavily(query):
    client = Tavily()
    return client.search(query)

def searx(query):
    client = Searx()
    return client.results(query)

def perplexity(query):
    payload = {"model": "sonar-pro", "messages": []}
    return requests.post(
        "https://api.perplexity.ai/chat/completions",
        json=payload,
    )
`,
  );
};

describe('configuration-backed model and search producers', () => {
  it('retains a Python environment fallback as a possible static model default', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/llm.py',
      `import os
from langchain_ollama import ChatOllama

def get_llm():
    return ChatOllama(model=os.getenv("OLLAMA_MODEL", "qwen2.5:7b"))
`,
    );
    const result = await scan(workspace);
    const model = result.graph.components.find(
      (component) => component.id === 'model:ollama/qwen2.5-7b',
    );
    assert.ok(model !== undefined, 'the literal environment fallback was not retained');
    assert.equal(model.metadata['configurationSelection'], 'possible');
    assert.equal(model.metadata['configurationDefault'], true);
    assert.equal(model.metadata['modelValueBasis'], 'static_default');
    assert.ok(
      model.sourceLocations.some(
        (location) => location.file === 'src/research/llm.py' && location.startLine === 5,
      ),
      'the environment fallback call is absent from the model evidence',
    );
    assert.equal(
      result.graph.coverage.unsupported.some((entry) => entry.kind === 'adapter_found_nothing'),
      false,
    );
  });

  it('retains exact standard-library environment reader import forms', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/module_environment.py',
      `import os
from langchain_ollama import ChatOllama

def get_llm():
    return ChatOllama(model=os.environ.get("FIRST_MODEL", "first"))
`,
    );
    workspace.write(
      'src/research/imported_environment.py',
      `from os import environ
from langchain_ollama import ChatOllama

def get_llm():
    return ChatOllama(model=environ.get("SECOND_MODEL", "second"))
`,
    );
    workspace.write(
      'src/research/imported_getenv.py',
      `from os import getenv
from langchain_ollama import ChatOllama

def get_llm():
    return ChatOllama(model=getenv("THIRD_MODEL", "third"))
`,
    );
    const result = await scan(workspace);
    const modelIds = result.graph.components
      .filter((component) => component.kind === 'model')
      .map((component) => component.id)
      .sort();
    assert.deepEqual(modelIds, ['model:ollama/first', 'model:ollama/second', 'model:ollama/third']);
  });

  it('does not read a local same-named environment method as a model default', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/llm.py',
      `from langchain_ollama import ChatOllama

class os:
    @staticmethod
    def getenv(name, fallback):
        return fallback

def get_llm():
    return ChatOllama(model=os.getenv("OLLAMA_MODEL", "made-up"))
`,
    );
    const result = await scan(workspace);
    assert.equal(
      result.graph.components.some((component) => component.kind === 'model'),
      false,
    );
    assert.equal(
      result.graph.coverage.unsupported.some((entry) => entry.kind === 'adapter_found_nothing'),
      true,
    );
  });

  it('does not trust a stale os import after the binding is reassigned', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/llm.py',
      `import os
from langchain_ollama import ChatOllama

class FakeEnvironment:
    @staticmethod
    def getenv(name, fallback):
        return fallback

os = FakeEnvironment()

def get_llm():
    return ChatOllama(model=os.getenv("OLLAMA_MODEL", "rebound"))
`,
    );
    const result = await scan(workspace);
    assert.equal(
      result.graph.components.some((component) => component.id === 'model:ollama/rebound'),
      false,
    );
    assert.equal(
      result.graph.coverage.unsupported.some((entry) => entry.kind === 'adapter_found_nothing'),
      true,
    );
  });

  it('discovers exact model wrappers, four search possibilities and only the declared defaults', async () => {
    const workspace = createWorkspace();
    writeTargetShape(workspace);
    const result = await scan(workspace);
    const byId = new Map(result.graph.components.map((component) => [component.id, component]));

    const ollama = byId.get('model:ollama/llama3.2');
    const lmstudio = byId.get('model:lmstudio/llama3.2');
    assert.ok(ollama, 'the exact ChatOllama configuration path was not discovered');
    assert.ok(lmstudio, 'the verified local ChatOpenAI subclass was not discovered');
    assert.equal(ollama.metadata['configurationSelection'], 'possible');
    assert.equal(ollama.metadata['configurationDefault'], true);
    assert.equal(lmstudio.metadata['configurationSelection'], 'possible');
    assert.equal(lmstudio.metadata['configurationDefault'], false);
    assert.ok(
      ollama.sourceLocations.some(
        (location) => location.file === 'src/research/configuration.py' && location.startLine === 4,
      ),
      'the model default citation is absent',
    );
    for (const line of [1, 6]) {
      assert.ok(
        ollama.sourceLocations.some(
          (location) => location.file === 'src/research/graph.py' && location.startLine === line,
        ),
        `the ChatOllama source citation at graph.py:${line} is absent`,
      );
    }
    assert.ok(
      lmstudio.sourceLocations.some(
        (location) => location.file === 'src/research/lmstudio.py' && location.startLine === 3,
      ),
      'the application subclass citation is absent',
    );

    const retrieval = ['duckduckgo', 'tavily', 'searxng', 'perplexity'].map((name) => {
      const component = byId.get(`retrieval:${name}`);
      assert.ok(component, `${name} was not represented as a possible retrieval path`);
      assert.equal(component.metadata['configurationSelection'], 'possible');
      return component;
    });
    assert.deepEqual(
      retrieval
        .filter((component) => component.metadata['configurationDefault'] === true)
        .map((component) => component.identity.localName),
      ['duckduckgo'],
    );

    const perplexityModel = byId.get('model:perplexity/sonar-pro');
    assert.ok(perplexityModel, 'the stable local payload model was not resolved');
    for (const line of [1, 19, 20]) {
      assert.ok(
        perplexityModel.sourceLocations.some(
          (location) => location.file === 'src/research/search.py' && location.startLine === line,
        ),
        `the Perplexity model citation at search.py:${line} is absent`,
      );
    }

    const retrievalEvidence = [
      ['duckduckgo', 2, 7, 8],
      ['tavily', 3, 11, 12],
      ['searxng', 4, 15, 16],
    ] as const;
    for (const [name, importLine, constructorLine, methodLine] of retrievalEvidence) {
      const component = byId.get(`retrieval:${name}`);
      assert.ok(component !== undefined);
      for (const line of [importLine, constructorLine]) {
        assert.ok(
          component.sourceLocations.some(
            (location) => location.file === 'src/research/search.py' && location.startLine === line,
          ),
          `${name} is missing source evidence at search.py:${line}`,
        );
      }
      assert.ok(
        result.graph.edges.some(
          (edge) =>
            edge.kind === 'queries_retrieval' &&
            edge.to === `retrieval:${name}` &&
            edge.sourceLocations.some(
              (location) =>
                location.file === 'src/research/search.py' && location.startLine === methodLine,
            ),
        ),
        `${name} query is missing method-call evidence at search.py:${methodLine}`,
      );
    }
    const perplexityRetrieval = byId.get('retrieval:perplexity');
    assert.ok(perplexityRetrieval !== undefined);
    for (const line of [1, 20]) {
      assert.ok(
        perplexityRetrieval.sourceLocations.some(
          (location) => location.file === 'src/research/search.py' && location.startLine === line,
        ),
        `Perplexity retrieval is missing evidence at search.py:${line}`,
      );
    }

    const modelRun = result.graph.coverage.adapters.find(
      (run) => run.adapterId === 'adapter:model-sdk',
    );
    assert.equal(modelRun?.applicability?.relevantImports, 3);
    assert.equal(modelRun?.applicability?.omittedImports, 0);
    assert.deepEqual(
      modelRun?.applicability?.sample.map((entry) => [entry.module, entry.imported]),
      [
        ['langchain_ollama', 'ChatOllama'],
        ['research.lmstudio', 'ChatLMStudio'],
        ['langchain_openai', '*'],
      ],
    );
    const searchRun = result.graph.coverage.adapters.find(
      (run) => run.adapterId === 'adapter:search-index',
    );
    assert.equal(searchRun?.applicability?.relevantImports, 4);
    assert.equal(searchRun?.applicability?.distinctFiles, 1);
  });

  it('refuses local lookalikes, a local Field and an unverified ChatLMStudio base', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/configuration.py',
      `def Field(**values):
    return values

class Configuration:
    local_llm = Field(default="made-up")
`,
    );
    workspace.write(
      'src/research/lmstudio.py',
      `class ChatOpenAI:
    pass

class ChatLMStudio(ChatOpenAI):
    pass
`,
    );
    workspace.write(
      'src/research/app.py',
      `from langchain_ollama import ChatOllama
from research.configuration import Configuration
from research.lmstudio import ChatLMStudio

class DDGS:
    def text(self, query):
        return query

def run(configurable: Configuration):
    ollama = ChatOllama(model=configurable.local_llm)
    local = ChatLMStudio(model=configurable.local_llm)
    search = DDGS()
    return ollama, local, search.text("query")
`,
    );
    const result = await scan(workspace);
    assert.equal(
      result.graph.components.some(
        (component) => component.kind === 'model' || component.kind === 'retrieval',
      ),
      false,
    );
  });

  it('refuses reassigned payloads and receivers instead of choosing by source order', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/app.py',
      `import requests
from tavily import TavilyClient

def search(query):
    client = TavilyClient()
    client = replacement
    results = client.search(query)
    payload = {"model": "sonar-pro"}
    payload = dynamic_payload()
    response = requests.post(
        "https://api.perplexity.ai/chat/completions",
        json=payload,
    )
    return results, response
`,
    );
    const result = await scan(workspace);
    assert.equal(
      result.graph.edges.some(
        (edge) => edge.kind === 'queries_retrieval' && edge.to === 'retrieval:tavily',
      ),
      false,
    );
    assert.equal(
      result.graph.components.some((component) => component.id === 'model:perplexity/sonar-pro'),
      false,
    );
    assert.ok(
      result.graph.components.some((component) => component.id === 'model:perplexity/unspecified'),
      'the exact endpoint should remain while the ambiguous payload stays unnamed',
    );
  });

  it('qualifies raw model clients by exact provider and stable lexical receiver', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/models.py',
      `from openai import OpenAI as OpenAIClient
import openai as openai_sdk

module_client = OpenAIClient()
client = OpenAIClient()

def module_answer():
    return module_client.responses.create(model="gpt-module", input="hello")

def scoped_answer():
    client = openai_sdk.OpenAI()
    return client.responses.create(model="gpt-scoped", input="hello")

def foreign_answer():
    client = ForeignClient()
    return client.responses.create(model="foreign", input="hello")

def shadowed_answer(client):
    return client.responses.create(model="shadowed", input="hello")

def reassigned_answer():
    client = OpenAIClient()
    client = replacement
    return client.responses.create(model="reassigned", input="hello")
`,
    );
    const result = await scan(workspace);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('model:openai/gpt-module'));
    assert.ok(ids.includes('model:openai/gpt-scoped'));
    assert.equal(ids.includes('model:openai/foreign'), false);
    assert.equal(ids.includes('model:openai/shadowed'), false);
    assert.equal(ids.includes('model:openai/reassigned'), false);
    const moduleModel = result.graph.components.find(
      (component) => component.id === 'model:openai/gpt-module',
    );
    assert.ok(moduleModel !== undefined);
    for (const line of [1, 4, 8]) {
      assert.ok(
        moduleModel.sourceLocations.some(
          (location) => location.file === 'src/research/models.py' && location.startLine === line,
        ),
        `the raw SDK model is missing evidence at models.py:${line}`,
      );
    }
    const provider = result.graph.components.find(
      (component) => component.id === 'provider:openai',
    );
    assert.ok(provider !== undefined);
    for (const line of [1, 4]) {
      assert.ok(
        provider.sourceLocations.some(
          (location) => location.file === 'src/research/models.py' && location.startLine === line,
        ),
        `the raw SDK provider is missing evidence at models.py:${line}`,
      );
    }
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === 'invokes_model' &&
          edge.to === 'model:openai/gpt-module' &&
          edge.sourceLocations.some((location) => location.startLine === 8),
      ),
      'the raw SDK invocation is missing method-call evidence',
    );
    const modelRun = result.graph.coverage.adapters.find(
      (run) => run.adapterId === 'adapter:model-sdk',
    );
    assert.deepEqual(
      modelRun?.applicability?.sample.map((entry) => [entry.module, entry.imported]),
      [
        ['openai', 'OpenAI'],
        ['openai', 'OpenAI'],
      ],
      'the aliased named and namespace-provider constructions should both retain exact exports',
    );
  });

  it('does not fall back to a module search client through a same-named local parameter', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/search.py',
      `from tavily import TavilyClient

client = TavilyClient()

def search(client, query):
    return client.search(query)
`,
    );
    const result = await scan(workspace);
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'queries_retrieval'),
      false,
      'the local parameter was rebound to the module client',
    );
  });

  it('keeps search client receivers inside the scope that constructed them', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/search.py',
      `from tavily import TavilyClient

def supported(query):
    client = TavilyClient()
    return client.search(query)

def unrelated(query):
    client = ForeignClient()
    return client.search(query)
`,
    );
    const result = await scan(workspace);
    const tavilyQueries = result.graph.edges.filter(
      (edge) => edge.kind === 'queries_retrieval' && edge.to === 'retrieval:tavily',
    );
    assert.equal(tavilyQueries.length, 1);
    assert.ok(tavilyQueries[0]?.sourceLocations.some((location) => location.startLine === 5));
  });

  it('does not fall back to a module model client through a JavaScript parameter', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/models.js',
      `import OpenAI from 'openai';

const client = new OpenAI();

export function answer(client) {
  return client.responses.create({ model: 'shadowed-js', input: 'hello' });
}
`,
    );
    const result = await scan(workspace);
    assert.equal(
      result.graph.components.some((component) => component.id === 'model:openai/shadowed-js'),
      false,
      'the JavaScript parameter was rebound to the module provider client',
    );
  });

  it('does not fall back to a module model client through an arrow-function parameter', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/models.js',
      `import OpenAI from 'openai';

const client = new OpenAI();

export const answer = (client) =>
  client.responses.create({ model: 'shadowed-arrow', input: 'hello' });
`,
    );
    const result = await scan(workspace);
    assert.equal(
      result.graph.components.some((component) => component.id === 'model:openai/shadowed-arrow'),
      false,
      'the arrow-function parameter was rebound to the module provider client',
    );
  });

  it('persists exact completed-zero applicability and uses it for the existing gap accounting', async () => {
    const workspace = createWorkspace();
    workspace.write(
      'src/research/imports.py',
      `from langchain_ollama import ChatOllama
from duckduckgo_search import DDGS
`,
    );
    const result = await scan(workspace);
    for (const adapterId of ['adapter:model-sdk', 'adapter:search-index']) {
      const run = result.graph.coverage.adapters.find((entry) => entry.adapterId === adapterId);
      assert.equal(run?.status, 'completed');
      assert.equal(run?.filesInspected, 1);
      assert.deepEqual(run?.languages, ['python']);
      assert.deepEqual(run?.applicability, {
        relevantImports: 1,
        distinctFiles: 1,
        sample: [
          {
            module: adapterId === 'adapter:model-sdk' ? 'langchain_ollama' : 'duckduckgo_search',
            imported: adapterId === 'adapter:model-sdk' ? 'ChatOllama' : 'DDGS',
            location: run?.applicability?.sample[0]?.location,
          },
        ],
        omittedImports: 0,
      });
      assert.ok(
        result.graph.coverage.unsupported.some(
          (area) => area.kind === 'adapter_found_nothing' && area.area.includes(adapterId),
        ),
        `${adapterId} completed zero without entering existing gap accounting`,
      );
      assert.ok(
        result.graph.coverage.topology?.unresolved.some(
          (entry) =>
            entry.location?.file === 'src/research/imports.py' && entry.reason.includes(adapterId),
        ),
        `${adapterId} topology accounting did not consume the structured sample`,
      );
    }
  });

  it('bounds the exact applicability sample without losing full counts', async () => {
    const workspace = createWorkspace();
    for (let index = 0; index < 12; index += 1) {
      workspace.write(
        `src/research/import_${index.toString().padStart(2, '0')}.py`,
        'from langchain_ollama import ChatOllama\n',
      );
    }
    const result = await scan(workspace);
    const run = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:model-sdk',
    );
    assert.equal(run?.applicability?.relevantImports, 12);
    assert.equal(run?.applicability?.distinctFiles, 12);
    assert.equal(run?.applicability?.sample.length, 10);
    assert.equal(run?.applicability?.omittedImports, 2);
    assert.deepEqual(
      run?.applicability?.sample.map((entry) => entry.location.file),
      Array.from(
        { length: 10 },
        (_, index) => `src/research/import_${index.toString().padStart(2, '0')}.py`,
      ),
    );
  });

  it('records dependency-only adapters as having no applicable source import', async () => {
    const workspace = createWorkspace();
    workspace.write('src/research/app.py', 'value = 1\n');
    const result = await scan(workspace);
    for (const adapterId of ['adapter:model-sdk', 'adapter:search-index']) {
      const run = result.graph.coverage.adapters.find((entry) => entry.adapterId === adapterId);
      assert.equal(run?.status, 'not_applicable');
      assert.deepEqual(run?.applicability, {
        relevantImports: 0,
        distinctFiles: 0,
        sample: [],
        omittedImports: 0,
      });
    }
  });

  it('keeps semantic producer output independent of constructor and call order', async () => {
    const first = createWorkspace();
    const second = createWorkspace();
    first.write(
      'src/research/models.py',
      `from openai import OpenAI

first = OpenAI()
second = OpenAI()

def answer():
    a = first.responses.create(model="gpt-a", input="hello")
    b = second.responses.create(model="gpt-b", input="hello")
    return a, b
`,
    );
    second.write(
      'src/research/models.py',
      `from openai import OpenAI

second = OpenAI()
first = OpenAI()

def answer():
    b = second.responses.create(model="gpt-b", input="hello")
    a = first.responses.create(model="gpt-a", input="hello")
    return a, b
`,
    );
    const [left, right] = await Promise.all([scan(first), scan(second)]);
    const semanticModels = (result: Awaited<ReturnType<typeof scan>>) =>
      result.graph.components
        .filter((component) => component.kind === 'model' || component.kind === 'provider')
        .map((component) => ({
          id: component.id,
          details: component.details,
          metadata: component.metadata,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(semanticModels(left), semanticModels(right));
  });

  it('refuses conflicting search defaults independently of their source order', async () => {
    const first = createWorkspace();
    const second = createWorkspace();
    const writeConflict = (
      workspace: ReturnType<typeof createWorkspace>,
      reverse: boolean,
    ): void => {
      workspace.write(
        'src/research/configuration.py',
        `from pydantic import BaseModel, Field

class DuckConfiguration(BaseModel):
    search_api: str = Field(default="duckduckgo")

class TavilyConfiguration(BaseModel):
    search_api: str = Field(default="tavily")
`,
      );
      const selectors = [
        `def choose_duck(configurable: DuckConfiguration):
    return get_config_value(configurable.search_api)
`,
        `def choose_tavily(configurable: TavilyConfiguration):
    return get_config_value(configurable.search_api)
`,
      ];
      workspace.write(
        'src/research/graph.py',
        `from research.configuration import DuckConfiguration, TavilyConfiguration

${(reverse ? selectors.toReversed() : selectors).join('\n')}`,
      );
      workspace.write(
        'src/research/search.py',
        `from duckduckgo_search import DDGS
from tavily import TavilyClient

duck = DDGS()
tavily = TavilyClient()

def search(query):
    return duck.text(query), tavily.search(query)
`,
      );
    };
    writeConflict(first, false);
    writeConflict(second, true);

    const [left, right] = await Promise.all([scan(first), scan(second)]);
    const defaults = (result: Awaited<ReturnType<typeof scan>>) =>
      result.graph.components
        .filter((component) => component.kind === 'retrieval')
        .map((component) => [component.id, component.metadata['configurationDefault']])
        .sort(([leftId], [rightId]) => String(leftId).localeCompare(String(rightId)));
    assert.deepEqual(defaults(left), [
      ['retrieval:duckduckgo', false],
      ['retrieval:tavily', false],
    ]);
    assert.deepEqual(defaults(right), defaults(left));
  });
});
