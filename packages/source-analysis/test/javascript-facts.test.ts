import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dotted, findEntry, identifierItems, objectArgument, stringValue } from '../src/facts.ts';
import { analyzeJavaScript } from '../src/javascript/analyze.ts';

const analyze = (text: string, file = 'src/agents/triage.ts') =>
  analyzeJavaScript({ file, text, contentHash: 'a'.repeat(64), language: 'typescript' });

describe('javascript fact extraction', () => {
  /**
   * A base class is the declaration form a framework uses when it has no factory, and it was recorded in
   * Python and dropped here. `class AgentWorkflow(Workflow)` was readable and `class MyFlow extends
   * Workflow` left no trace of `Workflow` anywhere in the facts, so one ecosystem could be told what it
   * was built on and the other could not.
   */
  it('records the class a class extends, as Python already records a base', () => {
    const facts = analyze(`
      import { Workflow } from 'unknown-workflows';
      export class MyFlow extends Workflow {
        async run(input: string) {
          return input;
        }
      }
    `);
    const cls = facts.definitions.find((definition) => definition.kind === 'class');
    assert.equal(cls?.name, 'MyFlow');
    assert.deepEqual(cls?.initializer, ['Workflow']);
  });

  it('records a namespaced base class by its dotted name', () => {
    const facts = analyze(`
      import * as sdk from 'unknown-sdk';
      export class MyAgent extends sdk.agents.Base {}
    `);
    const cls = facts.definitions.find((definition) => definition.kind === 'class');
    assert.deepEqual(cls?.initializer, ['sdk.agents.Base']);
  });

  it('records nothing for a base that is computed rather than named', () => {
    const facts = analyze(`
      import { mixin, Base } from 'unknown-sdk';
      export class MyAgent extends mixin(Base) {}
    `);
    const cls = facts.definitions.find((definition) => definition.kind === 'class');
    assert.equal(cls?.initializer, undefined);
  });

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

  it('retains exact JavaScript conditional paths on declarations, calls and writes', () => {
    const facts = analyze(`
      export async function dispatch(useLocal: boolean) {
        if (useLocal) {
          const fetch = localFetch;
          function consequenceOnly() {}
          fetch('/local');
          chosen = fetch;
        } else {
          fetch('https://example.com');
        }
      }
    `);
    const declaration = facts.definitions.find(
      (candidate) => candidate.kind === 'variable' && candidate.name === 'fetch',
    );
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    const assignment = facts.assignments.find((candidate) => candidate.target[0] === 'chosen');
    const callable = facts.definitions.find(
      (candidate) => candidate.kind === 'function' && candidate.name === 'consequenceOnly',
    );

    assert.deepEqual(
      declaration?.branches?.map((branch) => branch.branch),
      ['consequence'],
    );
    assert.equal(declaration?.declarationKind, 'const');
    assert.deepEqual(
      calls.map((call) => call.branches?.map((branch) => branch.branch)),
      [['consequence'], ['alternative']],
    );
    assert.deepEqual(
      assignment?.branches?.map((branch) => branch.branch),
      ['consequence'],
    );
    assert.deepEqual(
      callable?.branches?.map((branch) => branch.branch),
      ['consequence'],
    );
    assert.deepEqual(declaration?.branches?.[0]?.location, calls[0]?.branches?.[0]?.location);
    assert.deepEqual(declaration?.branches?.[0]?.location, calls[1]?.branches?.[0]?.location);
  });

  it('retains object method ownership for method, arrow and function property values', () => {
    const facts = analyze(`
      const command = defineCommand({
        async run({ args }) { await fetch(args.url); },
        arrow: async () => fetch('/arrow'),
        expression: async function () { return fetch('/expression'); },
      });
      void command;
    `);
    const fetchCalls = facts.calls.filter((call) => dotted(call.calleePath) === 'fetch');
    assert.deepEqual(
      fetchCalls.map((call) => call.enclosing),
      ['run', 'arrow', 'expression'],
    );
    assert.deepEqual(
      facts.definitions
        .filter((definition) => definition.kind === 'method')
        .map((definition) => definition.name),
      ['run', 'arrow', 'expression'],
    );
  });

  it('uses the smallest object callable rather than its surrounding function', () => {
    const facts = analyze(`
      function register() {
        return defineCommand({
          run() { return fetch('/inside'); },
        });
      }
      fetch('/module');
    `);
    const calls = facts.calls.filter((call) => dotted(call.calleePath) === 'fetch');
    assert.equal(calls[0]?.enclosing, 'register.run');
    assert.equal(calls[1]?.enclosing, undefined);
  });

  it('does not lend an opaque wrapper result to the callable inside its argument', () => {
    const facts = analyze(`
      const x = discard({ run() { return fetch('/inside'); } });
      void x;
    `);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.equal(call?.enclosing, 'run');
    assert.notEqual(call?.enclosing, 'x.run');
  });

  it('does not assume a callee spelled Object.freeze is the unshadowed global', () => {
    const facts = analyze(`
      const direct = Object.freeze({ run() { return fetch('/global'); } });
      function parameter(Object) {
        const wrapped = Object.freeze({ run() { return fetch('/parameter'); } });
        return wrapped;
      }
      const Object = { freeze: (value) => value };
      const shadowed = Object.freeze({ run() { return fetch('/module'); } });
      void direct;
      void shadowed;
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.deepEqual(
      calls.map((call) => call.enclosing),
      [undefined, 'parameter.run', undefined],
    );
    assert.ok(calls.every((call) => !call.enclosing?.includes('wrapped')));
    assert.ok(calls.every((call) => !call.enclosing?.includes('direct')));
    assert.ok(calls.every((call) => !call.enclosing?.includes('shadowed')));
  });

  it('keeps semantic callable names stable across whitespace and sibling insertions', () => {
    const compact = analyze(`const command={run(){return fetch('/inside')}};`);
    const reformatted = analyze(`

      const command = {
        description: 'inserted sibling',
        run() {
          return fetch('/inside');
        },
      };
    `);
    const owner = (facts: ReturnType<typeof analyze>) =>
      facts.calls.find((candidate) => dotted(candidate.calleePath) === 'fetch')?.enclosing;
    assert.equal(owner(compact), 'command.run');
    assert.equal(owner(reformatted), owner(compact));
  });

  it('refuses same-named callable bindings in sibling blocks, including their retry loops', () => {
    const facts = analyze(`
      function outer(flag) {
        if (flag) {
          const command = { run() { for (let attempt = 0; attempt < 3; attempt += 1) fetch('/read'); } };
          void command;
        } else {
          const command = { run() { for (let attempt = 0; attempt < 3; attempt += 1) fetch('/write', { method: 'POST' }); } };
          void command;
        }
      }
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.ok(calls.every((call) => call.enclosing === undefined));
    assert.ok(calls.every((call) => call.enclosingUnresolved === true));
    assert.ok(facts.controlFlow.every((flow) => flow.enclosing === undefined));
    assert.ok(facts.controlFlow.every((flow) => flow.enclosingUnresolved === true));
  });

  it('refuses a call-bearing semantic name when an inert duplicate makes it ambiguous', () => {
    const facts = analyze(`
      register({ run() { return fetch('/ownerless'); } });
      register({ run() { return undefined; } });
      register(function poll() { return fetch('/function'); });
      register(function poll() { return undefined; });
      function outer(flag) {
        if (flag) {
          const command = { run() { return fetch('/branch'); } };
          void command;
        } else {
          const command = { run() { return undefined; } };
          void command;
        }
      }
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call.enclosing === undefined));
    assert.ok(calls.every((call) => call.enclosingUnresolved === true));
  });

  it('marks a call inside an unnamed callable instead of lending it an outer owner', () => {
    const facts = analyze(`
      function collect(urls) {
        return urls.map(async (url) => fetch(url));
      }
    `);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.equal(call?.enclosing, undefined);
    assert.equal(call?.enclosingUnresolved, true);
    assert.equal(call?.lexicalEnclosing, 'collect');
    assert.deepEqual(call?.lexicalShadows, ['url']);
    assert.equal(call?.lexicalScopes?.length, 2);
    assert.deepEqual(call?.lexicalScopes?.at(-1)?.bindings, ['url']);
    assert.ok(
      call?.lexicalScopes?.every((scope) => scope.location.file === 'src/agents/triage.ts'),
    );
  });

  it('retains ordered lexical scopes and inherited writes across nested unnamed callables', () => {
    const facts = analyze(`
      function collect(items) {
        let agent = makeAgent();
        return items.map(async (agent) => items.map(async () => {
          agent = items[0];
          return run(agent, 'input');
        }));
      }
    `);
    const call = facts.calls.find((candidate) => dotted(candidate.calleePath) === 'run');
    assert.equal(call?.lexicalEnclosing, 'collect');
    assert.equal(call?.lexicalScopes?.length, 3);
    assert.deepEqual(
      call?.lexicalScopes?.map((scope) => scope.bindings),
      [['agent', 'items'], ['agent'], ['agent']],
    );
    assert.deepEqual(call?.lexicalShadows, ['agent']);
    const assignment = facts.assignments.find((candidate) => candidate.target[0] === 'agent');
    assert.equal(assignment?.enclosingUnresolved, true);
    assert.deepEqual(assignment?.enclosingLocation, call?.lexicalScopes?.at(-1)?.location);
  });

  it('settles static computed and nested object paths while refusing dynamic keys', () => {
    const facts = analyze(`
      const command = defineCommand({
        ['literal']: async () => fetch('/literal'),
        [key]: async () => fetch('/dynamic'),
        nested: { run() { return fetch('/nested'); } },
      });
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.deepEqual(
      calls.map((call) => ({ enclosing: call.enclosing, unresolved: call.enclosingUnresolved })),
      [
        { enclosing: 'literal', unresolved: undefined },
        { enclosing: undefined, unresolved: true },
        { enclosing: 'nested.run', unresolved: undefined },
      ],
    );
  });

  it('evaluates dynamic property keys in the surrounding scope while refusing their callable bodies', () => {
    const facts = analyze(`
      const command = {
        [fetch('/key')]: async () => fetch('/body'),
      };
      class Command { [fetch('/class-key')]() { return fetch('/class-body'); } }
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.deepEqual(
      calls.map((call) => ({ enclosing: call.enclosing, unresolved: call.enclosingUnresolved })),
      [
        { enclosing: undefined, unresolved: undefined },
        { enclosing: undefined, unresolved: true },
        { enclosing: undefined, unresolved: undefined },
        { enclosing: undefined, unresolved: true },
      ],
    );
  });

  it('uses a directly passed named function and refuses an unnamed default function', () => {
    const named = analyze(`register(async function poll() { await fetch('/poll'); });`);
    assert.equal(
      named.calls.find((call) => dotted(call.calleePath) === 'fetch')?.enclosing,
      'poll',
    );

    const unnamed = analyze(`export default function () { return fetch('/default'); }`);
    const call = unnamed.calls.find((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.equal(call?.enclosing, undefined);
    assert.equal(call?.enclosingUnresolved, true);
  });

  it('refuses duplicate direct function names while retaining distinct lexical names', () => {
    const facts = analyze(`
      register(function poll() { return fetch('/top-a'); });
      register(function poll() { return fetch('/top-b'); });
      function a() { register(function poll() { return fetch('/a'); }); }
      function b() { register(function poll() { return fetch('/b'); }); }
    `);
    const owners = facts.calls
      .filter((candidate) => dotted(candidate.calleePath) === 'fetch')
      .map((call) => call.enclosing);
    assert.deepEqual(owners, [undefined, undefined, 'a.poll', 'b.poll']);
    assert.ok(
      facts.calls
        .filter((candidate) => dotted(candidate.calleePath) === 'fetch')
        .slice(0, 2)
        .every((call) => call.enclosingUnresolved === true),
    );
  });

  it('settles a computed literal class method and refuses a dynamic one', () => {
    const facts = analyze(`
      class Command {
        ['run']() { return fetch('/run'); }
        [key]() { return fetch('/dynamic'); }
      }
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.deepEqual(
      calls.map((call) => ({ enclosing: call.enclosing, unresolved: call.enclosingUnresolved })),
      [
        { enclosing: 'Command.run', unresolved: undefined },
        { enclosing: undefined, unresolved: true },
      ],
    );
  });

  it('retains class-expression and field paths while refusing their dynamic methods', () => {
    const facts = analyze(`
      const Command = class {
        run() { return fetch('/run'); }
        [key]() { return fetch('/dynamic'); }
        command = { run() { return fetch('/field'); } };
        static nested = { command: { run() { return fetch('/nested'); } } };
        workers = { Worker: class { run() { return fetch('/field-class'); } } };
      };
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.deepEqual(
      calls.map((call) => ({ enclosing: call.enclosing, unresolved: call.enclosingUnresolved })),
      [
        { enclosing: 'Command.run', unresolved: undefined },
        { enclosing: undefined, unresolved: true },
        { enclosing: 'Command.command.run', unresolved: undefined },
        { enclosing: 'Command.nested.command.run', unresolved: undefined },
        { enclosing: 'Command.workers.Worker.run', unresolved: undefined },
      ],
    );
  });

  it('qualifies nested class declarations and prefers a class expression binding over its local id', () => {
    const facts = analyze(`
      function a() {
        class C { run() { return fetch('/a-declaration'); } }
        const X = class C { run() { return fetch('/a-expression'); } };
        return { C, X };
      }
      function b() {
        class C { run() { return fetch('/b-declaration'); } }
        const X = class C { run() { return fetch('/b-expression'); } };
        return { C, X };
      }
    `);
    assert.deepEqual(
      facts.calls
        .filter((candidate) => dotted(candidate.calleePath) === 'fetch')
        .map((call) => call.enclosing),
      ['a.C.run', 'a.X.run', 'b.C.run', 'b.X.run'],
    );
  });

  it('refuses duplicate body-local class names without minting source-position identities', () => {
    const facts = analyze(`
      register(class Local { run() { return fetch('/direct-a'); } });
      register(class Local { run() { return fetch('/direct-b'); } });
      function outer(flag) {
        if (flag) {
          class C { run() { return fetch('/branch-a'); } }
          void C;
        } else {
          class C { run() { return fetch('/branch-b'); } }
          void C;
        }
      }
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.ok(calls.every((call) => call.enclosing === undefined));
    assert.ok(calls.every((call) => call.enclosingUnresolved === true));
  });

  it('keeps named bodies inside separate anonymous callbacks distinct by refusing collisions', () => {
    const facts = analyze(`
      items.map(() => {
        function send() { return fetch('/function-a'); }
        const command = { run() { return fetch('/object-a'); } };
        class C { run() { return fetch('/class-a'); } }
        return { send, command, C };
      });
      items.map(() => {
        function send() { return fetch('/function-b'); }
        const command = { run() { return fetch('/object-b'); } };
        class C { run() { return fetch('/class-b'); } }
        return { send, command, C };
      });
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.equal(calls.length, 6);
    assert.ok(calls.every((call) => call.enclosing === undefined));
    assert.ok(calls.every((call) => call.enclosingUnresolved === true));
  });

  it('carries property paths through classes and transparent syntax but not opaque calls', () => {
    const facts = analyze(`
      type Handler = { run(): Promise<Response> | Response };
      const root = {
        Worker: class { run() { return fetch('/class'); } },
        nested: { Worker: (class { run() { return fetch('/nested-class'); } } as Handler) },
        command: defineCommand({ run() { return fetch('/call-wrapper'); } }),
        frozen: Object.freeze({ run() { return fetch('/frozen'); } }),
        asserted: (({ run() { return fetch('/asserted'); } } as const) satisfies Handler),
      };
      void root;
    `);
    assert.deepEqual(
      facts.calls
        .filter((candidate) => dotted(candidate.calleePath) === 'fetch')
        .map((call) => call.enclosing),
      ['root.Worker.run', 'root.nested.Worker.run', undefined, undefined, 'root.asserted.run'],
    );
  });

  it('keeps unsettled container evaluation in the outer scope and refuses only callable bodies', () => {
    const facts = analyze(`
      declare const key: string;
      const root = {
        [key]: {
          response: fetch('/init'),
          run() { return fetch('/body'); },
        },
      };
      function outer() {
        const values = [...makeList(fetch('/spread-init'))];
        return values;
      }
      void root;
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.deepEqual(
      calls.map((call) => ({ enclosing: call.enclosing, unresolved: call.enclosingUnresolved })),
      [
        { enclosing: undefined, unresolved: undefined },
        { enclosing: undefined, unresolved: true },
        { enclosing: 'outer', unresolved: undefined },
      ],
    );
  });

  it('refuses array-position callable identity so sibling edits cannot rename it', () => {
    const facts = analyze(`
      const commands = [
        { run() { return fetch('/a'); } },
        { run() { return fetch('/b'); } },
      ];
      const root = { commands: [{ run() { return fetch('/nested'); } }] };
      register([{ run() { return fetch('/direct'); } }]);
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.ok(calls.every((call) => call.enclosing === undefined));
    assert.ok(calls.every((call) => call.enclosingUnresolved === true));
  });

  it('refuses colliding ownerless literals and keeps lexical bindings distinct', () => {
    const facts = analyze(`
      register({ run() { return fetch('/first'); } });
      register({ run() { return fetch('/second'); } });
      register([{ run() { return fetch('/array-first'); } }]);
      register([{ run() { return fetch('/array-second'); } }]);
      function a() { const command = { run() { return fetch('/a'); } }; return command; }
      function b() { const command = { run() { return fetch('/b'); } }; return command; }
    `);
    const owners = facts.calls
      .filter((candidate) => dotted(candidate.calleePath) === 'fetch')
      .map((call) => call.enclosing);
    assert.deepEqual(owners.slice(0, 4), [undefined, undefined, undefined, undefined]);
    assert.deepEqual(owners.slice(4), ['a.command.run', 'b.command.run']);
  });

  it('distinguishes accessors and static methods and does not call a class initializer a callable', () => {
    const facts = analyze(`
      const command = {
        get value() { return fetch('/read'); },
        set value(input) { fetch('/write', { method: 'POST', body: input }); },
      };
      class C {
        run() { return fetch('/instance'); }
        static run() { return fetch('/static'); }
        response = fetch('/field');
        static cached = fetch('/static-field');
        static { fetch('/static-block'); }
      }
      const Expression = class {
        static { fetch('/expression-static-block'); }
        [fetch('/expression-key')]() { return undefined; }
      };
    `);
    const calls = facts.calls.filter((candidate) => dotted(candidate.calleePath) === 'fetch');
    assert.deepEqual(
      calls.map((call) => ({ enclosing: call.enclosing, unresolved: call.enclosingUnresolved })),
      [
        { enclosing: 'command.value.get', unresolved: undefined },
        { enclosing: 'command.value.set', unresolved: undefined },
        { enclosing: 'C.run', unresolved: undefined },
        { enclosing: 'C.static.run', unresolved: undefined },
        { enclosing: undefined, unresolved: true },
        { enclosing: undefined, unresolved: undefined },
        { enclosing: undefined, unresolved: undefined },
        { enclosing: undefined, unresolved: undefined },
        { enclosing: undefined, unresolved: undefined },
      ],
    );
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
    assert.equal(loop.countsPasses, true);
    assert.ok(loop.headerNames?.includes('attempt'));
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

  it('records a root reassignment separately from the initial definition', () => {
    const facts = analyze(`
      import { StateGraph } from '@langchain/langgraph';
      let graph = new StateGraph({});
      graph = replacement;
    `);
    assert.equal(facts.definitions.filter((entry) => entry.name === 'graph').length, 1);
    assert.deepEqual(facts.assignments, [
      {
        target: ['graph'],
        value: { kind: 'identifier', name: 'replacement' },
        location: facts.assignments[0]?.location,
      },
    ]);
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
