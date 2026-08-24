import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findEntry, objectArgument } from '../src/facts.ts';
import { analyzeJavaScript } from '../src/javascript/analyze.ts';
import { analyzePython } from '../src/python/analyze.ts';

describe('prompt container completeness facts', () => {
  it('marks JavaScript object and array spreads as incomplete', async () => {
    const facts = await analyzeJavaScript({
      file: 'src/app.ts',
      language: 'typescript',
      contentHash: 'a'.repeat(64),
      text: `client.create({ ...options, messages: [...base, { content: 'hello' }] });`,
    });
    const call = facts.calls.find((candidate) => candidate.calleePath.at(-1) === 'create');
    const options = call === undefined ? [] : objectArgument(call);
    const messages = findEntry(options, 'messages')?.value;
    assert.equal(call?.args[0]?.kind === 'object' ? call.args[0].complete : undefined, false);
    assert.equal(messages?.kind === 'array' ? messages.complete : undefined, false);
  });

  it('marks Python dictionary and keyword splats as incomplete', async () => {
    const facts = await analyzePython({
      file: 'src/app.py',
      contentHash: 'b'.repeat(64),
      text: `payload = {**base, "messages": [{"content": "hello"}]}
client.create(model="m", **payload)
Agent(**options)
`,
    });
    const payload = facts.definitions.find((definition) => definition.name === 'payload')?.value;
    const call = facts.calls.find((candidate) => candidate.calleePath.at(-1) === 'create');
    const keywords = call?.args.find((argument) => argument.kind === 'object');
    const soleSplat = facts.calls
      .find((candidate) => candidate.calleePath.at(-1) === 'Agent')
      ?.args.find((argument) => argument.kind === 'object');
    assert.equal(payload?.kind === 'object' ? payload.complete : undefined, false);
    assert.equal(keywords?.kind === 'object' ? keywords.complete : undefined, false);
    assert.equal(soleSplat?.kind === 'object' ? soleSplat.complete : undefined, false);
    assert.deepEqual(soleSplat?.kind === 'object' ? soleSplat.entries : undefined, []);
  });

  it('marks bounded template substitution populations as incomplete', async () => {
    const javascript = await analyzeJavaScript({
      file: 'src/app.ts',
      language: 'typescript',
      contentHash: 'c'.repeat(64),
      text: `client.create({ input: \`\${a}\${b}\${c}\${d}\${e}\${f}\${g}\${h}\${i}\` });`,
    });
    const python = await analyzePython({
      file: 'src/app.py',
      contentHash: 'd'.repeat(64),
      text: 'client.create(input=f"{a}{b}{c}{d}{e}{f}{g}{h}{i}")\n',
    });
    for (const facts of [javascript, python]) {
      const call = facts.calls.find((candidate) => candidate.calleePath.at(-1) === 'create');
      const input = findEntry(call === undefined ? [] : objectArgument(call), 'input')?.value;
      assert.equal(input?.kind === 'template' ? input.substitutionsComplete : undefined, false);
      assert.equal(input?.kind === 'template' ? input.substitutedNames?.length : undefined, 8);
    }
  });

  it('retains adjacent Python strings and calls nested in a fluent receiver', async () => {
    const facts = await analyzePython({
      file: 'src/app.py',
      contentHash: 'e'.repeat(64),
      text: `from langchain_core.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_messages([
    ("system", ("First sentence. " "Second sentence.")),
    ("human", "Question: {question}"),
]).partial(role="assistant")
`,
    });
    const templateCall = facts.calls.find(
      (candidate) => candidate.calleePath.at(-1) === 'from_messages',
    );
    const chained = facts.calls.find((candidate) => candidate.calleePath.at(-1) === 'partial');
    assert.ok(templateCall !== undefined);
    assert.ok(chained !== undefined);
    const messages = templateCall.args[0];
    assert.equal(messages?.kind, 'array');
    assert.deepEqual(messages?.kind === 'array' ? messages.items[0] : undefined, {
      kind: 'array',
      items: [
        { kind: 'string', value: 'system' },
        { kind: 'string', value: 'First sentence. Second sentence.' },
      ],
      complete: true,
    });
  });
});
