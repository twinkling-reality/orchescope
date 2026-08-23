import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  chatComponentIds as idsOf,
  chatWorkspace as workspaceFor,
  disposeChatWorkspaces,
  scanChatWorkspace as scan,
} from './langchain-openai-chat-fixture.ts';

after(disposeChatWorkspaces);

describe('LangChain OpenAI chat-model lexical authority', () => {
  it('refuses mixed direct and namespace imports regardless of declaration order', async () => {
    const namespaceThenDirect = workspaceFor();
    namespaceThenDirect.write(
      'src/models.py',
      `import langchain_openai as lc
from langchain_openai import ChatOpenAI as lc
model = lc.ChatOpenAI(model="wrong-member", base_url="https://api.openai.com/v1")
`,
    );
    const directThenNamespace = workspaceFor();
    directThenNamespace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI as lc
import langchain_openai as lc
model = lc(model="wrong-call", base_url="https://api.openai.com/v1")
`,
    );
    for (const result of await Promise.all([
      scan(namespaceThenDirect),
      scan(directThenNamespace),
    ])) {
      assert.equal(
        idsOf(result).some((id) => id.startsWith('model:')),
        false,
      );
      assert.equal(result.graph.coverage.topology?.status, 'incomplete');
      assert.equal(result.graph.coverage.topology?.inspectedInputs, 2);
      assert.equal(result.graph.coverage.topology?.unresolvedCount, 1);
    }
  });

  it('refuses same-named method parameter shadows under class-order permutations', async () => {
    const sources = [
      `from langchain_openai import ChatOpenAI

class First:
    def build(self):
        return ChatOpenAI(model="first", base_url="https://api.openai.com/v1")

class Second:
    def build(self, ChatOpenAI):
        return ChatOpenAI(model="shadowed", base_url="https://api.openai.com/v1")
`,
      `from langchain_openai import ChatOpenAI

class Second:
    def build(self, ChatOpenAI):
        return ChatOpenAI(model="shadowed", base_url="https://api.openai.com/v1")

class First:
    def build(self):
        return ChatOpenAI(model="first", base_url="https://api.openai.com/v1")
`,
    ];
    for (const source of sources) {
      const workspace = workspaceFor();
      workspace.write('src/models.py', source);
      const result = await scan(workspace);
      assert.ok(idsOf(result).includes('model:openai/first'));
      assert.equal(idsOf(result).includes('model:openai/shadowed'), false);
      assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    }
  });

  it('distinguishes top-level sequencing from lexical and deferred module shadows', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

top_level = ChatOpenAI(model="before-top-level-rebind", base_url="https://api.openai.com/v1")

def local_later():
    value = ChatOpenAI(model="local-later", base_url="https://api.openai.com/v1")
    ChatOpenAI = replacement
    return value

def deferred_module_lookup():
    return ChatOpenAI(model="deferred-module", base_url="https://api.openai.com/v1")

ChatOpenAI = replacement
`,
    );
    const result = await scan(workspace);
    assert.ok(idsOf(result).includes('model:openai/before-top-level-rebind'));
    assert.equal(idsOf(result).includes('model:openai/local-later'), false);
    assert.equal(idsOf(result).includes('model:openai/deferred-module'), false);
  });

  it('refuses direct and namespace roots shadowed by parameters in containing closures', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
import langchain_openai as lc

def outer(ChatOpenAI, lc):
    def direct():
        return ChatOpenAI(model="closure-direct", base_url="https://api.openai.com/v1")

    def namespace():
        return lc.ChatOpenAI(model="closure-namespace", base_url="https://api.openai.com/v1")

    return direct(), namespace()
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/closure-direct'), false);
    assert.equal(idsOf(result).includes('model:openai/closure-namespace'), false);
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 2);
  });

  it('keeps same-line duplicate imports distinct in applicability accounting', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI; from langchain_openai import ChatOpenAI
model = ChatOpenAI(model="ambiguous", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    const run = result.graph.coverage.adapters.find(
      (entry) => entry.adapterId === 'adapter:model-sdk',
    );
    assert.equal(
      idsOf(result).some((id) => id.startsWith('model:')),
      false,
    );
    assert.equal(run?.applicability?.relevantImports, 2);
    assert.equal(result.graph.coverage.topology?.inspectedInputs, 2);
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 1);
  });

  it('marks wildcard imports applicable but unresolved while preserving exact namespaces', async () => {
    const wildcard = workspaceFor();
    wildcard.write(
      'src/models.py',
      `from langchain_openai import *
model = ChatOpenAI(model="hidden-star", base_url="https://api.openai.com/v1")
`,
    );
    const namespace = workspaceFor();
    namespace.write(
      'src/models.py',
      `import langchain_openai as lc
model = lc.ChatOpenAI(model="namespace", base_url="https://api.openai.com/v1")
`,
    );
    const [wildcardResult, namespaceResult] = await Promise.all([scan(wildcard), scan(namespace)]);
    assert.equal(idsOf(wildcardResult).includes('model:openai/hidden-star'), false);
    assert.equal(wildcardResult.graph.coverage.topology?.status, 'incomplete');
    assert.equal(wildcardResult.graph.coverage.topology?.inspectedInputs, 1);
    assert.equal(wildcardResult.graph.coverage.topology?.unresolvedCount, 1);
    assert.ok(idsOf(namespaceResult).includes('model:openai/namespace'));
    assert.equal(namespaceResult.graph.coverage.topology?.status, 'complete');
  });

  it('refuses bounded and over-ceiling direct and namespace assignment aliases', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
import langchain_openai as lc

direct4 = direct3
direct3 = direct2
direct2 = direct1
direct1 = ChatOpenAI
bounded = direct4(model="bounded", base_url="https://api.openai.com/v1")

direct5 = direct4b
direct4b = direct3b
direct3b = direct2b
direct2b = direct1b
direct1b = ChatOpenAI
over = direct5(model="over", base_url="https://api.openai.com/v1")

namespace2 = namespace1
namespace1 = lc
member = namespace2.ChatOpenAI(model="member", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    for (const model of ['bounded', 'over', 'member']) {
      assert.equal(idsOf(result).includes(`model:openai/${model}`), false);
    }
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 3);
    assert.equal(
      result.graph.coverage.topology?.unresolved.filter((entry) =>
        entry.reason.includes('source-resolution ceiling'),
      ).length,
      1,
    );
  });

  it('refuses an exact assignment alias despite a duplicate sibling-scope alias name', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

Factory = ChatOpenAI

def sibling():
    Factory = unrelated
    return Factory

model = Factory(model="ambiguous-alias", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/ambiguous-alias'), false);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 1);
  });
});
