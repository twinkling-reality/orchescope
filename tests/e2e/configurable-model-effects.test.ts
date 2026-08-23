import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock, spanEvidence } from '../../packages/domain/src/index.ts';
import { effectsAdapter } from '../../packages/discovery/src/adapters/effects.ts';
import { modelSdkAdapter } from '../../packages/discovery/src/adapters/model-sdk.ts';
import { searchIndexAdapter } from '../../packages/discovery/src/adapters/search-index.ts';
import { discover } from '../../packages/discovery/src/discover.ts';
import { exercisedNotDeclaredRule } from '../../packages/findings/src/rules/reconciliation.ts';
import { computeDelta, indexGraph, reconcile } from '../../packages/graph/src/index.ts';
import type { RunRecord } from '../../packages/schema/src/index.ts';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '../../packages/source-analysis/src/index.ts';
import {
  createTempWorkspace,
  observedComponent,
  runtimeTopology,
  writePythonProject,
} from '../../packages/testkit/src/index.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

describe('target-shaped configurable model and effect discovery', () => {
  it('keeps static llama3.2 possibilities distinct from an exact observed smollm2 model', async () => {
    const workspace = createTempWorkspace('orchescope-configurable-e2e-');
    workspaces.push(workspace);
    writePythonProject(workspace, {
      name: 'local-deep-researcher-shape',
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
      `from langchain_openai import ChatOpenAI as OpenAIChat

class ChatLMStudio(OpenAIChat):
    pass
`,
    );
    workspace.write(
      'src/research/graph.py',
      `from langchain_ollama import ChatOllama
from research.configuration import Configuration
from research.lmstudio import ChatLMStudio

def models(configurable: Configuration):
    return (
        ChatOllama(model=configurable.local_llm),
        ChatLMStudio(model=configurable.local_llm),
    )

def selected_search(config):
    configurable = Configuration.from_runnable_config(config)
    return get_config_value(configurable.search_api)
`,
    );
    workspace.write(
      'src/research/search.py',
      `import requests
from duckduckgo_search import DDGS
from tavily import TavilyClient
from langchain_community.utilities import SearxSearchWrapper

def search(query):
    with DDGS() as duck:
        duck.text(query)
    tavily = TavilyClient()
    tavily.search(query)
    searx = SearxSearchWrapper()
    searx.results(query)
    payload = {"model": "sonar-pro", "messages": []}
    return requests.post(
        "https://api.perplexity.ai/chat/completions",
        json=payload,
    )
`,
    );

    const clock = fixedClock(0);
    const deadline = createDeadline(60_000, clock.monotonicMs);
    const scanned = await discover({
      root: workspace.root,
      projectName: 'local-deep-researcher-shape',
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
    deadline.dispose();

    const componentIds = new Set(scanned.graph.components.map((component) => component.id));
    for (const id of [
      'model:ollama/llama3.2',
      'model:lmstudio/llama3.2',
      'model:perplexity/sonar-pro',
      'retrieval:duckduckgo',
      'retrieval:tavily',
      'retrieval:searxng',
      'retrieval:perplexity',
    ]) {
      assert.ok(componentIds.has(id), `${id} was absent from the static graph`);
    }

    const runId = `run_${'5'.repeat(16)}`;
    const runtimeEvidence = spanEvidence({
      producer: 'target-shaped-e2e',
      runId,
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      spanName: 'ChatOllama smollm2:135m',
      attribute: 'llm.model_name',
      attributeValue: 'smollm2:135m',
    });
    const reconciled = reconcile(scanned.graph, [
      runtimeTopology({
        runIds: [runId],
        components: [
          observedComponent({
            kind: 'model',
            observedName: 'ollama/smollm2:135m',
            provider: 'ollama',
            model: 'smollm2:135m',
            evidence: [runtimeEvidence.id],
          }),
        ],
      }),
    ]);
    assert.deepEqual(reconciled.matches, []);
    const runtimeModelId = reconciled.runtimeOnlyComponentIds[0];
    assert.equal(runtimeModelId, 'model:ollama/smollm2-135m');
    assert.equal(
      reconciled.graph.components.find((component) => component.id === 'model:ollama/llama3.2')
        ?.presence.runtime,
      false,
    );

    const delta = computeDelta({
      graph: reconciled.graph,
      runs: [],
      spanToComponent: new Map(),
      matches: reconciled.matches,
      ambiguous: reconciled.ambiguous,
      missingSpanAttributes: reconciled.missingSpanAttributes,
    });
    const evidence = [
      ...scanned.evidence,
      runtimeEvidence,
      ...reconciled.evidence,
      ...delta.evidence,
    ];
    const outcome = exercisedNotDeclaredRule.evaluate({
      graph: indexGraph(reconciled.graph),
      delta: delta.delta,
      observedRuns: [{ run: { id: runId } as RunRecord, componentMetrics: [] }],
      silentRuns: [],
      benchmarks: [],
      chaosReports: [],
      scenarios: [],
      evidenceById: new Map(evidence.map((record) => [record.id, record])),
    });
    assert.equal(outcome.status, 'fired');
    const mismatch = outcome.drafts.find((draft) =>
      runtimeModelId === undefined ? false : draft.components.includes(runtimeModelId),
    );
    assert.ok(mismatch !== undefined);
    assert.match(mismatch.title, /without an exact matching static declaration/);
    assert.match(mismatch.explanation, /does not establish.*configurable provider path/);
    assert.equal(mismatch.newEvidence?.[0]?.kind, 'absence');
    assert.ok(mismatch.evidence.includes(runtimeEvidence.id));
  });
});
