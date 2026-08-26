import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>) => {
  const workspace = createTempWorkspace('orchescope-unclaimed-construction-');
  workspaces.push(workspace);
  for (const [path, contents] of Object.entries(files)) workspace.write(path, contents);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'unclaimed-construction-fixture',
      orchescopeVersion: '0.9.2',
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
    });
  } finally {
    deadline.dispose();
  }
};

const unclaimed = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.coverage.unsupported.filter(
    (area) => area.kind === 'unclaimed_imported_construction',
  );

const agentIdentities = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components
    .filter((component) => component.kind === 'agent')
    .map((component) => component.id);

describe('unclaimed imported constructions', () => {
  it('records a Python factory whose distribution no adapter claims', async () => {
    const result = await scan({
      'src/app.py': `from unknown_agents import Factory

runtime = Factory(tools=[search], model=model)
`,
    });

    assert.equal(result.agentSystemDetected, false);
    assert.deepEqual(agentIdentities(result), []);
    assert.equal(unclaimed(result).length, 1);
    const area = unclaimed(result)[0];
    assert.equal(
      area?.area,
      'unknown_agents.Factory is constructed at src/app.py:3 and no adapter claims that distribution',
    );
    assert.equal(area?.location?.file, 'src/app.py');
    assert.equal(area?.location?.startLine, 3);
    assert.equal(typeof area?.location?.fileHash, 'string');
    assert.match(area?.reason ?? '', /does not invent an agent identity/);
  });

  it('records a JavaScript construction whose object keys carry both populations', async () => {
    const result = await scan({
      'src/app.ts': `import { Factory } from 'unknown-agents';

export const runtime = new Factory({ tools, model });
`,
    });

    assert.equal(result.agentSystemDetected, false);
    assert.deepEqual(agentIdentities(result), []);
    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown-agents.Factory is constructed at src/app.ts:3 and no adapter claims that distribution',
    );
    assert.equal(unclaimed(result)[0]?.location?.startLine, 3);
  });

  it('records renamed and namespace imports by the exported name', async () => {
    const result = await scan({
      'src/alias.py': `from unknown_agents import Factory as Build

alias = Build(toolset=tools, llm=model)
`,
      'src/namespace.py': `import unknown_agents as ua

namespace = ua.Factory(tools=tools, chat_model=model)
`,
    });

    assert.deepEqual(
      unclaimed(result)
        .map((area) => area.area)
        .sort(),
      [
        'unknown_agents.Factory is constructed at src/alias.py:3 and no adapter claims that distribution',
        'unknown_agents.Factory is constructed at src/namespace.py:3 and no adapter claims that distribution',
      ],
    );
  });

  it('stays quiet when nothing is constructed', async () => {
    const result = await scan({
      'src/app.py': `from unknown_agents import Factory
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.equal(result.agentSystemDetected, false);
  });

  it('stays quiet for an ordinary web application', async () => {
    const result = await scan({
      'src/app.py': `from flask import Flask

app = Flask(__name__)

@app.get("/")
def index():
    return "ok"
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.equal(result.agentSystemDetected, false);
  });

  it('stays quiet for a claimed framework that already has a reader', async () => {
    const result = await scan({
      'src/agent.py': `from pydantic_ai import Agent

support = Agent("openai:gpt-4o")
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.ok(agentIdentities(result).includes('agent:support'));
    assert.equal(result.agentSystemDetected, true);
  });

  it('leaves a claimed LangGraph factory on its adapter rather than this gap', async () => {
    const result = await scan({
      'src/graph.py': `from langgraph.prebuilt import create_react_agent

graph = create_react_agent(model="openai:gpt-4o", tools=[])
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.equal(
      result.graph.coverage.unsupported.some(
        (area) => area.kind === 'unclaimed_imported_construction',
      ),
      false,
    );
  });

  it('stays quiet for a type-only import', async () => {
    const result = await scan({
      'src/app.py': `from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from unknown_agents import Factory

runtime = Factory(tools=[], model="x")
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('stays quiet for a local sibling module', async () => {
    const result = await scan({
      'src/unknown_agents.py': `def Factory(**kwargs):
    return kwargs
`,
      'src/app.py': `from unknown_agents import Factory

runtime = Factory(tools=[], model="x")
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.deepEqual(agentIdentities(result), []);
  });

  it('stays quiet for a relative JavaScript module', async () => {
    const result = await scan({
      'src/local-agents.ts': `export class Factory {}
`,
      'src/app.ts': `import { Factory } from './local-agents.ts';

export const runtime = new Factory({ tools: [], model: 'x' });
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  /**
   * This pin asserted the opposite until the 0.9.2 acceptance check measured the belief behind it.
   *
   * The belief was that a wrapper naming a model identifier is a model reference rather than a
   * construction this build failed to read. Row 2 of that check's silent false negatives is
   * `OllamaChatCompletionClient(model=..., client_host=..., timeout=300.0)` at `T1 chat_core.py:25`,
   * recorded as "nothing": a construction from a distribution no adapter claims, carrying a declared
   * 300-second timeout, that produced no component, no finding and no refusal. The wrapper is where the
   * model identity and the deadline both live, so its silence is the loss, not a saving.
   *
   * What has not changed is the half that matters: no agent is invented, here or anywhere, from an
   * argument name.
   */
  it('records a model wrapper from a distribution no adapter claims', async () => {
    const result = await scan({
      'src/model.py': `from unknown_agents import LiteLLMModel

model = LiteLLMModel(model_id="ollama_chat/qwen2.5")
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown_agents.LiteLLMModel is constructed at src/model.py:3 and no adapter claims that distribution',
    );
    assert.deepEqual(agentIdentities(result), []);
  });

  it('stays quiet for a local class that happens to be named Agent', async () => {
    const result = await scan({
      'src/app.py': `class Agent:
    def __init__(self, tools, model):
        self.tools = tools
        self.model = model

runtime = Agent(tools=[], model="x")
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.deepEqual(agentIdentities(result), []);
  });

  it('stays quiet inside test files', async () => {
    const result = await scan({
      'tests/test_app.py': `from unknown_agents import Factory

runtime = Factory(tools=[], model="x")
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('stays quiet for an OpenAI-style tool-schema payload', async () => {
    const result = await scan({
      'src/client.py': `from unknown_llm import completion

completion(
    model="gpt-4o",
    tools=[{"type": "function", "function": {"name": "search"}}],
)
`,
    });

    assert.deepEqual(unclaimed(result), []);
    assert.deepEqual(agentIdentities(result), []);
  });

  it('does not mint an agent from the argument names alone', async () => {
    const result = await scan({
      'src/app.py': `from unknown_agents import Agent, Tool, CodeAgent

agent = Agent(tools=[Tool()], model="x")
other = CodeAgent(tools=tools, model=model)
`,
    });

    assert.deepEqual(agentIdentities(result), []);
    assert.equal(result.agentSystemDetected, false);
    assert.equal(unclaimed(result).length, 2);
    assert.ok(result.graph.components.every((component) => component.kind !== 'agent'));
  });
});

/**
 * Provenance, asked before the argument test.
 *
 * Every case here is a name the reader would otherwise call a distribution no adapter claims, and each
 * one is owned by somebody: the interpreter, or a file this repository writes. They are pinned before the
 * reader is widened, because the conjunction above fires so rarely that none of them is reachable today
 * and all of them become wrong answers the moment it is. Measured across the pinned corpus before the
 * gates landed: ten hits on `typing`, five on `dataclasses`, three on `asyncio`, one on `json`, and two
 * on a `@/` alias in `open-agent-platform`, which is a pinned `not_agent_system` entry.
 *
 * Each `it` here is a falsifier: it fails against the revision before these gates. The guards that prove
 * the reader still sees a real distribution are the cases above, which pass on both revisions on purpose.
 */
describe('who owns a name the reader would otherwise call an unclaimed distribution', () => {
  it('leaves the Python standard library to the interpreter', async () => {
    const result = await scan({
      'src/app.py': `import functools
import dataclasses

bound = functools.partial(build, model='gpt-4o', tools=[search])
spec = dataclasses.replace(base, model='gpt-4o', tools=[search])
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('leaves a bare Node builtin to the runtime', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/app.js': `import { Worker } from 'worker_threads';

const worker = new Worker(script, { model: 'gpt-4o', tools: [search] });
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('leaves a bundler root alias to the repository that declares it', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'src/lib/agents.ts': 'export const createAgent = (options) => options;\n',
      'src/app.ts': `import { createAgent } from '@/lib/agents';

export const agent = createAgent({ model: 'gpt-4o', tools: [search] });
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('still records a real distribution beside a standard library call in the same file', async () => {
    const result = await scan({
      'src/app.py': `import json
from unknown_agents import Factory

payload = json.dumps({ 'model': 'gpt-4o', 'tools': [] })
runtime = Factory(tools=[search], model=model)
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown_agents.Factory is constructed at src/app.py:5 and no adapter claims that distribution',
    );
  });
});

/**
 * One argument name is enough, and the name is read by its words rather than matched whole.
 *
 * Every case here is a shape the conjunction hid, taken from the 0.9.2 acceptance check's silent false
 * negatives. Google ADK's tenth agent differs from its nine refused siblings by an absent `tools`;
 * AutoGen's assistant spells the model half `model_client`; `node-llama-cpp` spells neither half and
 * names a `systemPrompt`. Each `it` is a falsifier: it fails against the revision before the widening.
 *
 * The guards that keep this precise are the `stays quiet` cases above, which pass on both revisions on
 * purpose, and the two below, which are the suppressors the widening needed.
 */
describe('one argument name a construction carries', () => {
  it('records a construction that names a model and no tools', async () => {
    const result = await scan({
      'src/agent.py': `from unknown_adk.agents import Agent

root_agent = Agent(
    name='agent_id',
    model='gemini-2.5-flash-lite',
    instruction='Answer user questions to the best of your knowledge',
)
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown_adk.Agent is constructed at src/agent.py:3 and no adapter claims that distribution',
    );
    assert.deepEqual(agentIdentities(result), []);
  });

  it('reads a model name spelled as one word of a longer key', async () => {
    const result = await scan({
      'src/chat.py': `from unknown_autogen.agents import AssistantAgent

assistant = AssistantAgent(
    'assistant',
    model_client=client,
    system_message='You are helpful',
)
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown_autogen.AssistantAgent is constructed at src/chat.py:3 and no adapter claims that distribution',
    );
  });

  it('reads a prompt named in camel case', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/session.js': `import { LlamaChatSession } from 'unknown-llama-cpp';

const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: 'Be brief' });
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown-llama-cpp.LlamaChatSession is constructed at src/session.js:3 and no adapter claims that distribution',
    );
  });

  it('names the argument that fired in the reason and keeps the area free of it', async () => {
    const result = await scan({
      'src/agent.py': `from unknown_agents import Runtime

runtime = Runtime(modelPath='/models/q4.gguf')
`,
    });

    const area = unclaimed(result)[0];
    assert.equal(
      area?.area,
      'unknown_agents.Runtime is constructed at src/agent.py:3 and no adapter claims that distribution',
    );
    assert.match(area?.reason ?? '', /argument named modelPath/);
  });

  it('stays quiet for a schema builder whose every field is another call to the same library', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/schema.js': `import { z } from 'unknown-schema';

export const Body = z.object({ model: z.string().optional(), tools: z.array(z.string()) });
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('samples across distributions rather than letting one directory fill the list', async () => {
    const files: Record<string, string> = {
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/z-last.js': `import { Runtime } from 'unknown-rare-framework';

export const runtime = new Runtime({ model: 'gpt-4o' });
`,
    };
    for (let index = 0; index < 20; index += 1) {
      files[`src/a-noisy-${index}.js`] = `import { Client } from 'unknown-busy-library';

export const client${index} = new Client({ model: 'gpt-4o' });
`;
    }

    const result = await scan(files);
    const areas = unclaimed(result).map((area) => area.area);

    assert.ok(
      areas.some((area) => area.startsWith('unknown-rare-framework.Runtime is constructed')),
      `the one construction from the rare distribution was evicted by the noisy one: ${areas.join(' | ')}`,
    );
    assert.ok(areas.length <= 11, `the sample is not bounded: ${areas.length} rows`);
    assert.ok(
      areas.some((area) => area.startsWith('further unclaimed imported constructions were found')),
      'the omitted remainder was dropped rather than counted',
    );
  });
});

/**
 * The two suppressors the widening needed, each taken from a repository the corpus already pins.
 *
 * Read what each case is. `still reads a prompt named as the word a key ends with` is a FALSIFIER: it
 * fails against the revision before the widening. The two `stays quiet` cases are GUARDS, and they pass
 * against that revision too, because the conjunction it used made them unreachable. They are here because
 * they failed against the widened predicate before these suppressors were added, measured on the corpus
 * rather than imagined: `click.prompt(prompt_suffix=)` produced three refusals on `crewai`, and
 * `z.object({ selectedChatModel: z.string() })` produced four across `openai-agents-js` and
 * `vercel-ai-chatbot`. A guard that passes both ways is doing its job; a falsifier that does is a defect.
 */
describe('what a widened argument name must not read', () => {
  it('leaves a terminal prompt suffix to the command line library that owns it', async () => {
    const result = await scan({
      'src/cli.py': `import unknown_cli

name = unknown_cli.prompt('Name of your crew', prompt_suffix=' > ')
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('still reads a prompt named as the word a key ends with', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/session.js': `import { Session } from 'unknown-runtime';

const session = new Session({ contextSize: 4096, systemPrompt: 'Be brief' });
`,
    });

    assert.equal(unclaimed(result).length, 1);
  });

  it('stays quiet for a schema builder that names a sibling schema among its fields', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/schema.js': `import { z } from 'unknown-schema';

export const Body = z.object({
  id: z.uuid(),
  message: userMessageSchema.optional(),
  selectedChatModel: z.string(),
});
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('still reads a construction whose arguments are computed by calls of its own', async () => {
    const result = await scan({
      'src/app.py': `from unknown_agents import Agent

runtime = Agent(model=get_model(), tools=get_tools())
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown_agents.Agent is constructed at src/app.py:3 and no adapter claims that distribution',
    );
  });
});

/**
 * A package this repository defines is its own, whatever it is reachable from.
 *
 * `still records a distribution that only resembles a directory this repository holds` is a FALSIFIER.
 * The two `is local` cases are GUARDS against the revision before the widening, which could not reach
 * them, and they were measured firing against the widened predicate before this landed: thirteen
 * refusals across `open-deep-research`, `pydantic-ai`, `tubemind`, `anthropic-quickstarts`,
 * `crewai-examples` and `gpt-researcher` named those repositories' own modules back to them.
 * `open_deep_research` and `pydantic_ai_examples` carry no `__init__.py`; `marketing_posts` sits under a
 * nested `src`.
 */
describe('a package this repository defines', () => {
  it('is local without an __init__.py, which is a package under PEP 420', async () => {
    const result = await scan({
      'src/open_deep_research/deep_researcher.py': `from open_deep_research.prompts import research_system_prompt

agent = research_system_prompt(model='gpt-4o')
`,
      'src/open_deep_research/prompts.py': 'def research_system_prompt(model):\n    return model\n',
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('is local under a nested source root', async () => {
    const result = await scan({
      'integrations/strategy/src/marketing_posts/__init__.py': '',
      'integrations/strategy/src/marketing_posts/llm.py': 'nvllm = None\n',
      'integrations/strategy/src/marketing_posts/crew.py': `from marketing_posts.llm import nvllm

crew = nvllm(model='meta/llama3')
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('still records a distribution that only resembles a directory this repository holds', async () => {
    const result = await scan({
      'src/smol_jobscout/model.py': `from smolagents import LiteLLMModel

model = LiteLLMModel(model_id='ollama_chat/qwen2.5')
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'smolagents.LiteLLMModel is constructed at src/smol_jobscout/model.py:3 and no adapter claims that distribution',
    );
  });
});

/**
 * A call on a value this repository built and kept.
 *
 * `this.ollama = new Ollama({ host })` then `this.ollama.chat({ model })` is the shape the 0.9.2
 * acceptance check recorded as rows 11 and 12 of its silent false negatives: a complete hand written
 * agent loop whose MCP half was refused correctly and whose model half said nothing, because the second
 * call carries no import origin for any net to key on.
 *
 * All three are FALSIFIERS. The argument-name rule applies here exactly as it does to a construction,
 * and the guard below is why: without it this net reads every web framework route registration. Measured
 * before it was applied, thirteen hits on one Express server against three real ones in the same file.
 */
describe('a call on a receiver built from an unclaimed distribution', () => {
  it('records a model call on a field the constructor bound', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/loop.js': `import { Ollama } from 'unknown-ollama';

export class LoopWithMCP {
  constructor(config) {
    this.ollama = new Ollama({ host: config.host });
  }

  async chat(messages) {
    return this.ollama.chat({ model: 'qwen2.5', messages, stream: false });
  }
}
`,
    });

    assert.equal(unclaimed(result).length, 1);
    assert.equal(
      unclaimed(result)[0]?.area,
      'unknown-ollama.this.ollama.chat is called at src/loop.js:9 and no adapter claims that distribution',
    );
    assert.deepEqual(agentIdentities(result), []);
  });

  it('says the call was called rather than constructed, and why, in the reason', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/loop.js': `import { Ollama } from 'unknown-ollama';

const client = new Ollama({ host: 'http://127.0.0.1:11434' });
export const ask = (messages) => client.chat({ model: 'qwen2.5', messages });
`,
    });

    const area = unclaimed(result)[0];
    assert.match(area?.area ?? '', /^unknown-ollama\.client\.chat is called at src\/loop\.js:4/);
    assert.match(area?.reason ?? '', /called on a value this repository built/);
  });

  /**
   * GUARD. A value a library returned is not an instance of that library.
   *
   * Measured on the corpus before the module-scope bound: `const items = useMemo(...)` inside a component
   * made `items.push({ toolName })` a call to `react`, and a pydantic `Field(default=None)` on a class
   * made `agent.execute_task(tools=...)` a call to `pydantic`. Both name an owner that is not the owner.
   */
  it('leaves a value bound inside a function to the scope that computed it', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/view.js': `import { useMemo } from 'unknown-view';

export function List(input) {
  const items = useMemo(() => [], [input]);
  items.push({ toolName: 'search', model: 'gpt-4o' });
  return items;
}
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });

  it('leaves a route handler to the web framework that owns it', async () => {
    const result = await scan({
      'package.json': '{ "name": "fixture", "version": "1.0.0", "type": "module" }',
      'src/server.js': `import express from 'unknown-express';

const app = express();
app.get('/health', (request, response) => response.send('ok'));
app.post('/chat', (request, response) => response.send('ok'));
`,
    });

    assert.deepEqual(unclaimed(result), []);
  });
});
