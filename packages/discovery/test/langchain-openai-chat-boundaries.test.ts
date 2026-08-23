import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  chatComponentIds as idsOf,
  chatWorkspace as workspaceFor,
  disposeChatWorkspaces,
  scanChatWorkspace as scan,
} from './langchain-openai-chat-fixture.ts';

after(disposeChatWorkspaces);

describe('LangChain OpenAI chat-model authority boundaries', () => {
  it('refuses shadowed and reassigned exact imports with source-located topology evidence', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
import langchain_openai as lc

def direct(ChatOpenAI):
    return ChatOpenAI(model="shadowed", base_url="https://api.openai.com/v1")

def namespace(lc):
    return lc.ChatOpenAI(model="namespace-shadowed", base_url="https://api.openai.com/v1")

ChatOpenAI = replacement
reassigned = ChatOpenAI(model="reassigned", base_url="https://api.openai.com/v1")
lc.ChatOpenAI = replacement
namespace_reassigned = lc.ChatOpenAI(model="namespace-reassigned", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(
      idsOf(result).some((id) => id.startsWith('model:')),
      false,
    );
    const refusals = result.graph.coverage.topology?.unresolved ?? [];
    assert.deepEqual(
      refusals
        .filter((entry) => entry.reason.includes('unshadowed'))
        .map((entry) => entry.location?.startLine),
      [11, 13, 5, 8],
    );
  });

  it('rejects foreign, type-only and repository-local lookalikes without applicability', async () => {
    const foreign = workspaceFor();
    foreign.write(
      'src/models.py',
      `from foreign import ChatOpenAI
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from langchain_openai import ChatOpenAI as TypedChat

foreign_model = ChatOpenAI(model="foreign", base_url="https://api.openai.com/v1")
typed_model = TypedChat(model="typed", base_url="https://api.openai.com/v1")
`,
    );
    const local = workspaceFor();
    local.write('src/langchain_openai.py', 'class ChatOpenAI:\n    pass\n');
    local.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
local_model = ChatOpenAI(model="local", base_url="https://api.openai.com/v1")
`,
    );
    for (const result of await Promise.all([scan(foreign), scan(local)])) {
      assert.equal(
        idsOf(result).some((id) => id.startsWith('model:')),
        false,
      );
      const run = result.graph.coverage.adapters.find(
        (entry) => entry.adapterId === 'adapter:model-sdk',
      );
      assert.equal(run?.status, 'not_applicable');
      assert.equal(run?.applicability?.relevantImports, 0);
    }
  });

  it('counts duplicate direct and namespace imports before refusing ambiguous runtime authority', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
from langchain_openai import ChatOpenAI
import langchain_openai as lc
import langchain_openai as lc

direct = ChatOpenAI(model="direct", base_url="https://api.openai.com/v1")
namespace = lc.ChatOpenAI(model="namespace", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(
      idsOf(result).some((id) => id.startsWith('model:')),
      false,
    );
    const run = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:model-sdk',
    );
    assert.equal(run?.applicability?.relevantImports, 4);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 2);
    assert.deepEqual(
      result.graph.coverage.topology?.unresolved.map((entry) => entry.location?.startLine),
      [6, 7],
    );
  });

  it('counts direct, namespace and chained assignment aliases as bounded refusals', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
import langchain_openai as lc

DirectFactory = ChatOpenAI
NamespaceFactory = lc.ChatOpenAI
ChainedFactory = DirectFactory

one = DirectFactory(model="one")
two = NamespaceFactory(model="two")
three = ChainedFactory(model="three")
`,
    );
    const result = await scan(workspace);
    assert.equal(
      idsOf(result).some((id) => id.startsWith('model:')),
      false,
    );
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 3);
    assert.deepEqual(
      result.graph.coverage.topology?.unresolved.map((entry) => entry.location?.startLine),
      [10, 8, 9],
    );
    assert.ok(
      result.graph.coverage.topology?.unresolved.every((entry) =>
        entry.reason.includes('assignment alias'),
      ),
    );
  });

  it('counts a self-aliased direct spelling once', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
ChatOpenAI = ChatOpenAI
model = ChatOpenAI(model="self-alias")
`,
    );
    const result = await scan(workspace);
    assert.equal(
      idsOf(result).some((id) => id.startsWith('model:')),
      false,
    );
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 1);
    assert.equal(result.graph.coverage.topology?.unresolved[0]?.location?.startLine, 3);
  });

  it('refuses duplicate model and model_name keywords instead of choosing one', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
model = ChatOpenAI(
    model="gpt-first",
    model_name="gpt-second",
    base_url="https://api.openai.com/v1",
)
`,
    );
    const result = await scan(workspace);
    assert.deepEqual(idsOf(result), ['provider:openai']);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.ok(
      result.graph.coverage.topology?.unresolved.some((entry) =>
        entry.reason.includes('no unique source-settled model keyword'),
      ),
    );
  });

  it('does not authorize a same-line-after constant or a later dataclass instance definition', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
from dataclasses import dataclass

@dataclass(frozen=True)
class LocalModels:
    supported: str = "gpt-before-instance"
    late: str = "gpt-after-instance"

same_line = ChatOpenAI(model=MODEL, base_url="https://api.openai.com/v1"); MODEL = "gpt-after"

def before_instance():
    settled = LocalModels()
    supported = ChatOpenAI(model=settled.supported, base_url="https://api.openai.com/v1")
    rejected = ChatOpenAI(model=late.late, base_url="https://api.openai.com/v1")
    late = LocalModels()
    return supported, rejected
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/gpt-after'), false);
    assert.ok(idsOf(result).includes('model:openai/gpt-before-instance'));
    assert.equal(idsOf(result).includes('model:openai/gpt-after-instance'), false);
    assert.equal(
      idsOf(result).some((id) => id.includes('unspecified')),
      false,
    );
  });

  it('refuses a mutated imported dataclass instance through an alias', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/constants.py',
      `from dataclasses import dataclass

@dataclass(frozen=True)
class Models:
    fallback: str = "gpt-original"

models = Models()
models.fallback = "gpt-mutated"
`,
    );
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
from src.constants import models as defaults

model = ChatOpenAI(model=defaults.fallback, base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/gpt-original'), false);
    assert.equal(idsOf(result).includes('model:openai/gpt-mutated'), false);
    assert.equal(
      idsOf(result).some((id) => id.includes('unspecified')),
      false,
    );
  });

  it('refuses fake dataclasses, rebound instances, duplicate fields and dynamic defaults', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
from dataclasses import dataclass as real_dataclass

def dataclass(**kwargs):
    return lambda value: value

@dataclass(frozen=True)
class FakeModels:
    model: str = "gpt-fake"

@real_dataclass(frozen=True)
class StableModels:
    model: str = "gpt-stable"

@real_dataclass(frozen=True)
class DuplicateFields:
    model: str = "gpt-first"
    model: str = "gpt-second"

@real_dataclass(frozen=True)
class DynamicFields:
    model: str = runtime_model

@real_dataclass(frozen=True)
class PostInitModels:
    model: str = "gpt-post-init"

    def __post_init__(self):
        object.__setattr__(self, "model", runtime_model)

class BaseModels:
    def __getattribute__(self, name):
        return runtime_model

@real_dataclass(frozen=True)
class InheritedModels(BaseModels):
    model: str = "gpt-inherited"

fake = FakeModels()
rebound = StableModels()
rebound = StableModels()
duplicates = DuplicateFields()
dynamic = DynamicFields()
post_init = PostInitModels()
inherited = InheritedModels()

one = ChatOpenAI(model=fake.model, base_url="https://api.openai.com/v1")
two = ChatOpenAI(model=rebound.model, base_url="https://api.openai.com/v1")
three = ChatOpenAI(model=duplicates.model, base_url="https://api.openai.com/v1")
four = ChatOpenAI(model=dynamic.model, base_url="https://api.openai.com/v1")
five = ChatOpenAI(model=post_init.model, base_url="https://api.openai.com/v1")
six = ChatOpenAI(model=inherited.model, base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    for (const forbidden of [
      'model:openai/gpt-fake',
      'model:openai/gpt-stable',
      'model:openai/gpt-first',
      'model:openai/gpt-second',
      'model:openai/gpt-post-init',
      'model:openai/gpt-inherited',
    ]) {
      assert.equal(idsOf(result).includes(forbidden), false, `${forbidden} escaped refusal`);
    }
    assert.equal(
      idsOf(result).some((id) => id.includes('unspecified')),
      false,
    );
  });
});
