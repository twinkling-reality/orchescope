import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writePythonProject } from '@orchescope/testkit';
import { modelSdkAdapter } from '../src/adapters/model-sdk.ts';
import { searchIndexAdapter } from '../src/adapters/search-index.ts';
import { discover } from '../src/discover.ts';

const workspaces: { dispose: () => void }[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (source: string) => {
  const workspace = createTempWorkspace('orchescope-nested-module-binding-');
  workspaces.push(workspace);
  writePythonProject(workspace, {
    name: 'nested-bindings',
    dependencies: ['openai>=1.0', 'tavily-python>=0.7'],
  });
  workspace.write('src/app.py', source);
  const clock = fixedClock(0);
  const deadline = createDeadline(30_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'nested-bindings',
      orchescopeVersion: '0.9.0',
      clock,
      deadline,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 50,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 2,
      adapters: [modelSdkAdapter, searchIndexAdapter],
    });
  } finally {
    deadline.dispose();
  }
};

const scanJavaScript = async (source: string) => {
  const workspace = createTempWorkspace('orchescope-nested-module-binding-js-');
  workspaces.push(workspace);
  workspace.write(
    'package.json',
    JSON.stringify({ name: 'nested-bindings-js', dependencies: { openai: '^5.0.0' } }),
  );
  workspace.write('src/app.ts', source);
  const clock = fixedClock(0);
  const deadline = createDeadline(30_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'nested-bindings-js',
      orchescopeVersion: '0.9.0',
      clock,
      deadline,
      traversal: {
        maxFileBytes: 512 * 1024,
        maxFiles: 50,
        followSymlinks: false,
        excludeDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
        excludePrefixes: [],
      },
      concurrency: 2,
      adapters: [modelSdkAdapter],
    });
  } finally {
    deadline.dispose();
  }
};

describe('nested module binding authority', () => {
  it('discovers function-scoped namespace clients without inventing a dynamic compatible provider', async () => {
    const result = await scan(`def llm_call(api_base, api_key, model, messages):
    try:
        import openai as openai_lib
    except ImportError:
        raise RuntimeError("openai is required")
    client = openai_lib.OpenAI(base_url=api_base, api_key=api_key)
    return client.chat.completions.create(model=model, messages=messages)

def vision_call(api_base, api_key, model, messages):
    import openai as openai_lib
    client = openai_lib.OpenAI(base_url=api_base, api_key=api_key)
    return client.chat.completions.create(model=model, messages=messages)
`);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('agent:llm_call'), `missing llm_call in ${ids.join(', ')}`);
    assert.ok(ids.includes('agent:vision_call'), `missing vision_call in ${ids.join(', ')}`);
    assert.equal(
      ids.some((id) => id.startsWith('provider:')),
      false,
    );
    assert.equal(
      ids.some((id) => id.startsWith('model:')),
      false,
    );
    const adapter = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:model-sdk',
    );
    assert.equal(adapter?.status, 'completed');
    assert.equal(adapter?.applicability?.relevantImports, 2);
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.location?.file === 'src/app.py' &&
          entry.reason.includes('provider identity is selected at run time'),
      ),
    );
  });

  it('does not grant one function-scoped namespace import to another lexical scope', async () => {
    const result = await scan(`def owner():
    import openai as sdk
    client = sdk.OpenAI()
    return client.responses.create(model="owned", input="hello")

def sibling():
    client = sdk.OpenAI()
    return client.responses.create(model="sibling", input="hello")

def imported_after_use():
    client = late.OpenAI()
    import openai as late
    return client.responses.create(model="late", input="hello")

def parameter_shadow(sdk):
    client = sdk.OpenAI()
    return client.responses.create(model="parameter", input="hello")

def rebound():
    import openai as changed
    changed = replacement
    client = changed.OpenAI()
    return client.responses.create(model="rebound", input="hello")

def unrelated():
    import foreign as other
    client = other.OpenAI()
    return client.responses.create(model="foreign", input="hello")
`);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('agent:owner'));
    for (const rejected of ['sibling', 'late', 'parameter', 'rebound', 'foreign']) {
      assert.equal(
        ids.some((id) => id.includes(rejected)),
        false,
        `${rejected} crossed a lexical provider boundary: ${ids.join(', ')}`,
      );
    }
  });

  it('refuses a provider identity after competing branch-local clients join', async () => {
    const result = await scan(`from openai import OpenAI

def joined(flag, endpoint):
    if flag:
        client = OpenAI(base_url=endpoint)
    else:
        client = OpenAI()
    return client.responses.create(model="branch-model", input="hello")
`);
    assert.equal(
      result.graph.components.some((component) => component.id === 'model:openai/branch-model'),
      false,
    );
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'invokes_model'),
      false,
    );
    assert.ok(result.graph.components.some((component) => component.id === 'agent:joined'));
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.location?.file === 'src/app.py' &&
          entry.reason.includes('more than one provider client at this control-flow join'),
      ),
    );
  });

  it('explains an unsettled call when only one branch has a recognized client', async () => {
    const controls = [
      [
        true,
        `def target(flag):
    try:
        client = OpenAI()
    except RuntimeError:
        return "failed"
    return client.responses.create(model="try-only", input="hello")`,
      ],
      [
        true,
        `def target(items):
    for _ in items:
        client = OpenAI()
    return client.responses.create(model="loop-only", input="hello")`,
      ],
      [
        false,
        `def target(flag, custom_client):
    if flag:
        client = OpenAI()
    else:
        client = custom_client()
    return client.responses.create(model="mixed-only", input="hello")`,
      ],
      [
        false,
        `def target(client, flag):
    if flag:
        client = OpenAI()
    return client.responses.create(model="parameter-only", input="hello")`,
      ],
      [
        false,
        `class Target:
    def target(self, flag):
        if flag:
            self.client = OpenAI()
        return self.client.responses.create(model="member-only", input="hello")`,
      ],
    ] as const;
    for (const [expectAgent, source] of controls) {
      const result = await scan(`from openai import OpenAI

${source}
`);
      assert.equal(
        result.graph.components.some((component) => component.kind === 'model'),
        false,
      );
      assert.equal(
        result.graph.components.some((component) => component.id === 'agent:target'),
        expectAgent,
      );
      assert.ok(
        result.graph.coverage.topology?.unresolved.some(
          (entry) =>
            entry.location?.file === 'src/app.py' &&
            entry.reason.includes('no provider client settled on every path'),
        ),
      );
    }
  });

  it('keeps calls inside their own client branch while refusing its dynamic provider', async () => {
    const result = await scan(`from openai import OpenAI

def routed(flag, endpoint):
    if flag:
        client = OpenAI(base_url=endpoint)
        return client.responses.create(model="dynamic-model", input="hello")
    else:
        client = OpenAI()
        return client.responses.create(model="resolved-model", input="hello")
`);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('agent:routed'));
    assert.ok(ids.includes('model:openai/resolved-model'));
    assert.equal(ids.includes('model:openai/dynamic-model'), false);
    assert.ok(
      result.graph.edges.some(
        (edge) =>
          edge.kind === 'invokes_model' &&
          edge.from === 'agent:routed' &&
          edge.to === 'model:openai/resolved-model',
      ),
    );
  });

  it('refuses alternate control-flow clients while keeping straight-line settlement', async () => {
    const controls = [
      [
        'if-model',
        `def target(flag, endpoint):
    client = OpenAI()
    if flag:
        client = OpenAI(base_url=endpoint)
    return client.responses.create(model="if-model", input="hello")`,
      ],
      [
        'loop-model',
        `def target(items, endpoint):
    client = OpenAI(base_url=endpoint)
    for _ in items:
        client = OpenAI()
    return client.responses.create(model="loop-model", input="hello")`,
      ],
      [
        'try-model',
        `def target(endpoint):
    client = OpenAI(base_url=endpoint)
    try:
        client = OpenAI()
    except RuntimeError:
        pass
    return client.responses.create(model="try-model", input="hello")`,
      ],
      [
        'loop-else-model',
        `def target(items, endpoint):
    client = OpenAI(base_url=endpoint)
    for item in items:
        if item:
            break
    else:
        client = OpenAI()
    return client.responses.create(model="loop-else-model", input="hello")`,
      ],
      [
        'match-model',
        `def target(choice, endpoint):
    match choice:
        case "dynamic":
            client = OpenAI(base_url=endpoint)
        case _:
            client = OpenAI()
    return client.responses.create(model="match-model", input="hello")`,
      ],
      [
        'selection-model',
        `def target(flag, endpoint):
    client = OpenAI() if flag else OpenAI(base_url=endpoint)
    return client.responses.create(model="selection-model", input="hello")`,
      ],
    ] as const;
    for (const [refused, source] of controls) {
      const result = await scan(`from openai import OpenAI

${source}
`);
      const ids = result.graph.components.map((component) => component.id);
      assert.equal(
        ids.includes(`model:openai/${refused}`),
        false,
        `${refused} borrowed one competing client identity`,
      );
      assert.ok(ids.includes('agent:target'), `${refused} hid its supported model boundary`);
      assert.ok(
        result.graph.coverage.topology?.unresolved.some((entry) =>
          entry.reason.includes('more than one provider client at this control-flow join'),
        ),
        `${refused} omitted its control-flow join refusal`,
      );
    }

    const straight = await scan(`from openai import OpenAI

def straight(endpoint):
    client = OpenAI(base_url=endpoint)
    client = OpenAI()
    return client.responses.create(model="straight-model", input="hello")
`);
    assert.ok(
      straight.graph.components.some((component) => component.id === 'model:openai/straight-model'),
    );

    const insideLoopElse = await scan(`from openai import OpenAI

def target(items):
    for item in items:
        if item:
            break
    else:
        client = OpenAI()
        return client.responses.create(model="inside-loop-else", input="hello")
    return "stopped"
`);
    assert.ok(
      insideLoopElse.graph.components.some(
        (component) => component.id === 'model:openai/inside-loop-else',
      ),
    );

    const sameLineResolved = await scan(`from openai import OpenAI

def target(endpoint):
    client = OpenAI(base_url=endpoint); client = OpenAI(); return client.responses.create(model="same-line-resolved", input="hello")
`);
    assert.ok(
      sameLineResolved.graph.components.some(
        (component) => component.id === 'model:openai/same-line-resolved',
      ),
    );
    assert.equal(
      sameLineResolved.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('control-flow join'),
      ),
      false,
    );

    const sameLineDynamic = await scan(`from openai import OpenAI

def target(endpoint):
    client = OpenAI(); client = OpenAI(base_url=endpoint); return client.responses.create(model="same-line-dynamic", input="hello")
`);
    assert.equal(
      sameLineDynamic.graph.components.some(
        (component) => component.id === 'model:openai/same-line-dynamic',
      ),
      false,
    );
    assert.equal(
      sameLineDynamic.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('control-flow join'),
      ),
      false,
    );
    assert.ok(
      sameLineDynamic.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('provider identity is selected at run time'),
      ),
    );

    const resolvedFinally = await scan(`from openai import OpenAI

def target(endpoint):
    client = OpenAI(base_url=endpoint)
    try:
        pass
    finally:
        client = OpenAI()
    return client.responses.create(model="finally-resolved", input="hello")
`);
    assert.ok(
      resolvedFinally.graph.components.some(
        (component) => component.id === 'model:openai/finally-resolved',
      ),
    );
    assert.equal(
      resolvedFinally.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('control-flow join'),
      ),
      false,
    );

    const dynamicFinally = await scan(`from openai import OpenAI

def target(endpoint):
    client = OpenAI()
    try:
        pass
    finally:
        client = OpenAI(base_url=endpoint)
    return client.responses.create(model="finally-dynamic", input="hello")
`);
    assert.equal(
      dynamicFinally.graph.components.some(
        (component) => component.id === 'model:openai/finally-dynamic',
      ),
      false,
    );
    assert.equal(
      dynamicFinally.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('control-flow join'),
      ),
      false,
    );
    assert.ok(
      dynamicFinally.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('provider identity is selected at run time'),
      ),
    );

    const successfulTryElse = await scan(`from openai import OpenAI

def target():
    try:
        client = OpenAI()
    except RuntimeError:
        return "failed"
    else:
        return client.responses.create(model="try-else-success", input="hello")
`);
    assert.ok(
      successfulTryElse.graph.components.some(
        (component) => component.id === 'model:openai/try-else-success',
      ),
    );
    assert.equal(
      successfulTryElse.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('control-flow join'),
      ),
      false,
    );
  });

  it('keeps real global SDK receivers and rejects a containing parameter with the same name', async () => {
    const result = await scan(`from openai import OpenAI

client = OpenAI()

def valid():
    return client.responses.create(model="real-global", input="hello")

def outer(client):
    def nested():
        return client.responses.create(model="false-nested-receiver", input="hello")
    return nested()
`);
    const ids = result.graph.components.map((component) => component.id);
    assert.ok(ids.includes('model:openai/real-global'));
    assert.equal(ids.includes('model:openai/false-nested-receiver'), false);
  });

  it('refuses a JavaScript client whose later assignment is not source-settled', async () => {
    const result = await scanJavaScript(`import OpenAI from 'openai';

export function target(flag: boolean, endpoint: string) {
  let client = new OpenAI();
  if (flag) client = new OpenAI({ baseURL: endpoint });
  return client.responses.create({ model: 'js-optional', input: 'hello' });
}
`);
    assert.equal(
      result.graph.components.some((component) => component.id === 'model:openai/js-optional'),
      false,
    );
    assert.equal(
      result.graph.edges.some((edge) => edge.kind === 'invokes_model'),
      false,
    );
    assert.ok(result.graph.components.some((component) => component.id === 'agent:target'));
    assert.ok(
      result.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.location?.file === 'src/app.ts' &&
          entry.reason.includes('reassigned before this call'),
      ),
    );
  });

  it('keeps a real global search receiver and rejects a containing parameter fallback', async () => {
    const result = await scan(`from tavily import TavilyClient

search = TavilyClient()

def valid():
    return search.search("real global query")

def outer(search):
    def nested():
        return search.search("false nested query")
    return nested()
`);
    const queries = result.graph.edges.filter((edge) => edge.kind === 'queries_retrieval');
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.sourceLocations.some((location) => location.startLine === 6));
    assert.equal(
      queries[0]?.sourceLocations.some((location) => location.startLine === 10),
      false,
    );
  });
});
