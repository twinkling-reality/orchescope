import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanLangChainV1 } from './langchain-v1-scan.ts';

const classSource = (name: 'A' | 'B'): string => `class ${name}:
    def answer(self):
        PROMPT = "Prompt owned by ${name}."
        return client.responses.create(model="gpt-4.1-mini", input=PROMPT)
`;

const scanOrder = (order: readonly ('A' | 'B')[]) =>
  scanLangChainV1({
    'src/app.py': `from openai import OpenAI

client = OpenAI()

${order.map(classSource).join('\n')}`,
  });

const nestedClassSource = (name: 'OuterA' | 'OuterB'): string => `class ${name}:
    class Inner:
        def answer(self):
            PROMPT = "Prompt owned by ${name}.Inner."
            return client.responses.create(model="gpt-4.1-mini", input=PROMPT)
`;

const scanNestedClassOrder = (order: readonly ('OuterA' | 'OuterB')[]) =>
  scanLangChainV1({
    'src/app.py': `from openai import OpenAI

client = OpenAI()

${order.map(nestedClassSource).join('\n')}`,
  });

const nestedFunctionSource = (name: 'outer_a' | 'outer_b'): string => `def ${name}():
    def answer():
        PROMPT = "Prompt owned by ${name}.answer."
        return client.responses.create(model="gpt-4.1-mini", input=PROMPT)
    return answer
`;

const scanNestedFunctionOrder = (order: readonly ('outer_a' | 'outer_b')[]) =>
  scanLangChainV1({
    'src/app.py': `from openai import OpenAI

client = OpenAI()

${order.map(nestedFunctionSource).join('\n')}`,
  });

const promptIdentityProjection = (result: Awaited<ReturnType<typeof scanOrder>>) =>
  result.graph.components
    .filter((component) => component.kind === 'prompt')
    .map((component) => ({
      id: component.id,
      hash: component.details?.for === 'prompt' ? component.details.textHash : undefined,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

const assertStablePromptPopulation = (
  forward: Awaited<ReturnType<typeof scanOrder>>,
  reverse: Awaited<ReturnType<typeof scanOrder>>,
  ids: readonly string[],
): void => {
  const expected = promptIdentityProjection(forward);
  assert.equal(expected.length, 2);
  assert.deepEqual(
    expected.map((entry) => entry.id),
    ids,
  );
  assert.equal(new Set(expected.map((entry) => entry.hash)).size, 2);
  assert.deepEqual(promptIdentityProjection(reverse), expected);
  for (const result of [forward, reverse]) {
    assert.equal(result.graph.edges.filter((edge) => edge.kind === 'uses_prompt').length, 2);
    assert.equal(
      result.graph.coverage.topology?.unresolved.some((entry) => entry.scope === 'prompt_use'),
      false,
    );
  }
};

describe('prompt lexical identity', () => {
  it('separates same-named method locals independently of class source order', async () => {
    const forward = await scanOrder(['A', 'B']);
    const reverse = await scanOrder(['B', 'A']);

    assertStablePromptPopulation(forward, reverse, [
      'prompt:a.answer.prompt',
      'prompt:b.answer.prompt',
    ]);
  });

  it('separates identical nested methods by their complete containing class chain', async () => {
    assertStablePromptPopulation(
      await scanNestedClassOrder(['OuterA', 'OuterB']),
      await scanNestedClassOrder(['OuterB', 'OuterA']),
      ['prompt:outera.inner.answer.prompt', 'prompt:outerb.inner.answer.prompt'],
    );
  });

  it('separates identical nested functions by their complete containing function chain', async () => {
    assertStablePromptPopulation(
      await scanNestedFunctionOrder(['outer_a', 'outer_b']),
      await scanNestedFunctionOrder(['outer_b', 'outer_a']),
      ['prompt:outer_a.answer.prompt', 'prompt:outer_b.answer.prompt'],
    );
  });
});
