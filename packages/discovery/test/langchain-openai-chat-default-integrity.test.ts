import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  chatComponentIds as idsOf,
  chatWorkspace as workspaceFor,
  disposeChatWorkspaces,
  scanChatWorkspace as scan,
} from './langchain-openai-chat-fixture.ts';

after(disposeChatWorkspaces);

describe('LangChain OpenAI chat-model default integrity', () => {
  it('refuses dataclass constructors shadowed by a parameter or local binding', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from dataclasses import dataclass
from langchain_openai import ChatOpenAI

@dataclass(frozen=True)
class Models:
    model: str = "false-default"

def parameter_shadow(Models):
    models = Models()
    return ChatOpenAI(model=models.model, base_url="https://api.openai.com/v1")

def local_shadow():
    Models = replacement
    models = Models()
    return ChatOpenAI(model=models.model, base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/false-default'), false);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    assert.equal(result.graph.coverage.topology?.unresolvedCount, 4);
  });

  it('refuses dataclass instance aliases mutated directly or through a bounded chain', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from dataclasses import dataclass
from langchain_openai import ChatOpenAI

@dataclass(frozen=True)
class Models:
    model: str = "false-original"

models = Models()
alias = models
chained = alias
chained.model = "mutated"
model = ChatOpenAI(model=models.model, base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/false-original'), false);
    assert.equal(idsOf(result).includes('model:openai/mutated'), false);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
  });

  it('refuses an aliased keyword object after an exact subscript mutation', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

options = {
    "model": "stale-model",
    "base_url": "https://api.openai.com/v1",
}
alias = options
alias["model"] = "mutated-model"
model = ChatOpenAI(**options)
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/stale-model'), false);
    assert.equal(idsOf(result).includes('model:openai/mutated-model'), false);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
  });

  it('refuses an aliased keyword object after a dynamic-key mutation', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

options = {
    "model": "stale-dynamic-model",
    "base_url": "https://api.openai.com/v1",
}
alias = options
alias[dynamic_key()] = runtime_value
model = ChatOpenAI(**options)
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/stale-dynamic-model'), false);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
  });

  it('refuses nested dataclass paths whose mutation population is not inspected', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from dataclasses import dataclass
from langchain_openai import ChatOpenAI

@dataclass(frozen=True)
class Models:
    config: dict = {"model": "nested-default"}

models = Models()
model = ChatOpenAI(model=models.config.model, base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/nested-default'), false);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
  });

  it('refuses option and dataclass mutation populations beyond the alias ceiling', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from dataclasses import dataclass
from langchain_openai import ChatOpenAI

options = {"model": "false-over-bound", "base_url": "https://api.openai.com/v1"}
option5 = option4
option4 = option3
option3 = option2
option2 = option1
option1 = options
option5["model"] = "mutated"
spread = ChatOpenAI(**options)

@dataclass(frozen=True)
class Models:
    model: str = "false-dataclass-over-bound"

models = Models()
model5 = model4
model4 = model3
model3 = model2
model2 = model1
model1 = models
model5.model = "mutated"
default = ChatOpenAI(model=models.model, base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/false-over-bound'), false);
    assert.equal(idsOf(result).includes('model:openai/false-dataclass-over-bound'), false);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
  });

  it('allows a use before a later dataclass mutation with exact line and column ordering', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from dataclasses import dataclass
from langchain_openai import ChatOpenAI

@dataclass(frozen=True)
class Models:
    model: str = "before-later-mutation"

models = Models()
first = ChatOpenAI(model=models.model, base_url="https://api.openai.com/v1")
second = ChatOpenAI(model=models.model, base_url="https://api.openai.com/v1"); models.model = "later"
`,
    );
    const result = await scan(workspace);
    assert.ok(idsOf(result).includes('model:openai/before-later-mutation'));
  });

  it('refuses dataclass instances constructed with any positional or keyword input', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from dataclasses import dataclass
from langchain_openai import ChatOpenAI

@dataclass(frozen=True)
class Models:
    model: str = "unreachable-default"

keyword = Models(not_a_field=runtime)
positional = Models(runtime)
one = ChatOpenAI(model=keyword.model, base_url="https://api.openai.com/v1")
two = ChatOpenAI(model=positional.model, base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/unreachable-default'), false);
    assert.equal(result.graph.coverage.topology?.status, 'incomplete');
  });
});
