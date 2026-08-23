import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writeNodeProject, writePythonProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

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

const scan = async (build: (workspace: ReturnType<typeof createTempWorkspace>) => void) => {
  const workspace = createTempWorkspace('orchescope-prompt-');
  workspaces.push(workspace);
  build(workspace);
  const clock = fixedClock(0);
  const handle = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'fixture',
      orchescopeVersion: '0.1.0',
      clock,
      deadline: handle,
      traversal,
      concurrency: 4,
    });
  } finally {
    handle.dispose();
  }
};

const promptProjection = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components
    .filter((component) => component.kind === 'prompt')
    .map((component) => ({
      id: component.id,
      displayName: component.displayName,
      details: component.details,
      metadata: component.metadata,
    }));

describe('source-bound prompt settlement', () => {
  it('does not promote unrelated Docker, pip, SQL or logging text when a model exists elsewhere', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'unrelated-text',
        dependencies: ['pydantic-ai>=1.0'],
      });
      workspace.write(
        'src/app.py',
        `from pydantic_ai import Agent

desk = Agent('openai:gpt-4.1-mini')
docker = "RUN uv pip uninstall setuptools && uv pip install --system --no-cache-dir package"
query = "SELECT every column FROM customer_orders WHERE the order status has not changed"
print("You are the system assistant. Always answer every logging question step by step.")
`,
      );
    });

    assert.deepEqual(promptProjection(result), []);
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'uses_prompt'),
      false,
    );
  });

  it('keeps a partly unresolved template as the prompt instead of promoting one incidental constant', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'interpolated-prompt',
        dependencies: ['pydantic-ai>=1.0'],
      });
      workspace.write(
        'src/app.py',
        `from pydantic_ai import Agent

SYSTEM = "Answer from the supplied context and cite the relevant source."
desk = Agent('openai:gpt-4.1-mini')

async def answer(retrieved):
    return await desk.run(f"{SYSTEM}\\n\\n{retrieved}")
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 1);
    assert.notEqual(prompts[0]?.displayName, 'SYSTEM');
    assert.equal(prompts[0]?.details?.for, 'prompt');
    assert.equal(
      prompts[0]?.details?.for === 'prompt'
        ? prompts[0].details.interpolatesUntrustedInput
        : undefined,
      true,
    );
    assert.equal(result.graph.edges.filter((edge) => edge.kind === 'uses_prompt').length, 1);
  });

  it('keeps all-static template assembly quiet and mixed assembly interpolated', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'template-trust',
        dependencies: { openai: '^5.0.0' },
      });
      workspace.write(
        'src/app.ts',
        `import OpenAI from 'openai';
const client = new OpenAI();
const ROLE = 'You are a support assistant.';
const RULE = 'Answer briefly.';

export function staticAssembly() {
  return client.responses.create({ model: 'gpt-4.1-mini', input: \`\${ROLE} \${RULE}\` });
}

export function literalAssembly() {
  return client.responses.create({ model: 'gpt-4.1-mini', input: \`Use exactly \${1} source.\` });
}

export function mixedAssembly(question: string) {
  return client.responses.create({ model: 'gpt-4.1-mini', input: \`\${ROLE} \${question}\` });
}
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    const role = prompts.find((prompt) => prompt.displayName === 'ROLE');
    const rule = prompts.find((prompt) => prompt.displayName === 'RULE');
    assert.equal(role?.details?.for === 'prompt' && role.details.interpolatesUntrustedInput, false);
    assert.equal(rule?.details?.for === 'prompt' && rule.details.interpolatesUntrustedInput, false);
    assert.equal(
      prompts.filter(
        (prompt) => prompt.details?.for === 'prompt' && !prompt.details.interpolatesUntrustedInput,
      ).length,
      3,
    );
    assert.equal(
      prompts.filter(
        (prompt) => prompt.details?.for === 'prompt' && prompt.details.interpolatesUntrustedInput,
      ).length,
      1,
    );
  });

  it('discovers short prompts from API semantics without lexical hints or a token threshold', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'short-prompt',
        dependencies: ['pydantic-ai>=1.0'],
      });
      workspace.write(
        'src/app.py',
        `from pydantic_ai import Agent

desk = Agent('openai:gpt-4.1-mini', instructions="Hi")
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 1);
    assert.equal(
      prompts[0]?.details?.for === 'prompt' ? prompts[0].details.approximateTokens : 0,
      1,
    );
  });

  it('gives two anonymous slots in one consumer and channel distinct source identities', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'anonymous-prompts',
        dependencies: { openai: '^5.0.0' },
      });
      workspace.write(
        'src/app.ts',
        `import OpenAI from 'openai';
const client = new OpenAI();

export async function answer() {
  await client.responses.create({ model: 'gpt-4.1-mini', input: 'First' });
  return client.responses.create({ model: 'gpt-4.1-mini', input: 'Second' });
}
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 2);
    assert.equal(new Set(prompts.map((prompt) => prompt.id)).size, 2);
    assert.equal(result.graph.edges.filter((edge) => edge.kind === 'uses_prompt').length, 2);
  });

  it('keeps same-named local prompt constants separate by lexical owner', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'local-prompt-owners',
        dependencies: { openai: '^5.0.0' },
      });
      workspace.write(
        'src/app.ts',
        `import OpenAI from 'openai';
const client = new OpenAI();

export function first() {
  const PROMPT = 'First local instruction.';
  return client.responses.create({ model: 'gpt-4.1-mini', input: PROMPT });
}

export function second() {
  const PROMPT = 'Second local instruction.';
  return client.responses.create({ model: 'gpt-4.1-mini', input: PROMPT });
}
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 2);
    assert.equal(new Set(prompts.map((prompt) => prompt.id)).size, 2);
    assert.equal(
      new Set(
        prompts.map((prompt) =>
          prompt.details?.for === 'prompt' ? prompt.details.textHash : undefined,
        ),
      ).size,
      2,
    );
    assert.equal(result.graph.edges.filter((edge) => edge.kind === 'uses_prompt').length, 2);
  });

  it('resolves same-line constants only when their declaration ends before the use', async () => {
    const result = await scan((workspace) => {
      writeNodeProject(workspace, {
        name: 'same-line-prompt-order',
        dependencies: { openai: '^5.0.0' },
      });
      workspace.write(
        'src/app.ts',
        `import OpenAI from 'openai';
const client = new OpenAI();
export function before() { const PROMPT = 'Declared before use.'; return client.responses.create({ model: 'gpt-4.1-mini', input: PROMPT }); }
export function after() { const answer = client.responses.create({ model: 'gpt-4.1-mini', input: PROMPT }); const PROMPT = 'Declared after use.'; return answer; }
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]?.displayName, 'PROMPT');
    assert.equal(
      result.graph.coverage.topology?.unresolved.some(
        (entry) => entry.scope === 'prompt_use' && /ambiguous, shadowed/u.test(entry.reason),
      ),
      true,
    );
  });

  it('requires exact dynamic_prompt wiring and a literal return value', async () => {
    const result = await scan((workspace) => {
      writePythonProject(workspace, {
        name: 'dynamic-prompt',
        dependencies: ['langchain>=1.2'],
      });
      workspace.write(
        'src/app.py',
        `from langchain.agents import create_agent
from langchain.agents.middleware import dynamic_prompt

@dynamic_prompt
def wired(request):
    return f"Answer briefly for {request.runtime.context.user_role}"

@dynamic_prompt
def unwired(request):
    return "This is not connected to an agent."

@dynamic_prompt
def no_value(request):
    """You are a documentation-only system prompt."""
    return None

@dynamic_prompt
def computed(request):
    return build_prompt(request)

def local_dynamic_prompt(function):
    return function

@local_dynamic_prompt
def lookalike(request):
    return "A decorator name without the provider import proves nothing."

assistant = create_agent(
    model="openai:gpt-4.1-mini",
    name="assistant",
    system_prompt=load_prompt("assistant"),
    middleware=[wired, no_value, lookalike, computed, build_middleware()],
)

DEFAULT_MIDDLEWARE = [wired]

def shadowed_factory(DEFAULT_MIDDLEWARE):
    return create_agent(
        model="openai:gpt-4.1-mini",
        tools=[],
        name="shadowed",
        middleware=DEFAULT_MIDDLEWARE,
    )

def direct_shadow(wired):
    return create_agent(
        model="openai:gpt-4.1-mini",
        tools=[],
        name="direct-shadow",
        middleware=[wired],
    )
`,
      );
    });

    const prompts = result.graph.components.filter((component) => component.kind === 'prompt');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]?.displayName ?? '', /wired/);
    assert.equal(
      prompts.some((prompt) => /unwired|no_value/.test(prompt.displayName)),
      false,
    );
    const promptRefusals = result.graph.coverage.topology?.unresolved.filter(
      (entry) => entry.scope === 'prompt_use',
    );
    assert.equal(
      promptRefusals?.some((entry) => /system_prompt.*computed/u.test(entry.reason)),
      true,
    );
    assert.equal(
      promptRefusals?.some((entry) =>
        /middleware\.dynamic_prompt\.computed.*computed/u.test(entry.reason),
      ),
      true,
    );
    const unresolvedMiddlewarePopulation = promptRefusals?.filter((entry) =>
      entry.reason.includes('middleware.dynamic_prompt: prompt value is computed'),
    );
    assert.deepEqual(
      unresolvedMiddlewarePopulation?.map((entry) => entry.location?.startLine),
      [32, 42, 50],
      'the computed list item, shadowed list binding and shadowed direct item are three distinct refusals',
    );
    assert.equal(promptRefusals?.length, 5);
  });
});
