import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeJavaScript } from '../src/javascript/analyze.ts';
import { analyzePython } from '../src/python/analyze.ts';

describe('source value facts', () => {
  it('retains a Python right hand side, typed parameter and context-manager binding', async () => {
    const facts = await analyzePython({
      file: 'src/research.py',
      contentHash: 'a'.repeat(64),
      text: `from duckduckgo_search import DDGS

def search(configurable: Configuration):
    payload = {"model": "sonar-pro"}
    with DDGS() as ddgs:
        return ddgs.text(configurable.query), payload
`,
    });

    const scope = facts.definitions.find((definition) => definition.name === 'search');
    assert.deepEqual(scope?.parameters, [
      {
        name: 'configurable',
        annotation: ['Configuration'],
        location: {
          file: 'src/research.py',
          startLine: 3,
          startColumn: 25,
          endLine: 3,
          endColumn: 38,
        },
      },
    ]);
    const payload = facts.definitions.find((definition) => definition.name === 'payload');
    assert.equal(payload?.value?.kind, 'object');
    const ddgs = facts.definitions.find((definition) => definition.name === 'ddgs');
    assert.deepEqual(ddgs?.initializer, ['DDGS']);
    assert.equal(ddgs?.value?.kind, 'call');
    assert.equal(ddgs?.enclosing, 'search');
  });

  it('retains the same reduced right hand side for a JavaScript binding', () => {
    const facts = analyzeJavaScript({
      file: 'src/research.ts',
      contentHash: 'b'.repeat(64),
      language: 'typescript',
      text: `export function search() {
  const payload = { model: 'sonar-pro' };
  return payload;
}
`,
    });
    const payload = facts.definitions.find((definition) => definition.name === 'payload');
    assert.equal(payload?.value?.kind, 'object');
  });
});
