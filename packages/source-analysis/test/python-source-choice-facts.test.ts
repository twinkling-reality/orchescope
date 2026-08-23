import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findEntry } from '../src/facts.ts';
import { analyzePython } from '../src/python/analyze.ts';

describe('Python source choices and keyword splats', () => {
  it('retains bounded or alternatives and every exact keyword-splat location', async () => {
    const facts = await analyzePython({
      file: 'src/models.py',
      contentHash: '8'.repeat(64),
      text: `def get_llm(model=None, **kwargs):
    options = {**base, "temperature": 0}
    return ChatOpenAI(
        model=model or models.gpt_5_mini,
        **options,
        **kwargs,
    )
`,
    });
    const call = facts.calls.find((candidate) => candidate.calleePath.at(-1) === 'ChatOpenAI');
    const keywords = call?.args.find((argument) => argument.kind === 'object');
    const model =
      keywords?.kind === 'object' ? findEntry(keywords.entries, 'model')?.value : undefined;
    assert.deepEqual(model, {
      kind: 'selection',
      operator: 'or',
      alternatives: [
        {
          value: { kind: 'identifier', name: 'model' },
          location: {
            file: 'src/models.py',
            startLine: 4,
            startColumn: 14,
            endLine: 4,
            endColumn: 19,
          },
        },
        {
          value: { kind: 'member', path: ['models', 'gpt_5_mini'] },
          location: {
            file: 'src/models.py',
            startLine: 4,
            startColumn: 23,
            endLine: 4,
            endColumn: 40,
          },
        },
      ],
      complete: true,
    });
    assert.deepEqual(
      keywords?.kind === 'object'
        ? keywords.spreads?.map((spread) => [spread.location.startLine, spread.value])
        : undefined,
      [
        [5, { kind: 'identifier', name: 'options' }],
        [6, { kind: 'identifier', name: 'kwargs' }],
      ],
    );

    const options = facts.definitions.find((definition) => definition.name === 'options')?.value;
    assert.deepEqual(
      options?.kind === 'object'
        ? options.spreads?.map((spread) => [spread.location.startLine, spread.value])
        : undefined,
      [[2, { kind: 'identifier', name: 'base' }]],
    );
  });

  it('bounds long source selections without choosing an omitted alternative', async () => {
    const choices = Array.from({ length: 10 }, (_, index) => `choice_${index}`).join(' or ');
    const facts = await analyzePython({
      file: 'src/models.py',
      contentHash: '9'.repeat(64),
      text: `value = ${choices}\n`,
    });
    const value = facts.definitions.find((definition) => definition.name === 'value')?.value;
    assert.equal(value?.kind, 'selection');
    assert.equal(value?.kind === 'selection' ? value.alternatives.length : undefined, 8);
    assert.equal(value?.kind === 'selection' ? value.complete : undefined, false);
  });

  it('does not certify dictionaries whose keys are computed', async () => {
    const facts = await analyzePython({
      file: 'src/models.py',
      contentHash: '7'.repeat(64),
      text: `direct = {dynamic_key(): "value"}
spread = {**known, dynamic_key(): "value"}
`,
    });
    for (const name of ['direct', 'spread']) {
      const value = facts.definitions.find((definition) => definition.name === name)?.value;
      assert.equal(value?.kind === 'object' ? value.complete : undefined, false);
    }
  });

  it('prunes unreachable truthy tails and follows statically falsy operands', async () => {
    const facts = await analyzePython({
      file: 'src/models.py',
      contentHash: '6'.repeat(64),
      text: `truthy = runtime or "reachable" or "unreachable"
falsy = None or "fallback"
`,
    });
    const values = Object.fromEntries(
      facts.definitions.map((definition) => [definition.name, definition.value]),
    );
    assert.deepEqual(
      values['truthy']?.kind === 'selection'
        ? values['truthy'].alternatives.map((choice) => choice.value)
        : undefined,
      [
        { kind: 'identifier', name: 'runtime' },
        { kind: 'string', value: 'reachable' },
      ],
    );
    assert.deepEqual(
      values['falsy']?.kind === 'selection'
        ? values['falsy'].alternatives.map((choice) => choice.value)
        : undefined,
      [{ kind: 'string', value: 'fallback' }],
    );
  });

  it('applies Python truthiness to complete literal array and object alternatives', async () => {
    const facts = await analyzePython({
      file: 'src/models.py',
      contentHash: '5'.repeat(64),
      text: `truthy_array = ["model"] or "unreachable-array"
truthy_object = {"model": "value"} or "unreachable-object"
empty_array = [] or "array-fallback"
empty_object = {} or "object-fallback"
unknown_array = [*runtime] or "possible-array-fallback"
unknown_object = {**runtime} or "possible-object-fallback"
`,
    });
    const values = Object.fromEntries(
      facts.definitions.map((definition) => [definition.name, definition.value]),
    );
    const alternatives = (name: string) => {
      const value = values[name];
      return value?.kind === 'selection'
        ? value.alternatives.map((alternative) => alternative.value)
        : undefined;
    };
    assert.deepEqual(alternatives('truthy_array'), [
      { kind: 'array', items: [{ kind: 'string', value: 'model' }], complete: true },
    ]);
    assert.deepEqual(alternatives('truthy_object'), [
      {
        kind: 'object',
        entries: [
          {
            key: 'model',
            value: { kind: 'string', value: 'value' },
            location: {
              file: 'src/models.py',
              startLine: 2,
              startColumn: 17,
              endLine: 2,
              endColumn: 33,
            },
          },
        ],
        spreads: [],
        complete: true,
      },
    ]);
    assert.deepEqual(alternatives('empty_array'), [{ kind: 'string', value: 'array-fallback' }]);
    assert.deepEqual(alternatives('empty_object'), [{ kind: 'string', value: 'object-fallback' }]);
    assert.equal(alternatives('unknown_array')?.length, 2);
    assert.equal(alternatives('unknown_object')?.length, 2);
  });
});
