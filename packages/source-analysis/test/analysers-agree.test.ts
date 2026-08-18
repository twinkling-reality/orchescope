import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArgumentFact, ObjectEntryFact } from '../src/facts.ts';
import { dotted, objectArgument } from '../src/facts.ts';
import { analyzeJavaScript } from '../src/javascript/analyze.ts';
import { analyzePython } from '../src/python/analyze.ts';

/**
 * The same program, written twice, reduced to the same facts.
 *
 * The fact model claims this outright: `new Agent({ name })` in TypeScript and `Agent(name=...)` in
 * Python are one shape, which is what lets a single adapter cover a framework in both ecosystems.
 * Nothing checked it, and the three defects that followed were all one analyser disagreeing with the
 * other about a shape they both meet constantly. A comment among the arguments moved every argument
 * after it along a slot in Python and nothing in JavaScript. A passthrough did the same. A nested call
 * lost its keyword arguments in Python and kept its object in JavaScript.
 *
 * None of the three raised anything. An adapter reading the wrong argument finds nothing, reports
 * `componentsFound: 0`, and looks exactly like an adapter reading a repository that uses no framework.
 * That is why each was found by accident, months apart, while somebody was chasing something else.
 *
 * The pairs are written the way each language writes them rather than transliterated, because that is
 * the claim: two idioms, one reduction.
 */

const canonical = (fact: ArgumentFact | undefined): string => {
  if (fact === undefined) return 'absent';
  switch (fact.kind) {
    case 'string':
      return `string:${fact.value}`;
    case 'number':
      return `number:${fact.value}`;
    case 'boolean':
      return `boolean:${fact.value}`;
    case 'identifier':
      return `identifier:${fact.name}`;
    case 'member':
      return `member:${fact.path.join('.')}`;
    case 'array':
      return `array[${fact.items.map(canonical).join(',')}]`;
    case 'object':
      return `object{${entries(fact.entries)}}`;
    case 'call':
      return `call:${fact.path.join('.')}(${fact.args.map(canonical).join(',')})`;
    default:
      return fact.kind;
  }
};

const entries = (given: readonly ObjectEntryFact[]): string =>
  [...given]
    .map((entry) => `${entry.key}=${canonical(entry.value)}`)
    .sort()
    .join(',');

const pythonEntries = async (source: string, callee: string): Promise<string> => {
  const facts = await analyzePython({
    file: 'fixture.py',
    text: source,
    contentHash: 'a'.repeat(64),
  });
  assert.deepEqual(facts.parseErrors, [], 'the Python fixture did not parse');
  const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === callee);
  assert.ok(call !== undefined, `no ${callee} call in the Python fixture`);
  return entries(objectArgument(call));
};

const javascriptEntries = async (source: string, callee: string): Promise<string> => {
  const facts = await analyzeJavaScript({
    file: 'fixture.ts',
    text: source,
    contentHash: 'b'.repeat(64),
    language: 'typescript',
  });
  assert.deepEqual(facts.parseErrors, [], 'the JavaScript fixture did not parse');
  const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === callee);
  assert.ok(call !== undefined, `no ${callee} call in the JavaScript fixture`);
  return entries(objectArgument(call));
};

type Pair = {
  readonly what: string;
  readonly python: string;
  readonly javascript: string;
  /** What both are expected to reduce to, so a pair cannot agree by both being empty. */
  readonly expected: string;
};

const PAIRS: readonly Pair[] = [
  {
    what: 'keyword arguments and object properties',
    python: 'Agent(name="triage", model="gpt-4o")\n',
    javascript: "new Agent({ name: 'triage', model: 'gpt-4o' });\n",
    expected: 'model=string:gpt-4o,name=string:triage',
  },
  {
    what: 'a note written among the arguments',
    python:
      'Agent(\n    # the router the desk starts at\n    name="triage",\n    model="gpt-4o",\n)\n',
    javascript:
      "new Agent({\n  // the router the desk starts at\n  name: 'triage',\n  model: 'gpt-4o',\n});\n",
    expected: 'model=string:gpt-4o,name=string:triage',
  },
  {
    what: 'options passed through from elsewhere',
    python: 'Agent(name="triage", model="gpt-4o", **overrides)\n',
    javascript: "new Agent({ name: 'triage', model: 'gpt-4o', ...overrides });\n",
    expected: 'model=string:gpt-4o,name=string:triage',
  },
  {
    what: 'a call nested inside the arguments',
    python: 'Agent(name="triage", settings=ModelSettings(temperature=0.2))\n',
    javascript: "new Agent({ name: 'triage', settings: ModelSettings({ temperature: 0.2 }) });\n",
    expected: 'name=string:triage,settings=call:ModelSettings(object{temperature=number:0.2})',
  },
  {
    what: 'a list of names',
    python: 'Agent(name="triage", tools=[lookup_account, check_inventory])\n',
    javascript: "new Agent({ name: 'triage', tools: [lookupAccount, checkInventory] });\n",
    expected:
      'name=string:triage,tools=array[identifier:lookup_account,identifier:check_inventory]',
  },
];

describe('the two analysers', () => {
  for (const pair of PAIRS) {
    it(`reduce ${pair.what} to the same facts`, async () => {
      const fromPython = await pythonEntries(pair.python, 'Agent');
      const fromJavaScript = await javascriptEntries(pair.javascript, 'Agent');
      assert.equal(fromPython, pair.expected, 'the Python reduction is not what was expected');
      assert.equal(
        fromJavaScript,
        /*
         * The names differ because each language spells them its own way, and the shape is what is
         * being compared. Only the list of tools carries identifiers a reader would notice.
         */
        pair.expected
          .replace('lookup_account', 'lookupAccount')
          .replace('check_inventory', 'checkInventory'),
        'the JavaScript reduction is not what was expected',
      );
    });
  }
});
