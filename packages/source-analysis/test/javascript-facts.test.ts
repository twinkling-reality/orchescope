import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dotted, findEntry, identifierItems, objectArgument, stringValue } from '../src/facts.ts';
import { analyzeJavaScript } from '../src/javascript/analyze.ts';

const analyze = (text: string, file = 'src/agents/triage.ts') =>
  analyzeJavaScript({ file, text, contentHash: 'a'.repeat(64), language: 'typescript' });

describe('javascript fact extraction', () => {
  it('records imports with their module, local alias and type flag', () => {
    const facts = analyze(`
      import { Agent, tool, type Tool } from '@openai/agents';
      import OpenAI from 'openai';
      import * as path from 'node:path';
      export const unused: Tool | undefined = undefined;
      void path;
      void Agent;
      void tool;
      void OpenAI;
    `);
    assert.equal(facts.parseErrors.length, 0);
    const byLocal = new Map(facts.imports.map((entry) => [entry.local, entry]));
    assert.equal(byLocal.get('Agent')?.module, '@openai/agents');
    assert.equal(byLocal.get('Agent')?.imported, 'Agent');
    assert.equal(byLocal.get('Agent')?.isType, false);
    assert.equal(byLocal.get('Tool')?.isType, true);
    assert.equal(byLocal.get('OpenAI')?.imported, 'default');
    assert.equal(byLocal.get('path')?.imported, '*');
    assert.ok((byLocal.get('Agent')?.location.startLine ?? 0) > 0);
  });

  it('resolves a constructor call to its imported origin and reads its object literal', () => {
    const facts = analyze(`
      import { Agent } from '@openai/agents';
      export const triage = new Agent({
        name: 'triage',
        instructions: 'Route the request to the right worker.',
        tools: [lookupAccount, checkInventory],
        handoffs: [refundAgent],
        modelSettings: { temperature: 0.2, maxTokens: 512 },
      });
    `);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'Agent');
    assert.ok(call, 'expected an Agent call');
    assert.equal(call.kind, 'new');
    assert.equal(call.origin?.module, '@openai/agents');
    const entries = objectArgument(call);
    assert.equal(stringValue(findEntry(entries, 'name')?.value), 'triage');
    assert.match(stringValue(findEntry(entries, 'instructions')?.value) ?? '', /Route the request/);
    assert.deepEqual(identifierItems(findEntry(entries, 'tools')?.value), [
      'lookupAccount',
      'checkInventory',
    ]);
    assert.deepEqual(identifierItems(findEntry(entries, 'handoffs')?.value), ['refundAgent']);
    const settings = findEntry(entries, 'modelSettings')?.value;
    assert.equal(settings?.kind, 'object');
    if (settings?.kind === 'object') {
      assert.equal(findEntry(settings.entries, 'temperature')?.value.kind, 'number');
    }
    assert.ok(call.location.startLine >= 3);
  });

  it('resolves a member call path through a client instance', () => {
    const facts = analyze(`
      import OpenAI from 'openai';
      const client = new OpenAI({ timeout: 30000 });
      export async function ask() {
        return await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [] });
      }
    `);
    const call = facts.calls.find(
      (candidate) => dotted(candidate.calleePath) === 'client.chat.completions.create',
    );
    assert.ok(call, 'expected the completions call');
    assert.equal(call.awaited, true);
    assert.equal(call.enclosing, 'ask');
    const entries = objectArgument(call);
    assert.equal(stringValue(findEntry(entries, 'model')?.value), 'gpt-4o-mini');
    const construction = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'OpenAI');
    assert.equal(construction?.origin?.module, 'openai');
  });

  it('records environment variable reads with their enclosing scope', () => {
    const facts = analyze(`
      export function makeClient() {
        return { key: process.env.OPENAI_API_KEY, region: process.env.AWS_REGION };
      }
    `);
    assert.deepEqual(facts.environmentRefs.map((entry) => entry.name).sort(), [
      'AWS_REGION',
      'OPENAI_API_KEY',
    ]);
    assert.equal(facts.environmentRefs[0]?.enclosing, 'makeClient');
  });

  it('records long strings and template literals as candidate prompts', () => {
    const facts = analyze(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text and the placeholder is the subject
      'export const instructions = `You are a support agent. Always answer in ${tone} tone and be brief.`;\nexport const short = "hi";',
    );
    assert.equal(facts.texts.length, 1);
    assert.equal(facts.texts[0]?.hasSubstitutions, true);
    assert.match(facts.texts[0]?.value ?? '', /You are a support agent/);
    assert.ok((facts.texts[0]?.approximateTokens ?? 0) > 5);
  });

  it('captures try and loop constructs with the calls inside them', () => {
    const facts = analyze(`
      export async function withRetry() {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            return await chargeCard({ amount: 10 });
          } catch (error) {
            void error;
          }
        }
        return undefined;
      }
    `);
    const loop = facts.controlFlow.find((entry) => entry.kind === 'loop');
    const tryCatch = facts.controlFlow.find((entry) => entry.kind === 'try_catch');
    assert.ok(loop, 'expected a loop');
    assert.ok(tryCatch, 'expected a try construct');
    assert.deepEqual(
      tryCatch.contains.map((path) => dotted(path)),
      ['chargeCard'],
    );
    assert.equal(tryCatch.enclosing, 'withRetry');
  });

  it('records exported and local definitions with initialisers', () => {
    const facts = analyze(`
      import { tool } from '@openai/agents';
      export const lookup = tool({ name: 'lookup_account' });
      class Worker {
        async handle() { return 1; }
      }
      void Worker;
    `);
    const variable = facts.definitions.find((entry) => entry.name === 'lookup');
    assert.equal(variable?.kind, 'variable');
    assert.equal(variable?.exported, true);
    assert.deepEqual(variable?.initializer, ['tool']);
    const method = facts.definitions.find((entry) => entry.name === 'Worker.handle');
    assert.equal(method?.kind, 'method');
    assert.equal(method?.async, true);
  });

  it('reports parse errors instead of throwing', () => {
    const facts = analyze('export const broken = {');
    assert.ok(facts.parseErrors.length > 0);
  });
});

/**
 * A subscript selects by the value a name holds when the program runs, and the syntax does not say what that
 * is. Reading the property of a `MemberExpression` without its `computed` flag recorded the variable's own
 * name as a property name: `listeners[i](1)` arrived as the callee path `listeners.i`, which is a claim the
 * source never made and which nothing downstream could tell from a real one. A literal key is the case where
 * nothing is left open, and it stays a path.
 */
describe('a computed member access', () => {
  it('records a literal key as a path segment and refuses a variable one', () => {
    const facts = analyze(`
      export function dispatch(i: number, key: string) {
        listeners[i](1);
        listeners.i(2);
        handlers['refund'](3);
        handlers[key](4);
      }
    `);
    const paths = facts.calls.map((call) => dotted(call.calleePath));
    assert.ok(
      paths.includes('handlers.refund'),
      "handlers['refund'] selects the entry literally named refund",
    );
    assert.ok(paths.includes('listeners.i'), 'listeners.i is a property the source wrote');
    assert.equal(
      paths.filter((path) => path === 'listeners.i').length,
      1,
      'listeners[i] must not be recorded as the property name listeners.i',
    );
    assert.ok(
      !paths.includes('handlers.key'),
      'a variable key names a value at run time, not a property',
    );
  });

  it('leaves a variable subscript argument unknown rather than naming it', () => {
    const facts = analyze(`
      import { Agent } from '@openai/agents';
      export const made = new Agent({ config: settings[chosen], preset: settings['fast'] });
    `);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'Agent');
    assert.ok(call, 'expected an Agent call');
    const entries = objectArgument(call);
    assert.deepEqual(findEntry(entries, 'preset')?.value, {
      kind: 'member',
      path: ['settings', 'fast'],
    });
    assert.equal(findEntry(entries, 'config')?.value.kind, 'unknown');
  });
});

/**
 * A class field produced no fact of any kind, in the language where a field holding a configuration path is
 * how the shape Python writes as a class attribute gets written. It is recorded the way Python records that
 * shape, so that one rule reads both.
 */
describe('a class field', () => {
  it('is a definition under its bare name, carrying the literal it binds', () => {
    const facts = analyze(`
      export class MarketingPostsCrew {
        agentsConfig = 'config/agents.yaml';
        static tasksConfig = 'config/tasks.yaml';
        loaded = readYaml(file);
        chosen = override ?? 'config/default.yaml';
        built = \`config/\${name}.yaml\`;
        run() { return 1; }
      }
    `);
    const byName = new Map(facts.definitions.map((entry) => [entry.name, entry]));

    const configured = byName.get('agentsConfig');
    assert.equal(configured?.kind, 'variable');
    assert.equal(configured?.enclosing, 'MarketingPostsCrew');
    assert.deepEqual(configured?.literals, [{ kind: 'string', value: 'config/agents.yaml' }]);
    assert.deepEqual(byName.get('tasksConfig')?.literals, [
      { kind: 'string', value: 'config/tasks.yaml' },
    ]);

    assert.deepEqual(byName.get('loaded')?.initializer, ['readYaml']);
    assert.equal(byName.get('loaded')?.literals, undefined);
    assert.deepEqual(byName.get('chosen')?.literals, [
      { kind: 'string', value: 'config/default.yaml' },
    ]);
    assert.deepEqual(byName.get('chosen')?.aliasedFrom, [['override']]);
    assert.equal(byName.get('built')?.literals, undefined);
    assert.ok(byName.has('MarketingPostsCrew.run'), 'methods are still recorded as methods');
  });
});
