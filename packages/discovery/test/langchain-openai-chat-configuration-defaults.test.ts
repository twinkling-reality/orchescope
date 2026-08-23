import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  chatComponentIds as idsOf,
  chatWorkspace as workspaceFor,
  disposeChatWorkspaces,
  scanChatWorkspace as scan,
} from './langchain-openai-chat-fixture.ts';

after(disposeChatWorkspaces);

const includesLocation = (
  locations: readonly { readonly file: string; readonly startLine: number }[],
  file: string,
  startLine: number,
): boolean =>
  locations.some((location) => location.file === file && location.startLine === startLine);

describe('LangChain OpenAI chat-model configuration defaults', () => {
  it('retains an exact Pydantic endpoint default as possible with transitive authority evidence', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

class Settings(BaseModel):
    endpoint: str = Field(default="https://api.deepseek.com/v1")

settings = Settings()
model = ChatOpenAI(model="deepseek-chat", base_url=settings.endpoint)
`,
    );
    const result = await scan(workspace);
    const provider = result.graph.components.find(
      (component) => component.id === 'provider:deepseek',
    );
    const model = result.graph.components.find(
      (component) => component.id === 'model:deepseek/deepseek-chat',
    );
    const relation = result.graph.edges.find(
      (edge) => edge.kind === 'served_by_provider' && edge.from === 'model:deepseek/deepseek-chat',
    );
    assert.ok(provider !== undefined);
    assert.ok(model !== undefined);
    assert.ok(relation !== undefined);
    assert.equal(provider.metadata['configurationSelection'], 'possible');
    assert.equal(model.metadata['configurationSelection'], 'possible');
    for (const locations of [
      provider.sourceLocations,
      model.sourceLocations,
      relation.sourceLocations,
    ]) {
      assert.ok(includesLocation(locations, 'src/models.py', 2), 'missing exact Field import');
      assert.ok(includesLocation(locations, 'src/models.py', 4), 'missing configuration class');
      assert.ok(includesLocation(locations, 'src/models.py', 5), 'missing Field default');
      assert.ok(includesLocation(locations, 'src/models.py', 8), 'missing ChatOpenAI call');
    }
  });

  it('refuses local and source-later Field lookalikes as endpoint authority', async () => {
    const local = workspaceFor();
    local.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

def Field(**values):
    return values["default"]

class Settings:
    endpoint: str = Field(default="https://api.deepseek.com/v1")

settings = Settings()
model = ChatOpenAI(model="local-field", base_url=settings.endpoint)
`,
    );
    const later = workspaceFor();
    later.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

class Settings:
    endpoint: str = Field(default="https://api.deepseek.com/v1")

from pydantic import Field
settings = Settings()
model = ChatOpenAI(model="later-field", base_url=settings.endpoint)
      `,
    );
    const sameLineLater = workspaceFor();
    sameLineLater.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI
class Settings: endpoint: str = Field(default="https://api.deepseek.com/v1"); from pydantic import Field
settings = Settings()
model = ChatOpenAI(model="same-line-later-field", base_url=settings.endpoint)
`,
    );
    for (const result of await Promise.all([scan(local), scan(later), scan(sameLineLater)])) {
      assert.equal(
        idsOf(result).some((id) => id.startsWith('provider:deepseek')),
        false,
      );
      assert.equal(
        idsOf(result).some((id) => id.startsWith('model:deepseek/')),
        false,
      );
      assert.equal(result.graph.coverage.topology?.status, 'incomplete');
    }
  });

  it('does not retain fallbacks after truthy complete containers', async () => {
    const workspace = workspaceFor();
    workspace.write(
      'src/models.py',
      `from langchain_openai import ChatOpenAI

array = ChatOpenAI(model=["truthy"] or "false-array", base_url="https://api.openai.com/v1")
object = ChatOpenAI(model={"truthy": True} or "false-object", base_url="https://api.openai.com/v1")
empty_array = ChatOpenAI(model=[] or "array-fallback", base_url="https://api.openai.com/v1")
empty_object = ChatOpenAI(model={} or "object-fallback", base_url="https://api.openai.com/v1")
`,
    );
    const result = await scan(workspace);
    assert.equal(idsOf(result).includes('model:openai/false-array'), false);
    assert.equal(idsOf(result).includes('model:openai/false-object'), false);
    assert.ok(idsOf(result).includes('model:openai/array-fallback'));
    assert.ok(idsOf(result).includes('model:openai/object-fallback'));
  });
});
