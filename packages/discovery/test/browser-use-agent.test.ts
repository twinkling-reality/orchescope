import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createDeadline, fixedClock } from '@orchescope/domain';
import { DEFAULT_EXCLUDED_DIRECTORIES } from '@orchescope/source-analysis';
import { createTempWorkspace, writePythonProject } from '@orchescope/testkit';
import { discover } from '../src/discover.ts';

const workspaces: ReturnType<typeof createTempWorkspace>[] = [];

after(() => {
  for (const workspace of workspaces) workspace.dispose();
});

const scan = async (files: Readonly<Record<string, string>>, dependencies = ['browser-use']) => {
  const workspace = createTempWorkspace('orchescope-browser-use-');
  workspaces.push(workspace);
  writePythonProject(workspace, { name: 'browser-agent', dependencies });
  for (const [file, source] of Object.entries(files)) workspace.write(file, source);
  const clock = fixedClock(0);
  const deadline = createDeadline(60_000, clock.monotonicMs);
  try {
    return await discover({
      root: workspace.root,
      projectName: 'browser-agent',
      orchescopeVersion: '0.9.1',
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

const browserAgents = (result: Awaited<ReturnType<typeof scan>>) =>
  result.graph.components.filter(
    (component) =>
      component.kind === 'agent' && component.discoveredBy.includes('adapter:browser-use-agent'),
  );

describe('browser-use Agent discovery', () => {
  it('settles a returned Agent factory and preserves its exact run boundary', async () => {
    const result = await scan({
      'src/browser_app/agent.py': `from browser_use import Agent

def build_agent(task, llm):
    return Agent(task=task, llm=llm)
`,
      'src/browser_app/__init__.py': '',
      'src/browser_app/runner.py': `from browser_app.agent import build_agent

async def run_task(task, llm, settings):
    agent = build_agent(task, llm)
    return await agent.run(max_steps=settings.max_steps)
`,
    });

    const agents = browserAgents(result);
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.identity.localName, 'run_task.agent');
    assert.deepEqual(
      agents[0]?.sourceLocations.map((location) => [location.file, location.startLine]).sort(),
      [
        ['src/browser_app/agent.py', 1],
        ['src/browser_app/agent.py', 4],
        ['src/browser_app/runner.py', 4],
        ['src/browser_app/runner.py', 5],
      ],
    );
    const cited = result.evidence.filter((evidence) => agents[0]?.evidence.includes(evidence.id));
    assert.ok(
      cited.some(
        (evidence) =>
          evidence.kind === 'source_span' &&
          evidence.producer === 'adapter:browser-use-agent' &&
          evidence.location.file === 'src/browser_app/runner.py' &&
          evidence.location.startLine === 5,
      ),
      'the exact agent.run call must support the retained agent boundary',
    );
    const adapter = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:browser-use-agent',
    );
    assert.equal(adapter?.status, 'completed');
    assert.equal(adapter?.componentsFound, 1);
    assert.equal(adapter?.edgesFound, 0);
    assert.equal(adapter?.filesInspected, 2);
    assert.equal(
      adapter?.detail,
      'Browser-use agent identities were discovered; 1 exact Agent.run boundary was source-settled, and runtime-selected browser control flow remains unresolved.',
    );
    assert.deepEqual(adapter?.applicability, {
      relevantImports: 1,
      distinctFiles: 1,
      omittedImports: 0,
      sample: [
        {
          module: 'browser_use',
          imported: 'Agent',
          location: {
            file: 'src/browser_app/agent.py',
            startLine: 1,
            startColumn: 24,
            endLine: 1,
            endColumn: 29,
          },
        },
      ],
    });
    const topology = result.graph.coverage.topology;
    assert.equal(topology?.status, 'incomplete');
    assert.equal(topology?.entryBoundaries, 1);
    assert.ok(
      topology?.unresolved.some(
        (entry) => entry.kind === 'config_backed_bound' && entry.location?.startLine === 5,
      ),
    );
    assert.ok(
      topology?.unresolved.some(
        (entry) =>
          entry.scope === 'prompt_use' && entry.reason.includes('adapter:browser-use-agent task'),
      ),
      'the dynamic browser task must become a prompt-use refusal',
    );
  });

  it('supports direct, renamed and namespace Agent imports without guessing a provider', async () => {
    const result = await scan({
      'src/direct.py': `from browser_use import Agent
direct = Agent(task="read the page", llm=model)
await direct.run(max_steps=3)
`,
      'src/renamed.py': `from browser_use import Agent as BrowserAgent
renamed = BrowserAgent(task="read the page", llm=model)
await renamed.run(max_steps=3)
`,
      'src/namespaced.py': `import browser_use as bu
namespaced = bu.Agent(task="read the page", llm=model)
await namespaced.run(max_steps=3)
`,
    });

    assert.deepEqual(
      browserAgents(result)
        .map((component) => component.identity.localName)
        .sort(),
      ['direct', 'namespaced', 'renamed'],
    );
    assert.equal(
      result.graph.edges.some(
        (edge) => edge.kind === 'invokes_model' || edge.kind === 'served_by_provider',
      ),
      false,
      'a computed browser-use model client cannot establish model or provider identity',
    );
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 3);
    assert.equal(result.graph.coverage.topology?.configurationBounds, 0);
    assert.equal(
      result.graph.coverage.topology?.unresolved.some(
        (entry) => entry.kind === 'config_backed_bound',
      ),
      false,
      'a positive literal run limit is exact for that call and needs no refusal or default claim',
    );
  });

  it('refuses foreign, local and shadowed lookalikes and a rebound run receiver', async () => {
    const result = await scan({
      'src/foreign.py': `from foreign_runtime import Agent
foreign = Agent(task="wrong", llm=model)
`,
      'src/shadowed.py': `from browser_use import Agent
Agent = foreign_constructor
shadowed = Agent(task="wrong", llm=model)
`,
      'src/parameter.py': `from browser_use import Agent
def build(Agent):
    return Agent(task="wrong", llm=model)
`,
      'src/rebound.py': `from browser_use import Agent
support = Agent(task="right", llm=model)
support = foreign_agent
await support.run(max_steps=2)
`,
    });

    assert.deepEqual(
      browserAgents(result).map((component) => component.identity.localName),
      ['support'],
    );
    assert.equal(result.graph.coverage.topology?.entryBoundaries, 0);
    const adapter = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:browser-use-agent',
    );
    assert.equal(adapter?.status, 'completed');
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('rebound, mutated or escaped before this call'),
      ),
    );

    const local = await scan({
      'src/local_case.py': `from browser_use import Agent
local = Agent(task="local", llm=model)
`,
      'src/browser_use.py': `class Agent:
    pass
`,
    });
    assert.equal(browserAgents(local).length, 0);
    assert.equal(
      local.graph.coverage.adapters.find((entry) => entry.adapterId === 'adapter:browser-use-agent')
        ?.status,
      'not_applicable',
    );
  });

  it('refuses an ownerless or ambiguous factory instead of minting Agent identity', async () => {
    const result = await scan({
      'src/unsettled.py': `from browser_use import Agent

register(Agent(task=task, llm=model))

def choose(task, llm, flag):
    if flag:
        return Agent(task=task, llm=llm)
    return Agent(task=task, llm=llm)
`,
    });

    assert.equal(browserAgents(result).length, 0);
    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.ok(
      refusals.filter((entry) =>
        entry.reason.includes('no unique direct binding or returned local factory'),
      ).length >= 3,
    );
  });

  it('keeps factories, nested constructions and run receivers inside their exact source bindings', async () => {
    const conditional = await scan({
      'src/conditional.py': `from browser_use import Agent

def build(task, llm, flag):
    if flag:
        return Agent(task=task, llm=llm)
    return foreign

async def execute(task, llm, flag):
    agent = build(task, llm, flag)
    return await agent.run(max_steps=3)
`,
    });
    assert.equal(browserAgents(conditional).length, 0);

    const shadowedFactory = await scan({
      'src/shadowed_factory.py': `from browser_use import Agent

def build(task, llm):
    return Agent(task=task, llm=llm)

async def execute(build, task, llm):
    agent = build(task, llm)
    return await agent.run(max_steps=3)
`,
    });
    assert.equal(browserAgents(shadowedFactory).length, 0);

    const nested = await scan({
      'src/nested.py': `from browser_use import Agent

outer = Agent(task="outer", llm=model, child=Agent(task="inner", llm=model))
await outer.run(max_steps=3)
`,
    });
    assert.deepEqual(
      browserAgents(nested).map((component) => component.identity.localName),
      ['outer'],
    );
    assert.ok(
      nested.graph.coverage.topology?.unresolved.some(
        (entry) =>
          entry.kind === 'adapter_input' &&
          entry.reason.includes('no unique direct binding or returned local factory'),
      ),
    );

    const scoped = await scan({
      'src/scoped.py': `from browser_use import Agent

async def first():
    agent = Agent(task="first", llm=model)
    return await agent.run(max_steps=3)

async def second():
    agent = Agent(task="second", llm=model)
    return await agent.run(max_steps=3)
`,
    });
    const scopedAgents = browserAgents(scoped);
    assert.deepEqual(scopedAgents.map((component) => component.identity.localName).sort(), [
      'first.agent',
      'second.agent',
    ]);
    for (const component of scopedAgents) {
      assert.equal(
        component.sourceLocations.filter(
          (location) => location.startLine === 5 || location.startLine === 9,
        ).length,
        1,
        `${component.id} borrowed the other function's run boundary`,
      );
    }

    const receiverShadow = await scan({
      'src/receiver_shadow.py': `from browser_use import Agent

agent = Agent(task="outer", llm=model)

async def execute():
    agent = foreign
    return await agent.run(max_steps=3)
`,
    });
    const retained = browserAgents(receiverShadow);
    assert.equal(retained.length, 1);
    assert.equal(
      retained[0]?.sourceLocations.some((location) => location.startLine === 7),
      false,
      'a foreign local receiver cannot lend its run call to the module agent',
    );
    assert.equal(receiverShadow.graph.coverage.topology?.entryBoundaries, 0);

    for (const factory of [
      `@foreign
def build(task, llm):
    return Agent(task=task, llm=llm)
`,
      `async def build(task, llm):
    return Agent(task=task, llm=llm)
`,
      `def build(task, llm):
    yield other
    return Agent(task=task, llm=llm)
`,
      `def build(task, llm):
    return Agent(task=task, llm=llm)

build = foreign
`,
    ]) {
      const unsettledFactory = await scan({
        'src/unsettled_factory.py': `from browser_use import Agent

${factory}
async def execute(task, llm):
    agent = build(task, llm)
    return await agent.run(max_steps=3)
`,
      });
      assert.equal(
        browserAgents(unsettledFactory).length,
        0,
        `a decorated, async, generator or rebound factory cannot lend Agent identity:\n${factory}`,
      );
    }

    const awaitedFactory = await scan({
      'src/awaited_factory.py': `from browser_use import Agent

def build(task, llm):
    return Agent(task=task, llm=llm)

async def execute(task, llm):
    agent = await build(task, llm)
    return await agent.run(max_steps=3)
`,
    });
    assert.equal(browserAgents(awaitedFactory).length, 0);

    for (const escapeSource of ['setattr(agent, "run", foreign)', 'mutate(agent)']) {
      const escaped = await scan({
        'src/escaped.py': `from browser_use import Agent

agent = Agent(task="outer", llm=model)
${escapeSource}
await agent.run(max_steps=3)
`,
      });
      const escapedAgents = browserAgents(escaped);
      assert.equal(escapedAgents.length, 1);
      assert.equal(escaped.graph.coverage.topology?.entryBoundaries, 0);
      assert.equal(
        escapedAgents[0]?.sourceLocations.some((location) => location.startLine === 5),
        false,
      );
      const adapter = escaped.graph.coverage.adapters.find(
        (entry) => entry.adapterId === 'adapter:browser-use-agent',
      );
      assert.equal(
        adapter?.detail,
        'Browser-use agent identities were discovered; 0 exact Agent.run boundaries were source-settled, and runtime-selected browser control flow remains unresolved.',
      );
      assert.ok(
        escaped.graph.coverage.topology?.unresolved.some(
          (entry) =>
            entry.kind === 'entry_boundary' &&
            entry.location?.startLine === 4 &&
            entry.reason.includes('did not prove that a browser-use run receiver remained stable'),
        ),
      );
    }

    const changedAfterRun = await scan({
      'src/changed_after.py': `from browser_use import Agent

agent = Agent(task="outer", llm=model)
await agent.run(max_steps=3)
agent.run = foreign
agent = foreign
`,
    });
    assert.equal(changedAfterRun.graph.coverage.topology?.entryBoundaries, 1);
    assert.equal(
      browserAgents(changedAfterRun)[0]?.sourceLocations.some(
        (location) => location.startLine === 4,
      ),
      true,
      'a write after the run cannot be presented as though it happened before the run',
    );

    for (const aliasSource of ['alias = agent', "box = {'agent': agent}", 'holder.agent = agent']) {
      const aliased = await scan({
        'src/aliased.py': `from browser_use import Agent

agent = Agent(task="outer", llm=model)
${aliasSource}
await agent.run(max_steps=3)
`,
      });
      assert.equal(browserAgents(aliased).length, 1);
      assert.equal(aliased.graph.coverage.topology?.entryBoundaries, 0);
      assert.ok(
        aliased.graph.coverage.topology?.unresolved.some(
          (entry) => entry.kind === 'entry_boundary' && entry.location?.startLine === 4,
        ),
        `the alias escape was not cited: ${aliasSource}`,
      );
    }
  });

  it('refuses duplicate constructions and unsettled receiver captures', async () => {
    const namespaceDuplicate = await scan({
      'src/namespace_duplicate.py': `import browser_use as bu
agent = bu.Agent(task="first", llm=model)
await agent.run(max_steps=3)
agent = bu.Agent(task="second", llm=model)
await agent.run(max_steps=3)
`,
    });
    assert.equal(browserAgents(namespaceDuplicate).length, 0);

    const factoryDuplicate = await scan({
      'src/factory_duplicate.py': `from browser_use import Agent

def build(task, llm):
    return Agent(task=task, llm=llm)

agent = build("first", model)
await agent.run(max_steps=3)
agent = build("second", model)
await agent.run(max_steps=3)
`,
    });
    assert.equal(browserAgents(factoryDuplicate).length, 0);

    for (const capture of [
      'alias, = (agent,)\nmutate(alias)',
      'def alter():\n    setattr(agent, "run", foreign)\nalter()',
      'def alter(target=agent):\n    setattr(target, "run", foreign)\nalter()',
    ]) {
      const captured = await scan({
        'src/captured.py': `from browser_use import Agent
agent = Agent(task="outer", llm=model)
${capture}
await agent.run(max_steps=3)
`,
      });
      assert.equal(browserAgents(captured).length, 1);
      assert.equal(captured.graph.coverage.topology?.entryBoundaries, 0);
      assert.ok(
        captured.graph.coverage.topology?.unresolved.some(
          (entry) => entry.kind === 'entry_boundary',
        ),
        `the receiver capture was not refused: ${capture}`,
      );
    }

    const unknownOperation = await scan({
      'src/unknown_operation.py': `from browser_use import Agent
agent = Agent(task="outer", llm=model)
agent.prepare()
await agent.run(max_steps=3)
`,
    });
    assert.equal(unknownOperation.graph.coverage.topology?.entryBoundaries, 0);
    const refusal = unknownOperation.graph.coverage.topology?.unresolved.find(
      (entry) => entry.kind === 'entry_boundary' && entry.location?.startLine === 3,
    );
    assert.ok(refusal?.reason.includes('did not prove'));
    assert.equal(refusal?.reason.includes('mutated or escaped'), false);

    const dominatedBranch = await scan({
      'src/dominated.py': `from browser_use import Agent
if flag:
    agent = foreign
agent = Agent(task="outer", llm=model)
await agent.run(max_steps=3)
`,
    });
    assert.equal(dominatedBranch.graph.coverage.topology?.entryBoundaries, 1);

    const uncertainBranch = await scan({
      'src/uncertain.py': `from browser_use import Agent
agent = Agent(task="outer", llm=model)
if flag:
    agent = foreign
await agent.run(max_steps=3)
`,
    });
    assert.equal(uncertainBranch.graph.coverage.topology?.entryBoundaries, 0);

    for (const shadowedBody of [
      'def alter(agent):\n    mutate(agent)\nalter(foreign)',
      'def alter():\n    agent = foreign\n    mutate(agent)\nalter()',
    ]) {
      const shadowedCapture = await scan({
        'src/shadowed_capture.py': `from browser_use import Agent
agent = Agent(task="outer", llm=model)
${shadowedBody}
await agent.run(max_steps=3)
`,
      });
      assert.equal(
        shadowedCapture.graph.coverage.topology?.entryBoundaries,
        0,
        `an intervening local call was presented as stable: ${shadowedBody}`,
      );
      assert.ok(
        shadowedCapture.graph.coverage.topology?.unresolved.some(
          (entry) => entry.kind === 'entry_boundary' && entry.reason.includes('did not prove'),
        ),
      );
    }

    const earlierClosure = await scan({
      'src/earlier_closure.py': `from browser_use import Agent
def alter():
    setattr(agent, "run", foreign)
agent = Agent(task="outer", llm=model)
alter()
await agent.run(max_steps=3)
`,
    });
    assert.equal(earlierClosure.graph.coverage.topology?.entryBoundaries, 0);
    assert.ok(
      earlierClosure.graph.coverage.topology?.unresolved.some(
        (entry) => entry.kind === 'entry_boundary' && entry.location?.startLine === 5,
      ),
    );

    for (const localCallCase of [
      `from browser_use import Agent
def alter():
    global agent
    agent = foreign
agent = Agent(task="outer", llm=model)
alter()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
async def outer():
    agent = Agent(task="outer", llm=model)
    def alter():
        nonlocal agent
        agent = foreign
    alter()
    await agent.run(max_steps=3)
`,
      `from browser_use import Agent
def alter():
    setattr(agent, "run", foreign)
def wrapper():
    alter()
agent = Agent(task="outer", llm=model)
wrapper()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
def alter():
    setattr(agent, "run", foreign)
alias = alter
agent = Agent(task="outer", llm=model)
alias()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
def alter():
    setattr(agent, "run", foreign)
def alter():
    return None
agent = Agent(task="outer", llm=model)
alter()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
class Mutator:
    def alter(self):
        global agent
        agent.run = foreign
mutator = Mutator()
agent = Agent(task="outer", llm=model)
mutator.alter()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
agent = Agent(task="outer", llm=model)
(lambda: setattr(agent, "run", foreign))()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
from datetime import datetime
class Mutator:
    def now(self):
        agent.run = foreign
datetime = Mutator()
agent = Agent(task="outer", llm=model)
datetime.now()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
def unrelated():
    from datetime import clock
class Mutator:
    def now(self):
        agent.run = foreign
clock = Mutator()
agent = Agent(task="outer", llm=model)
clock.now()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
from datetime import datetime
class Mutator:
    def now(self):
        agent.run = foreign
datetime.now = Mutator().now
agent = Agent(task="outer", llm=model)
datetime.now()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
import datetime as dt
class Mutator:
    def now(self):
        agent.run = foreign
dt.datetime.now = Mutator().now
agent = Agent(task="outer", llm=model)
dt.datetime.now()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
class Mutator:
    def now(self):
        agent.run = foreign
async def outer():
    from datetime import datetime
    datetime.now = Mutator().now
    agent = Agent(task="outer", llm=model)
    datetime.now()
    await agent.run(max_steps=3)
`,
      `from browser_use import Agent
from datetime import datetime
async def execute():
    agent = Agent(task="outer", llm=model)
    datetime.now()
    await agent.run(max_steps=3)
def local_now():
    agent.run = foreign
datetime.now = local_now
await execute()
`,
      `from browser_use import Agent
async def outer():
    from datetime import datetime
    async def inner():
        agent = Agent(task="outer", llm=model)
        datetime.now()
        await agent.run(max_steps=3)
    def local_now():
        agent.run = foreign
    datetime.now = local_now
    await inner()
`,
      `from browser_use import Agent
from datetime import datetime
def local_now():
    agent.run = foreign
def patch():
    datetime.now = local_now
async def execute():
    patch()
    agent = Agent(task="outer", llm=model)
    datetime.now()
    await agent.run(max_steps=3)
`,
      `from browser_use import Agent
from datetime import datetime
def local_now():
    agent.run = foreign
def patch():
    datetime.now = local_now
patch()
async def execute():
    agent = Agent(task="outer", llm=model)
    datetime.now()
    await agent.run(max_steps=3)
await execute()
`,
      `from browser_use import Agent
from datetime import datetime
def local_now():
    agent.run = foreign
clock = datetime
clock.now = local_now
agent = Agent(task="outer", llm=model)
datetime.now()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
import datetime as dt
def local_now():
    agent.run = foreign
clock = dt.datetime
clock.now = local_now
agent = Agent(task="outer", llm=model)
dt.datetime.now()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
from datetime import datetime
def local_now():
    agent.run = foreign
setattr(datetime, "now", local_now)
agent = Agent(task="outer", llm=model)
datetime.now()
await agent.run(max_steps=3)
`,
      `from browser_use import Agent
from datetime import datetime
async def execute():
    agent = Agent(task="outer", llm=model)
    datetime.now()
    await agent.run(max_steps=3)
def local_now():
    agent.run = foreign
setattr(datetime, "now", local_now)
await execute()
`,
    ]) {
      const localCall = await scan({ 'src/local_call.py': localCallCase });
      assert.equal(browserAgents(localCall).length, 1);
      assert.equal(localCall.graph.coverage.topology?.entryBoundaries, 0);
      assert.ok(
        localCall.graph.coverage.topology?.unresolved.some(
          (entry) => entry.kind === 'entry_boundary' && entry.reason.includes('did not prove'),
        ),
      );
    }

    const unprovenSiblingWrite = await scan({
      'src/sibling_write.py': `from browser_use import Agent
from datetime import datetime
def sibling():
    datetime.now = local_now
async def execute():
    agent = Agent(task="outer", llm=model)
    datetime.now()
    await agent.run(max_steps=3)
`,
    });
    assert.equal(unprovenSiblingWrite.graph.coverage.topology?.entryBoundaries, 0);
    assert.ok(
      unprovenSiblingWrite.graph.coverage.topology?.unresolved.some(
        (entry) => entry.kind === 'entry_boundary' && entry.reason.includes('did not prove'),
      ),
    );
  });
});
